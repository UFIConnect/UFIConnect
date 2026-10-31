'use strict';

const { rateLimit } = require('express-rate-limit');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const failure = (status, message) => Object.assign(new Error(message), { status });
const OFFICE_USER_USAGE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS office_user_usage_revision (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    version BIGINT NOT NULL DEFAULT 1, command TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
];
const COMMANDS = [
  { id: 'refresh-feed', label: 'Refresh user feed caches', description: 'Expire this account\'s temporary personalized and connected feed caches across workers. Viewed history and monthly quotas stay intact.' },
  { id: 'balance-interests', label: 'Balance learned interests', description: 'Cap learned source and topic weights above 1,000, then refresh the account\'s feed. Declared interests, viewed history and monthly quotas stay intact.' },
];

function createOfficeUserUsage({ db, generationUsage, invalidateUser = () => {}, schedule = setInterval, now = Date.now }) {
  const revisions = new Map();
  let refreshing = false;
  async function refreshRevisions() {
    if (!db.isConnected() || refreshing) return;
    refreshing = true;
    try {
      const { rows } = await db.query('SELECT user_id,version FROM office_user_usage_revision');
      for (const row of rows) {
        if (revisions.get(row.user_id) !== String(row.version)) {
          invalidateUser(row.user_id); revisions.set(row.user_id, String(row.version));
        }
      }
      const present = new Set(rows.map(row => row.user_id));
      for (const id of revisions.keys()) if (!present.has(id)) revisions.delete(id);
    } finally { refreshing = false; }
  }
  const timer = schedule(() => { void refreshRevisions().catch(() => {}); }, 5000); timer?.unref?.();
  async function member(id) {
    if (!UUID.test(id || '')) throw failure(400, 'Invalid account.');
    if (!db.isConnected()) throw failure(503, 'Usage storage is temporarily unavailable.');
    const { rows: [user] } = await db.query('SELECT id,name,created_at AS "createdAt",COALESCE(onboarding_complete,false) AS onboarded FROM users WHERE id=$1', [id]);
    if (!user) throw failure(404, 'Account not found.');
    return user;
  }
  async function usage(id, query = {}) {
    const days = query.days == null ? 30 : Number(query.days);
    if (![7, 30].includes(days)) throw failure(400, 'Choose 7 or 30 days.');
    const user = await member(id), to = new Date(now()).toISOString();
    const from = new Date(Date.parse(to.slice(0, 10)) - (days - 1) * 86400000).toISOString();
    const [counts, daily, affinity, generation] = await Promise.all([
      db.query(`SELECT
        (SELECT COUNT(*) FROM community_posts WHERE author_id=$1::text AND source='uficonnect' AND created_at BETWEEN $2::timestamptz AND $3::timestamptz) AS posts,
        (SELECT COUNT(*) FROM post_comments WHERE author_id=$1::text AND created_at BETWEEN $2::timestamptz AND $3::timestamptz) AS comments,
        (SELECT COUNT(*) FROM source_interaction_audit WHERE user_id=$1::uuid AND created_at BETWEEN $2::timestamptz AND $3::timestamptz) AS source_actions,
        (SELECT COUNT(*) FROM saved_posts WHERE user_id=$1::text AND created_at BETWEEN $2::timestamptz AND $3::timestamptz) AS saved_posts,
        (SELECT COUNT(DISTINCT post_id) FROM seen_posts WHERE user_id=$1::text AND seen_at BETWEEN $2::timestamptz AND $3::timestamptz) AS delivered_posts,
        (SELECT COUNT(DISTINCT post_id) FROM seen_posts WHERE user_id=$1::text AND engaged_at BETWEEN $2::timestamptz AND $3::timestamptz) AS engaged_posts,
        (SELECT MAX(recorded_at) FROM (
          SELECT MAX(seen_at) AS recorded_at FROM seen_posts WHERE user_id=$1::text AND seen_at <= $3::timestamptz
          UNION ALL SELECT MAX(created_at) FROM community_posts WHERE author_id=$1::text AND created_at <= $3::timestamptz
          UNION ALL SELECT MAX(created_at) FROM post_comments WHERE author_id=$1::text AND created_at <= $3::timestamptz
          UNION ALL SELECT MAX(created_at) FROM source_interaction_audit WHERE user_id=$1::uuid AND created_at <= $3::timestamptz
        ) recorded) AS last_recorded_at`, [id, from, to]),
      db.query(`SELECT day,SUM(posts)::int AS posts,SUM(comments)::int AS comments,SUM(actions)::int AS "sourceActions" FROM (
        SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,COUNT(*) AS posts,0::bigint AS comments,0::bigint AS actions FROM community_posts WHERE author_id=$1::text AND source='uficonnect' AND created_at BETWEEN $2::timestamptz AND $3::timestamptz GROUP BY 1
        UNION ALL SELECT (created_at AT TIME ZONE 'UTC')::date::text,0,COUNT(*),0 FROM post_comments WHERE author_id=$1::text AND created_at BETWEEN $2::timestamptz AND $3::timestamptz GROUP BY 1
        UNION ALL SELECT (created_at AT TIME ZONE 'UTC')::date::text,0,0,COUNT(*) FROM source_interaction_audit WHERE user_id=$1::uuid AND created_at BETWEEN $2::timestamptz AND $3::timestamptz GROUP BY 1
      ) activity GROUP BY day ORDER BY day`, [id, from, to]),
      db.query('SELECT affinity_key,weight,updated_at FROM user_engagement_affinity WHERE user_id=$1 ORDER BY weight DESC,affinity_key LIMIT 100', [id]),
      generationUsage.usage(id),
    ]);
    const row = counts.rows[0] || {}, n = key => Number(row[key] || 0);
    const dailyMap = new Map(daily.rows.map(item => [item.day, item]));
    const activity = { posts: n('posts'), comments: n('comments'), sourceActions: n('source_actions'), savedPosts: n('saved_posts'), deliveredPosts: n('delivered_posts'), engagedPosts: n('engaged_posts'), lastRecordedAt: row.last_recorded_at || null,
      daily: Array.from({ length: days }, (_, i) => { const day = new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10); return { day, posts: 0, comments: 0, sourceActions: 0, ...dailyMap.get(day) }; }) };
    const recommendations = [];
    if (!user.onboarded) recommendations.push('Complete onboarding and choose interests to improve personalized feed relevance.');
    if (affinity.rows.some(item => Number(item.weight) > 1000)) recommendations.push('Learned interests are concentrated. Balance learned interests to reduce dominant weights.');
    if (activity.deliveredPosts && !activity.engagedPosts) recommendations.push('Posts have been delivered but no retained engagement is recorded. Review chosen topics before increasing refresh frequency.');
    for (const [kind, limit] of Object.entries(generation.limits || {})) if (limit.remaining <= limit.limit * 0.2) recommendations.push(`${kind} generation is near its monthly limit. Reuse existing drafts or media before generating more.`);
    if (!recommendations.length) recommendations.push('No optimization issue was identified in the retained usage records. Refresh feed caches if this member reports stale results.');
    return { available: true, generatedAt: to, user, days, range: { from, to }, activity, generation,
      affinity: affinity.rows.filter(item => /^(src|topic):/.test(item.affinity_key)).map(item => ({ kind: item.affinity_key.startsWith('src:') ? 'source' : 'topic', label: item.affinity_key.replace(/^(src|topic):/, ''), weight: Number(item.weight), updatedAt: item.updated_at })),
      commands: COMMANDS, recommendations, note: 'Retained account activity only. Delivered posts are unique posts served, not verified views or time spent. Missing or expired history cannot be reconstructed. Generation usage follows the UTC calendar month.' };
  }
  async function optimize(id, body = {}) {
    await member(id);
    if (body.confirmed !== true || !COMMANDS.some(item => item.id === body.command) || Object.keys(body).some(key => !['command', 'confirmed'].includes(key))) throw failure(400, 'Choose and confirm a supported usage command.');
    // One atomic statement changes weights and publishes cache invalidation.
    const { rows: [result] } = await db.query(`WITH balanced AS (
      UPDATE user_engagement_affinity SET weight=1000,updated_at=NOW()
      WHERE user_id=$1::text AND $2='balance-interests' AND weight>1000 AND (affinity_key LIKE 'src:%' OR affinity_key LIKE 'topic:%') RETURNING affinity_key
    ), revision AS (
      INSERT INTO office_user_usage_revision(user_id,command) VALUES($1::uuid,$2)
      ON CONFLICT(user_id) DO UPDATE SET version=office_user_usage_revision.version+1,command=EXCLUDED.command,updated_at=NOW() RETURNING version
    ) SELECT (SELECT COUNT(*)::int FROM balanced) AS balanced,version FROM revision`, [id, body.command]);
    invalidateUser(id); revisions.set(id, String(result.version));
    return { ok: true, command: body.command, balanced: Number(result.balanced), cacheRefresh: 'Published to API workers; normally applied within five seconds.', message: body.command === 'balance-interests' ? `Capped ${result.balanced} learned weights and requested a feed refresh.` : 'Requested a fresh personalized and connected feed for this user.' };
  }
  return { usage, optimize, refreshRevisions };
}
function registerOfficeUserUsageRoutes(app, { requireOfficeToken, ...options }) {
  const service = createOfficeUserUsage(options);
  const privateResponse = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
  const route = action => async (req, res) => { try { res.json(await action(req)); } catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Usage tools are temporarily unavailable.' }); } };
  const limit = rateLimit({ windowMs: 60000, limit: 20, standardHeaders: true, legacyHeaders: false });
  app.get('/office/users/:id/usage', privateResponse, requireOfficeToken, route(req => service.usage(req.params.id, req.query)));
  app.post('/office/users/:id/optimize', privateResponse, requireOfficeToken, limit, route(req => service.optimize(req.params.id, req.body)));
  return service;
}
module.exports = { OFFICE_USER_USAGE_SCHEMA, createOfficeUserUsage, registerOfficeUserUsageRoutes };
