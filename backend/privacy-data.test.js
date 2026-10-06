'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const { deleteAccountData, exportAccountData } = require('./privacy-data');
const { HISTORY_SCHEMA } = require('./generated-content');
const { BILLING_SCHEMA } = require('./billing');
const { BUSINESS_TEAM_SCHEMA } = require('./business-teams');
const { CREATOR_ANALYTICS_SCHEMA } = require('./creator-analytics');
const { UFI_VAULT_SCHEMA } = require('./ufi-vault');
const { REPORT_SCHEMA } = require('./content-reports');
const { MANAGED_VPN_SCHEMA } = require('./managed-vpn-schema');
const { INBOX_RECEIPTS_SCHEMA } = require('./inbox-receipts');

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const carol = '33333333-3333-4333-8333-333333333333';
const entry = fs.readFileSync(require.resolve('./index'), 'utf8');
const tables = new Set(['users', 'auth_sessions', 'community_groups', 'follows', 'connections', 'blocks',
  'reports', 'attachments', 'notifications', 'push_subscriptions', 'job_tracking', 'saved_posts',
  'resume_drafts', 'cross_posts', 'seen_posts', 'user_engagement_affinity', 'community_posts',
  'post_comments', 'restaurant_post_likes', 'external_post_likes', 'direct_messages', 'page_views', 'user_sign_in_events',
  'client_error_reports', 'server_error_events', 'negative_usage_signals']);

// Execute actual runtime CREATE/ADD COLUMN statements, so a field mismatch in
// privacy SQL fails against PostgreSQL rather than matching a mocked response.
async function schema(pg) {
  const migration = entry.slice(entry.indexOf('async function migrateDB()'), entry.indexOf('// --- Save external posts'));
  for (const match of migration.matchAll(/await db\.query\(`([\s\S]*?)`\)/g)) {
    const sql = match[1].trim();
    const create = /^CREATE TABLE IF NOT EXISTS (\w+)/.exec(sql);
    const alter = /^ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS/.exec(sql);
    if (tables.has(create?.[1] || alter?.[1])) await pg.exec(sql);
  }
  await pg.exec(HISTORY_SCHEMA);
  await pg.exec(INBOX_RECEIPTS_SCHEMA);
  for (const sql of BILLING_SCHEMA) await pg.exec(sql);
  for (const sql of MANAGED_VPN_SCHEMA) await pg.exec(sql);
  for (const sql of BUSINESS_TEAM_SCHEMA) await pg.exec(sql);
  for (const sql of [...CREATOR_ANALYTICS_SCHEMA, ...UFI_VAULT_SCHEMA, ...REPORT_SCHEMA]) await pg.exec(sql);
}

async function seed(pg) {
  await pg.exec(`TRUNCATE ${[...tables, 'generated_content', 'billing_checkout_attempts', 'billing_webhook_events'].join(',')} RESTART IDENTITY CASCADE`);
  const insert = async (table, row) => {
    const columns = Object.keys(row);
    await pg.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(',')})`, Object.values(row));
  };
  for (const [id, name] of [[alice, 'Alice'], [bob, 'Bob'], [carol, 'Carol']]) {
    await insert('users', { id, name, email: `${name}@example.invalid`, password_hash: 'secret-password-hash',
      auth_subject: 'secret-identity-subject', social_tokens: JSON.stringify({ github: 'secret-access-token' }),
      social_refresh_tokens: JSON.stringify({ github: 'secret-refresh-token' }),
      social_connected_at: JSON.stringify({ github: '2026-09-22T00:00:00Z' }), joined_groups: ['shared-group'],
      role_settings: JSON.stringify({ privacy_publicProfile: false }), interests: ['security'], stripe_customer_id: `cus_${name}` });
  }
  await insert('business_team_members', { owner_id: alice, member_id: bob });
  await insert('business_team_invitations', { id: alice, owner_id: alice, invitee_id: carol,
    email: 'carol@example.invalid', token_hash: 'secret-invitation-hash', expires_at: '2027-01-01T00:00:00Z' });
  await insert('community_groups', { id: 'shared-group', name: 'Shared group', category: 'Test', created_by: alice, member_count: 3 });
  for (const [uid, prefix] of [[alice, 'a'], [bob, 'b']]) {
    await insert('vault_vpn_locations', { id: uid, user_id: uid, platform: 'ios', name: `${prefix}-vpn-profile`, country: 'Canada' });
    await insert('managed_vpn_devices', { id: uid, user_id: uid, gateway_id: 'ufi-de-1', label: `${prefix}-vpn-device`,
      enrollment_mode: prefix === 'a' ? 'profile' : 'native', registration_auth_version: prefix === 'a' ? 0 : null,
      public_key: Buffer.alloc(32, prefix === 'a' ? 1 : 2).toString('base64'), tunnel_address: prefix === 'a' ? '10.80.0.2' : '10.80.0.3' });
    await insert('community_posts', { id: `${prefix}-post`, group_id: 'shared-group', author_id: uid, content: `${prefix}-post-content`, likes: [alice, bob], comments_count: 1 });
    await insert('post_comments', { id: `${prefix}-comment`, post_id: 'b-post', author_id: uid, content: `${prefix}-comment-content` });
    await insert('attachments', { id: `${prefix}-file`, user_id: uid, filename: `${prefix}.txt`, file_size: 9, file_data: Buffer.from(`${prefix}-contents`), extracted_text: `${prefix}-resume-text` });
    await insert('saved_posts', { user_id: uid, post_id: `${prefix}-saved`, post_snapshot: JSON.stringify({ title: `${prefix}-saved-title` }) });
    await insert('job_tracking', { id: `${prefix}-job`, user_id: uid, job_id: `${prefix}-job-id`, title: `${prefix}-job-title` });
    await insert('generated_content', { id: `${prefix}-generated`, user_id: uid, kind: 'draft', prompt: `${prefix}-prompt`, provider_job_id: 'secret-provider-job', output: JSON.stringify({ text: `${prefix}-draft` }) });
    await insert('resume_drafts', { id: `${prefix}-resume`, user_id: uid, data: JSON.stringify({ summary: `${prefix}-summary` }) });
    await insert('cross_posts', { id: `${prefix}-cross`, user_id: uid, content: `${prefix}-cross-content` });
    await insert('seen_posts', { user_id: uid, post_id: `${prefix}-seen` });
    await insert('user_engagement_affinity', { user_id: uid, affinity_key: `topic:${prefix}` });
    await insert('restaurant_post_likes', { user_id: uid, post_id: `${prefix}-restaurant` });
    await insert('external_post_likes', { user_id: uid, post_id: `${prefix}-external` });
    await insert('notifications', { id: `${prefix}-notice`, user_id: uid, type: 'follow', actor_id: carol, preview: `${prefix}-preview` });
    await insert('inbox_read_receipts', { user_id: uid, item_id: `${prefix}-opaque-inbox-item` });
    await insert('push_subscriptions', { id: `${prefix}-push`, user_id: uid, endpoint: `https://secret-push.invalid/${prefix}`, p256dh: 'secret-push-key', auth: 'secret-push-auth' });
    await insert('reports', { id: `${prefix}-report`, reporter_id: uid, target_type: 'user', target_id: carol, reason: 'spam', details: `${prefix}-report-details` });
    await insert('page_views', { user_id: uid, path: '/private?token=secret-url', visitor_id: 'secret-visitor', ip_key: 'secret-ip' });
    await insert('client_error_reports', { user_id: uid, signature: 'failure', message: 'secret-client-message', stack: 'secret-stack' });
    await insert('server_error_events', { user_id: uid, signature: 'failure', message: 'secret-server-message' });
    await insert('negative_usage_signals', { user_id: uid, signal_type: 'failure', visitor_id: 'secret-visitor', context: JSON.stringify({ secret: 'secret-context' }) });
    await insert('user_sign_in_events', { user_id: uid, session_id: `secret-session-${prefix}`, ip_key: 'secret-ip' });
    await insert('auth_sessions', { id: uid, user_id: uid, expires_at: '2027-01-01T00:00:00Z' });
    await insert('managed_vpn_launches', { token_hash: (prefix === 'a' ? 'a' : 'b').repeat(64), user_id: uid,
      platform: 'windows', auth_version: 0, initiating_session_id: uid, expires_at: '2027-01-01T00:00:00Z' });
    await insert('billing_checkout_attempts', { user_id: uid, slot: 'plan', attempt_id: uid, tier: 'pro', price_id: 'price_pro', customer_id: `cus_${prefix}`, session_id: 'secret-checkout-session', return_base: 'https://uficonnect.org' });
  }
  await insert('follows', { follower_id: alice, following_id: bob });
  await insert('follows', { follower_id: bob, following_id: carol });
  await insert('connections', { id: 'alice-connection', from_id: alice, to_id: bob, status: 'pending' });
  await insert('connections', { id: 'other-connection', from_id: bob, to_id: carol, status: 'accepted' });
  await insert('blocks', { id: 'alice-block', blocker_id: alice, blocked_id: carol });
  await insert('blocks', { id: 'other-block', blocker_id: bob, blocked_id: carol });
  await insert('direct_messages', { id: 'sent', conversation_id: 'alice-bob', sender_id: alice, receiver_id: bob, content: 'sent-content' });
  await insert('direct_messages', { id: 'received', conversation_id: 'alice-bob', sender_id: bob, receiver_id: alice, content: 'received-content' });
  await insert('direct_messages', { id: 'unrelated', conversation_id: 'bob-carol', sender_id: bob, receiver_id: carol, content: 'other-private-conversation' });
}

function harness(pg, control = {}) {
  const trace = [];
  const db = { isConnected: () => control.connected !== false };
  db.withClient = async work => work({ query: async (sql, params = []) => {
    trace.push(sql);
    await control.beforeQuery?.(sql);
    const result = await pg.query(sql, params);
    return { ...result, rowCount: result.affectedRows || 0 };
  } });
  return { db, trace };
}

function purgeContext(db, prepare, extra = {}) {
  const context = {
    db, billing: { prepareAccountDeletion: prepare }, connectedInbox: { invalidate() {} }, require: name => { assert.equal(name, './privacy-data'); return { deleteAccountData }; },
    process: { env: { NODE_ENV: 'production' } },
    isDBId: id => /^[0-9a-f-]{36}$/.test(id),
    users: [{ id: alice, joinedGroups: ['shared-group'] }, { id: bob, joinedGroups: ['shared-group'] }],
    posts: [{ id: 'a-post', authorId: alice }, { id: 'b-post', authorId: bob, likes: [alice, bob] }],
    postComments: [{ id: 'a-comment', postId: 'b-post', authorId: alice }, { id: 'b-comment', postId: 'b-post', authorId: bob }],
    follows: [{ followerId: alice, followingId: bob }, { followerId: bob, followingId: carol }],
    connections: [], blocks: [], conversations: [{ participants: [alice, bob] }, { participants: [bob, carol] }],
    groups: [{ id: 'shared-group', createdBy: alice, members: 3 }],
    localSessions: new Map([['old', { userId: alice }]]), userAffinityCache: new Map([[alice, {}]]),
    userSeenCache: new Map([[`${alice}::feed`, new Set()]]), followingSourceCache: new Map([[`${alice}::reddit`, {}]]),
    ...extra,
  };
  vm.createContext(context);
  const start = entry.indexOf('async function purgeUser(uid)');
  const end = entry.indexOf('// Data export', start);
  vm.runInContext(entry.slice(start, end), context);
  return context;
}

test('privacy operations use authoritative PostgreSQL data and commit before cache mutation', { timeout: 60000 }, async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await schema(pg);
  t.beforeEach(() => seed(pg));

  await t.test('exports every implemented collection with account isolation and no credentials', async () => {
    const { db, trace } = harness(pg);
    const exported = await exportAccountData(db, alice);
    assert.equal(trace[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(trace.at(-1), 'COMMIT');
    assert.equal(exported.profile.name, 'Alice');
    assert.deepEqual(exported.profile.preferences.interests, ['security']);
    assert.deepEqual(exported.messages.map(row => row.id).sort(), ['received', 'sent']);
    assert.equal(exported.resumeDrafts[0].data.summary, 'a-summary');
    assert.equal(Buffer.from(exported.attachments[0].fileBase64, 'base64').toString(), 'a-contents');
    assert.equal(exported.social.connections[0].status, 'pending');
    assert.equal(exported.social.blocks[0].blockedId, carol);
    assert.equal(exported.vpnLocations[0].name, 'a-vpn-profile');
    assert.equal(exported.vpnDevices[0].label, 'a-vpn-device');
    assert.equal(exported.vpnDevices[0].enrollmentMode, 'profile');
    assert.equal(exported.businessTeamSeats[0].memberId, bob);
    assert.equal(exported.businessTeamInvitations[0].inviteeId, carol);
    assert.equal(Object.hasOwn(exported.businessTeamInvitations[0], 'token_hash'), false);
    for (const key of ['posts', 'comments', 'attachments', 'savedPosts', 'trackedJobs', 'generatedContent', 'resumeDrafts',
      'crossPosts', 'ownedGroups', 'notifications', 'inboxReadReceipts', 'reports', 'seenPosts', 'engagementPreferences', 'restaurantLikes', 'externalPostLikes',
      'pushRegistrations', 'signIns', 'legacyPageViews', 'legacyClientErrors', 'legacyServerErrors', 'legacyUsageSignals', 'billingCheckouts', 'vpnLocations', 'vpnDevices']) {
      assert.equal(exported[key].length, 1, key);
    }
    const serialized = JSON.stringify(exported);
    for (const forbidden of ['secret-', 'other-private-conversation', 'b-summary', 'b-report-details', 'b-resume-text', 'b-prompt', 'b-vpn-profile', 'b-vpn-device']) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });

  await t.test('billing exports the account paid Business seat count rather than its assigned member count', async () => {
    await pg.query("UPDATE users SET plan='business',business_seats=5 WHERE id=$1", [alice]);
    await pg.query("UPDATE users SET plan='business',business_seats=9 WHERE id=$1", [carol]);
    const { db } = harness(pg);
    const owner = await exportAccountData(db, alice);
    assert.equal(owner.billing.businessSeats, 5);
    assert.equal(owner.businessTeamSeats.length, 1);
    const teammate = await exportAccountData(db, bob);
    assert.equal(teammate.billing.businessSeats, 0);
    assert.equal(teammate.businessTeamSeats[0].ownerId, alice);
  });

  await t.test('purges owned records and cascades while preserving unrelated members and shared communities', async () => {
    const { db } = harness(pg);
    await deleteAccountData(db, alice);
    assert.deepEqual((await pg.query('SELECT id FROM users ORDER BY id')).rows.map(row => row.id), [bob, carol]);
    for (const table of [...tables].filter(name => !['users', 'community_groups', 'follows', 'connections', 'blocks', 'reports', 'community_posts', 'post_comments', 'direct_messages'].includes(name))) {
      assert.equal((await pg.query(`SELECT COUNT(*)::integer AS count FROM ${table} WHERE user_id=$1`, [alice])).rows[0].count, 0, table);
      assert.equal((await pg.query(`SELECT COUNT(*)::integer AS count FROM ${table} WHERE user_id=$1`, [bob])).rows[0].count, 1, table);
    }
    for (const table of ['generated_content', 'billing_checkout_attempts', 'vault_vpn_locations', 'managed_vpn_devices', 'managed_vpn_launches', 'inbox_read_receipts']) {
      assert.equal((await pg.query(`SELECT COUNT(*)::integer AS count FROM ${table} WHERE user_id=$1`, [alice])).rows[0].count, 0, table);
    }
    assert.equal((await pg.query('SELECT name FROM vault_vpn_locations WHERE user_id=$1', [bob])).rows[0].name, 'b-vpn-profile');
    assert.equal((await pg.query('SELECT label FROM managed_vpn_devices WHERE user_id=$1', [bob])).rows[0].label, 'b-vpn-device');
    assert.equal((await pg.query('SELECT * FROM business_team_members')).rows.length, 0);
    assert.equal((await pg.query('SELECT * FROM business_team_invitations')).rows.length, 0);
    assert.deepEqual((await pg.query('SELECT created_by,member_count FROM community_groups')).rows[0], { created_by: null, member_count: 2 });
    assert.deepEqual((await pg.query('SELECT id,likes FROM community_posts')).rows, [{ id: 'b-post', likes: [bob] }]);
    assert.equal((await pg.query('SELECT comments_count FROM community_posts')).rows[0].comments_count, 1);
    assert.deepEqual((await pg.query('SELECT id FROM post_comments')).rows, [{ id: 'b-comment' }]);
    assert.deepEqual((await pg.query('SELECT id FROM direct_messages')).rows, [{ id: 'unrelated' }]);
    assert.deepEqual((await pg.query('SELECT id FROM reports')).rows, [{ id: 'b-report' }]);
  });

  await t.test('a real SQL failure rolls back earlier deletes and leaves process memory unchanged', async () => {
    const { db, trace } = harness(pg, { beforeQuery: async sql => {
      if (sql.startsWith('DELETE FROM attachments')) await pg.query('SELECT 1/0');
    } });
    const context = purgeContext(db, async () => {});
    await assert.rejects(context.purgeUser(alice), /division by zero/);
    assert.equal(trace.at(-1), 'ROLLBACK');
    assert.equal(context.users.length, 2);
    assert.equal(context.posts.length, 2);
    assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM direct_messages')).rows[0].count, 3);
    assert.equal((await pg.query('SELECT COUNT(*)::integer AS count FROM users')).rows[0].count, 3);
    assert.equal((await pg.query('SELECT created_by FROM community_groups')).rows[0].created_by, alice);
  });

  await t.test('billing must finish first, and caches are cleared only after SQL commit', async () => {
    let billingFinished = false;
    let context;
    const { db, trace } = harness(pg, { beforeQuery: sql => {
      assert.equal(billingFinished, true);
      assert.equal(context.users.some(user => user.id === alice), true, sql);
    } });
    context = purgeContext(db, async uid => { assert.equal(uid, alice); billingFinished = true; });
    await context.purgeUser(alice);
    assert.equal(trace.at(-1), 'COMMIT');
    assert.equal(context.users.some(user => user.id === alice), false);
    assert.equal(context.groups[0].createdBy, null);
    assert.equal(context.groups[0].members, 2);
    assert.equal(context.users[0].joinedGroups[0], 'shared-group');
    assert.equal(context.conversations.length, 1);
    assert.equal(context.localSessions.size, 0);
    assert.equal(context.userSeenCache.size, 0);
    assert.equal(context.userAffinityCache.size, 0);
    assert.equal(context.followingSourceCache.size, 0);
  });

  await t.test('billing failure and unavailable database cannot erase or export a cached account', async () => {
    const { db, trace } = harness(pg);
    const context = purgeContext(db, async () => { throw new Error('Provider unavailable'); });
    await assert.rejects(context.purgeUser(alice), /Provider unavailable/);
    assert.equal(trace.length, 0);
    assert.equal(context.users.length, 2);
    const offline = harness(pg, { connected: false }).db;
    const offlineContext = purgeContext(offline, async () => { throw new Error('Must not call'); });
    await assert.rejects(offlineContext.purgeUser(alice), error => error.status === 503);
    await assert.rejects(exportAccountData(offline, alice), error => error.status === 503);
    assert.equal(offlineContext.users.length, 2);
  });

  await t.test('missing account and failed collection never produce a partial export', async () => {
    const { db, trace } = harness(pg);
    await assert.rejects(exportAccountData(db, '44444444-4444-4444-8444-444444444444'), error => error.status === 404);
    assert.equal(trace.at(-1), 'ROLLBACK');
    const failure = harness(pg, { beforeQuery: async sql => {
      if (sql.includes('FROM resume_drafts')) await pg.query('SELECT 1/0');
    } });
    await assert.rejects(exportAccountData(failure.db, alice), /division by zero/);
    assert.equal(failure.trace.at(-1), 'ROLLBACK');
  });

  await t.test('the actual export route bypasses stale account caches and disables response caching', async () => {
    let handler;
    const { db } = harness(pg);
    const context = {
      app: { get: (...args) => { handler = args.at(-1); } }, authenticate() {}, db,
      require: name => { assert.equal(name, './privacy-data'); return { exportAccountData }; },
      isDBId: id => /^[0-9a-f-]{36}$/.test(id), process: { env: { NODE_ENV: 'production' } },
      getUser: () => { throw new Error('Must not read process-local account or collections'); },
      console: { error() {} },
    };
    const start = entry.indexOf("app.get('/profile/export'");
    const end = entry.indexOf("app.delete('/profile'", start);
    vm.runInNewContext(entry.slice(start, end), context);
    const res = { headers: {}, code: 200, setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await handler({ user: { id: alice } }, res);
    assert.equal(res.code, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['Content-Disposition'], `attachment; filename="uficonnect-data-export-${alice}.json"`);
    assert.equal(res.data.profile.name, 'Alice');
    assert.equal(res.data.messages.length, 2);
  });
});
