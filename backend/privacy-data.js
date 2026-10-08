'use strict';

const unavailable = () => Object.assign(new Error('Account storage is temporarily unavailable.'), { status: 503 });

// All statements use the runtime migration schema in index.js, not the older
// standalone schema.sql. Missing tables fail the operation instead of silently
// presenting a partial export or claiming an incomplete deletion succeeded.
async function transaction(db, readOnly, work) {
  if (!db.isConnected()) throw unavailable();
  return db.withClient(async client => {
    await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

async function deleteAccountData(db, userId) {
  return transaction(db, false, async client => {
    const { rows: [user] } = await client.query('SELECT id, joined_groups FROM users WHERE id=$1 FOR UPDATE', [userId]);
    if (!user) return { deleted: false };
    const query = sql => client.query(sql, [userId]);
    // Preserve communities and other members' posts, but detach the departing
    // creator. Removing an account must not erase everybody else's group.
    await client.query(`UPDATE community_groups SET member_count=GREATEST(0, member_count-1)
      WHERE id=ANY($1::text[])`, [user.joined_groups || []]);
    await query('UPDATE community_groups SET created_by=NULL WHERE created_by=$1');
    await query(`UPDATE community_posts p SET comments_count=
      (SELECT COUNT(*)::integer FROM post_comments c WHERE c.post_id=p.id AND c.author_id<>$1)
      WHERE EXISTS (SELECT 1 FROM post_comments c WHERE c.post_id=p.id AND c.author_id=$1)`);
    await query(`UPDATE community_posts SET likes=array_remove(likes, $1) WHERE $1=ANY(likes)`);
    await query(`DELETE FROM notifications WHERE user_id=$1 OR actor_id=$1 OR
      (target_type='post' AND target_id IN (SELECT id FROM community_posts WHERE author_id=$1)) OR
      (target_type='comment' AND target_id IN (SELECT id FROM post_comments WHERE author_id=$1))`);
    await query(`DELETE FROM post_comments WHERE author_id=$1 OR
      post_id IN (SELECT id FROM community_posts WHERE author_id=$1)`);
    await query('DELETE FROM community_posts WHERE author_id=$1');
    await query('DELETE FROM direct_messages WHERE sender_id=$1 OR receiver_id=$1');
    await query('DELETE FROM follows WHERE follower_id=$1 OR following_id=$1');
    await query('DELETE FROM connections WHERE from_id=$1 OR to_id=$1');
    await query('DELETE FROM blocks WHERE blocker_id=$1 OR blocked_id=$1');
    // These rows have no user foreign key in the live migration schema.
    for (const table of [
      'attachments', 'saved_posts', 'job_tracking', 'generated_content', 'resume_drafts',
      'cross_posts', 'seen_posts', 'restaurant_post_likes', 'external_post_likes', 'user_engagement_affinity',
      'push_subscriptions', 'page_views', 'client_error_reports', 'server_error_events',
      'negative_usage_signals',
    ]) await query(`DELETE FROM ${table} WHERE user_id=$1`);
    for (const table of ['ufi_vault_challenges','ufi_vault_credentials','ufi_vault_security_events']) await query(`DELETE FROM ${table} WHERE account_id=$1`);
    await query('DELETE FROM reports WHERE reporter_id=$1');
    // auth_sessions, user_sign_in_events and billing_checkout_attempts cascade.
    await query('DELETE FROM users WHERE id=$1');
    return { deleted: true };
  });
}

async function exportAccountData(db, userId) {
  return transaction(db, true, async client => {
    const rows = async sql => (await client.query(sql, [userId])).rows;
    const [profile] = await rows(`SELECT id,name,email,phone,title,bio,organization,skills,
      avatar_url AS "avatarUrl",cover_url AS "coverUrl",joined_groups AS "joinedGroups",
      onboarding_complete AS "onboardingComplete",profile_hidden AS "profileHidden",
      role,experience,goals,interests,links,role_settings AS "roleSettings",
      auth_provider AS "signInProvider",social_connected_at AS "connectedAccounts",
      created_at AS "createdAt" FROM users WHERE id=$1`);
    if (!profile) throw Object.assign(new Error('Account not found.'), { status: 404 });
    profile.preferences = { role: profile.role, experience: profile.experience, goals: profile.goals, interests: profile.interests };
    delete profile.role; delete profile.experience; delete profile.goals; delete profile.interests;
    const [billing] = await rows(`SELECT plan,business_seats AS "businessSeats",resume_builder_addon AS "resumeBuilderAddon",vpn_connector_addon AS "vpnConnectorAddon",
      stripe_customer_id AS "customerId",stripe_subscription_id AS "subscriptionId",
      resume_builder_subscription_id AS "resumeBuilderSubscriptionId",vpn_connector_subscription_id AS "vpnConnectorSubscriptionId",billing_closed AS "closed"
      FROM users WHERE id=$1`);
    const result = { exportedAt: new Date().toISOString(), formatVersion: 2, profile, billing };
    const collections = {
      inboxReadReceipts: `SELECT item_id AS "itemId",read_at AS "readAt" FROM inbox_read_receipts WHERE user_id=$1 ORDER BY read_at,item_id`,
      businessTeamSeats: `SELECT owner_id AS "ownerId",member_id AS "memberId",joined_at AS "joinedAt"
        FROM business_team_members WHERE owner_id=$1 OR member_id=$1 ORDER BY owner_id,joined_at,member_id`,
      businessTeamInvitations: `SELECT id,owner_id AS "ownerId",invitee_id AS "inviteeId",email,created_at AS "createdAt",expires_at AS "expiresAt"
        FROM business_team_invitations WHERE owner_id=$1 OR invitee_id=$1 ORDER BY created_at,id`,
      vpnLocations: `SELECT id,platform,name,country FROM vault_vpn_locations WHERE user_id=$1 ORDER BY country,name,id`,
      vpnDevices: `SELECT id,gateway_id AS "gatewayId",label,public_key AS "publicKey",tunnel_address AS "tunnelAddress",enrollment_mode AS "enrollmentMode",
        created_at AS "createdAt",revoked_at AS "revokedAt",lease_expires_at AS "leaseExpiresAt"
        FROM managed_vpn_devices WHERE user_id=$1 ORDER BY created_at,id`,
      copyrightReports: `SELECT id,source,source_url AS "sourceUrl",reason,status,created_at AS "createdAt" FROM creator_copyright_reports WHERE user_id=$1 ORDER BY created_at,id`,
      sourceInteractionRequests: `SELECT request_id AS "requestId",source,source_post_id AS "sourcePostId",action,status,created_at AS "createdAt" FROM source_interaction_audit WHERE user_id=$1 ORDER BY created_at,request_id`,
      sourceMetricSnapshots: `SELECT source,period_days AS "periodDays",data,fetched_at AS "fetchedAt" FROM creator_source_snapshots WHERE user_id=$1 ORDER BY source,period_days`,

      posts: `SELECT id,group_id AS "groupId",title,content,url,media_url AS "mediaUrl",media_type AS "mediaType",
        cardinality(likes) AS "likesCount",created_at AS "createdAt" FROM community_posts WHERE author_id=$1 ORDER BY created_at,id`,
      comments: `SELECT id,post_id AS "postId",content,created_at AS "createdAt" FROM post_comments WHERE author_id=$1 ORDER BY created_at,id`,
      messages: `SELECT id,conversation_id AS "conversationId",sender_id AS "senderId",receiver_id AS "receiverId",content,
        attachment,read,created_at AS "createdAt" FROM direct_messages WHERE sender_id=$1 OR receiver_id=$1 ORDER BY created_at,id`,
      attachments: `SELECT id,filename,mime_type AS "mimeType",file_size AS "fileSize",encode(file_data,'base64') AS "fileBase64",
        extracted_text AS "extractedText",ats_score AS "atsScore",ats_feedback AS "atsFeedback",keywords,
        is_primary AS "isPrimary",created_at AS "createdAt" FROM attachments WHERE user_id=$1 ORDER BY created_at,id`,
      savedPosts: `SELECT post_id AS id,post_snapshot AS snapshot,created_at AS "savedAt",updated_at AS "updatedAt"
        FROM saved_posts WHERE user_id=$1 ORDER BY created_at,post_id`,
      trackedJobs: `SELECT job_id AS id,status,title,org,source,source_url AS "sourceUrl",match_score AS "matchScore",
        job_content AS "jobContent",contact_email AS "contactEmail",recruiter_name AS "recruiterName",
        recruiter_role AS "recruiterRole",created_at AS "trackedAt",updated_at AS "updatedAt"
        FROM job_tracking WHERE user_id=$1 ORDER BY created_at,id`,
      generatedContent: `SELECT id,kind,prompt,input,output,status,created_at AS "createdAt",updated_at AS "updatedAt"
        FROM generated_content WHERE user_id=$1 ORDER BY created_at,id`,
      generationUsage: `SELECT kind,period_start AS "periodStart",used FROM generation_usage
        WHERE user_id=$1 ORDER BY period_start,kind`,
      generationRequests: `SELECT kind,period_start AS "periodStart",state,created_at AS "createdAt"
        FROM generation_usage_reservations WHERE user_id=$1 ORDER BY created_at,id`,
      resumeDrafts: `SELECT id,template,data,updated_at AS "updatedAt" FROM resume_drafts WHERE user_id=$1 ORDER BY id`,
      crossPosts: `SELECT id,content,media_url AS "mediaUrl",targets,created_at AS "createdAt" FROM cross_posts WHERE user_id=$1 ORDER BY created_at,id`,
      businessPosts: `SELECT id,details,content,targets,status,native_post_id AS "nativePostId",created_at AS "createdAt" FROM business_posts WHERE user_id=$1 ORDER BY created_at,id`,
      ownedGroups: `SELECT id,name,category,description,is_private AS "isPrivate",created_at AS "createdAt"
        FROM community_groups WHERE created_by=$1 ORDER BY created_at,id`,
      notifications: `SELECT id,type,actor_id AS "actorId",target_type AS "targetType",target_id AS "targetId",
        preview,read,created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at,id`,
      reports: `SELECT id,target_type AS "targetType",target_id AS "targetId",reason,details,status,source,source_url AS "sourceUrl",
        created_at AS "createdAt",resolved_at AS "resolvedAt" FROM reports WHERE reporter_id=$1 ORDER BY created_at,id`,
      seenPosts: `SELECT post_id AS "postId",context,seen_at AS "seenAt",engaged_at AS "engagedAt"
        FROM seen_posts WHERE user_id=$1 ORDER BY seen_at,post_id,context`,
      engagementPreferences: `SELECT affinity_key AS "affinityKey",weight,updated_at AS "updatedAt"
        FROM user_engagement_affinity WHERE user_id=$1 ORDER BY affinity_key`,
      restaurantLikes: `SELECT post_id AS "postId",created_at AS "createdAt" FROM restaurant_post_likes WHERE user_id=$1 ORDER BY created_at,post_id`,
      externalPostLikes: `SELECT post_id AS "postId",created_at AS "createdAt" FROM external_post_likes WHERE user_id=$1 ORDER BY created_at,post_id`,
      postLikes: `SELECT id AS "postId" FROM community_posts WHERE $1=ANY(likes) ORDER BY id`,
      pushRegistrations: `SELECT id,created_at AS "createdAt" FROM push_subscriptions WHERE user_id=$1 ORDER BY created_at,id`,
      signIns: `SELECT provider,created_at AS "createdAt" FROM user_sign_in_events WHERE user_id=$1 ORDER BY created_at,id`,
      // Raw historical error bodies, session/IP keys and visitor identifiers
      // can contain credentials or other people's data; disclose record dates
      // and categories only. Further legal access requests need human review.
      legacyPageViews: `SELECT created_at AS "createdAt" FROM page_views WHERE user_id=$1 ORDER BY created_at,id`,
      legacyClientErrors: `SELECT created_at AS "createdAt" FROM client_error_reports WHERE user_id=$1 ORDER BY created_at,id`,
      legacyServerErrors: `SELECT created_at AS "createdAt" FROM server_error_events WHERE user_id=$1 ORDER BY created_at,id`,
      legacyUsageSignals: `SELECT signal_type AS "signalType",created_at AS "createdAt" FROM negative_usage_signals WHERE user_id=$1 ORDER BY created_at,id`,
      billingCheckouts: `SELECT slot,tier,price_id AS "priceId",created_at AS "createdAt" FROM billing_checkout_attempts WHERE user_id=$1 ORDER BY created_at,slot`,
    };
    // One repeatable-read snapshot; never return silently truncated collections
    // from process-local caches or mix different database snapshots.
    for (const [key, sql] of Object.entries(collections)) result[key] = await rows(sql);
    const following = await rows('SELECT following_id AS id FROM follows WHERE follower_id=$1 ORDER BY following_id');
    const followers = await rows('SELECT follower_id AS id FROM follows WHERE following_id=$1 ORDER BY follower_id');
    const connections = await rows(`SELECT id,from_id AS "fromId",to_id AS "toId",status,created_at AS "createdAt"
      FROM connections WHERE from_id=$1 OR to_id=$1 ORDER BY created_at,id`);
    const blocks = await rows(`SELECT blocked_id AS "blockedId",created_at AS "createdAt" FROM blocks WHERE blocker_id=$1 ORDER BY created_at,id`);
    result.social = { following: following.map(row => row.id), followers: followers.map(row => row.id), connections, blocks };
    result.scope = {
      source: 'Current UFIConnect database records for this account.',
      exclusions: 'Authentication secrets, raw security logs, browser-only preferences and independent provider records are not included. Contact privacy@uficonnect.org for additional access requests.',
      files: 'Attachment fileBase64 contains the saved file bytes encoded as base64.',
    };
    return result;
  });
}

module.exports = { deleteAccountData, exportAccountData };
