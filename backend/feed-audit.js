'use strict';

const { createHash } = require('node:crypto');
const { safeUrl } = require('./post-pipeline');
const { DEFAULT_SOURCE_PULL_LIMITS, LEGACY_SLOW_SOURCE_PULL_LIMITS, normalizeSourcePullLimits, sourcePullLimit } = require('./source-pull-limits');
const DEFAULT_POLICY = Object.freeze({ enabled: true, maxPerSourcePerMinute: 300,
  maxPerAuthorPerMinute: 25, duplicateWindowSeconds: 300, targetApprovalPct: 85,
  minimumSample: 30, cooldownSeconds: 60, sourcePullLimits: DEFAULT_SOURCE_PULL_LIMITS });
const MAX_EVENTS = 10000;
const REASONS = {
  spam_or_solicitation: 'Language matched a solicitation or scam pattern. Review the quoted content before deciding whether the source needs blocking.',
  repetitive_content: 'An excessive repeated character or word pattern was found.',
  link_spam: 'The title or content contains more than four links.',
  link_only_content: 'The post contains links without readable text or media.',
  source_blocked: 'An Office administrator blocked this source. It cannot enter or appear in the feed.',
  source_flood: 'This source exceeded its allowed new posts per minute.',
  author_flood: 'This author exceeded the allowed new posts per source per minute.',
  duplicate_content: 'Another post from this source recently contained the same text.',
  approval_cooldown: 'Recent evaluated items from this source fell below the approval target. New intake is paused for a short cooldown.',
  policy_unavailable: 'Source policy is unavailable. Imported content is held until it can be checked.',
  previously_blocked: 'The item already has a blocked screening status.',
  invalid_post: 'The source did not supply a valid post object.',
  missing_identity: 'The post identifier or source is missing.',
  empty_content: 'The post has no readable title or content.',
  placeholder_content: 'Only a placeholder such as “coming soon” was supplied.',
  too_long: 'The text exceeded the permitted content length.',
  unsafe_url: 'A link uses an unsafe scheme.',
  invalid_source_url: 'The original source link is not a valid HTTP or HTTPS URL.',
  missing_source_url: 'An imported post has no original source link.',
  invalid_media_url: 'The media link is not a valid HTTP or HTTPS URL.',
  invalid_timestamp: 'The post timestamp could not be read.',
  future_timestamp: 'The post timestamp is more than fifteen minutes in the future.',
};
const clean = (v, max = 500) => String(v ?? '').replace(/\u0000/g, '').slice(0, max).toWellFormed();
const sourceId = value => { const id = clean(value, 80).trim().toLowerCase(); return id === 'hn' ? 'hackernews' : id; };
const digest = value => createHash('sha256').update(value).digest('hex');
function normalizePolicy(settings, current = DEFAULT_POLICY) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Provide anti-flood settings.');
  const limits = { maxPerSourcePerMinute: [1, 10000], maxPerAuthorPerMinute: [1, 1000], duplicateWindowSeconds: [10, 3600], targetApprovalPct: [1, 100], minimumSample: [5, 1000], cooldownSeconds: [10, 3600] };
  const next = structuredClone(current);
  for (const [key, value] of Object.entries(settings)) {
    if (key === 'enabled') { if (typeof value !== 'boolean') throw new Error('Enabled must be true or false.'); next.enabled = value; continue; }
    if (key === 'sourcePullLimits') { next.sourcePullLimits = normalizeSourcePullLimits(value, current.sourcePullLimits || {}); continue; }
    if (!limits[key]) throw new Error(`Unknown anti-flood setting: ${key}`);
    if (!Number.isInteger(value) || value < limits[key][0] || value > limits[key][1]) throw new Error(`Invalid ${key}; use ${limits[key].join(' to ')}.`);
    next[key] = value;
  }
  return next;
}

// Run after every API and Pipeline instance supports the new pull ceilings.
// Startup only reads existing policy so a rolling deployment cannot interrupt
// older instances with a policy format or limit they do not understand.
async function migrateLegacySourcePullLimits(db) {
  // Upgrade only the previous shipped defaults, once. This operates on the
  // locked current row, so a concurrent administrator edit is not overwritten.
  // Later explicit slower ceilings remain valid, including the old values.
  await db.query(`WITH migration AS (SELECT $1::jsonb AS previous, $2::jsonb AS next)
    UPDATE office_feed_policy SET settings=jsonb_set(settings, '{sourcePullLimits}',
    COALESCE((SELECT jsonb_object_agg(key, CASE WHEN value = (migration.previous -> key)
      THEN migration.next -> key ELSE value END)
      FROM jsonb_each(COALESCE(settings->'sourcePullLimits','{}'::jsonb))), '{}'::jsonb), true)
    || '{"sourcePullLimitsVersion":2}'::jsonb, updated_at=NOW()
    FROM migration
    WHERE id=1 AND NOT (settings ? 'sourcePullLimitsVersion')
      AND (NOT (settings ? 'sourcePullLimits') OR jsonb_typeof(settings->'sourcePullLimits')='object')`,
    [JSON.stringify(LEGACY_SLOW_SOURCE_PULL_LIMITS), JSON.stringify(DEFAULT_SOURCE_PULL_LIMITS)]);
}

function createFeedAudit(db, { role = 'api', now = Date.now, schedule = setTimeout, requirePolicy = false, onPolicyChange = () => {} } = {}) {
  let policy = normalizePolicy({}), blocked = new Map(), ready = !requirePolicy;
  let pending = new Map(), recent = new Map(), timer = null, flushing = false, lastCleanup = 0;
  let lastPolicyVersion = '', reloadInFlight = null;
  const sourceRates = new Map(), authorRates = new Map(), duplicateTexts = new Map(), quality = new Map(), cooldowns = new Map(), admissions = new Map();
  const totals = { checked: 0, approved: 0, rejected: 0, held: 0, byReason: {}, lastCheckedAt: null, lastRejected: null };
  const health = { droppedEvents: 0, lastError: null, policyError: null, lastPersistedAt: null, policyRefreshedAt: null };
  const policySnapshot = () => structuredClone({ ...policy, blockedSources: [...blocked.values()], syncIntervalSeconds: 5 });
  const scope = 'Unique post content and outcome observed by this process; held intake is separate from screened approval. Historical events are retained for 7 days, up to 10,000 records.';
  const summary = () => ({ ...totals, byReason: { ...totals.byReason }, approvalPct: totals.checked ? Math.round(totals.approved / totals.checked * 1000) / 10 : null, scope });
  async function initialize() {
    if (!db.isConnected()) return;
    await db.query(`CREATE TABLE IF NOT EXISTS office_feed_policy (id INTEGER PRIMARY KEY CHECK(id=1), settings JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`INSERT INTO office_feed_policy(id, settings) VALUES (1,$1::jsonb) ON CONFLICT DO NOTHING`,
      [JSON.stringify({ ...DEFAULT_POLICY, sourcePullLimitsVersion: 2 })]);
    await db.query(`CREATE TABLE IF NOT EXISTS office_feed_source_blocks (source TEXT PRIMARY KEY, reason TEXT NOT NULL, blocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`CREATE TABLE IF NOT EXISTS office_feed_audit (id TEXT PRIMARY KEY, post_id TEXT, source TEXT NOT NULL, title TEXT, content TEXT, source_url TEXT, status TEXT NOT NULL, reason TEXT, role TEXT, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`CREATE INDEX IF NOT EXISTS office_feed_audit_time ON office_feed_audit(occurred_at DESC, id DESC)`);
    await reload();
  }
  async function reload() {
    if (reloadInFlight) return reloadInFlight;
    reloadInFlight = (async () => {
      if (!db.isConnected()) throw new Error('Feed policy database is unavailable.');
      const [settings, sources] = await Promise.all([
        db.query('SELECT settings, updated_at FROM office_feed_policy WHERE id=1'),
        db.query('SELECT source, reason, blocked_at FROM office_feed_source_blocks ORDER BY source'),
      ]);
      if (!settings.rows[0]) throw new Error('Feed policy has not initialized.');
      const { sourcePullLimitsVersion, ...storedPolicy } = settings.rows[0].settings;
      const next = normalizePolicy(storedPolicy);
      const nextBlocked = sources.rows.map(row => ({ source: row.source, reason: row.reason, blockedAt: row.blocked_at }));
      const version = JSON.stringify([next, nextBlocked]);
      policy = next; blocked = new Map(nextBlocked.map(row => [row.source, row])); ready = true;
      health.policyError = null;
      health.policyRefreshedAt = new Date(now()).toISOString();
      if (lastPolicyVersion !== version) { lastPolicyVersion = version; onPolicyChange(policySnapshot()); }
      return policySnapshot();
    })();
    try { return await reloadInFlight; }
    catch (error) { health.policyError = 'Source policy refresh failed; the last confirmed policy is retained for up to 30 seconds.'; throw error; }
    finally { reloadInFlight = null; }
  }
  function access(post) {
    if (post?.source === 'uficonnect') return { allowed: true };
    if (!ready || (requirePolicy && health.policyRefreshedAt && now() - Date.parse(health.policyRefreshedAt) > 30000)) return { allowed: false, reason: 'policy_unavailable' };
    return blocked.has(sourceId(post?.source)) ? { allowed: false, reason: 'source_blocked' } : { allowed: true };
  }
  function enqueue() {
    if (timer || flushing || !pending.size) return;
    timer = schedule(() => { timer = null; void flush(); }, health.lastError ? 5000 : 750); timer?.unref?.();
  }
  function record(post, result, status = result.allowed ? 'approved' : 'rejected') {
    const reason = result.reason || null;
    const evaluated = result.post || post;
    const identity = [evaluated?.id, sourceId(evaluated?.source), evaluated?.title, evaluated?.content, evaluated?.sourceUrl, status, reason];
    const id = digest(JSON.stringify(identity));
    if (recent.has(id)) return;
    const at = new Date(now()).toISOString();
    const item = { id, postId: clean(post?.id, 1000), source: sourceId(post?.source) || 'unknown',
      title: clean(post?.title), content: clean(post?.content, status === 'approved' ? 500 : 6000),
      contentTruncated: String(post?.content || '').length > (status === 'approved' ? 500 : 6000),
      sourceUrl: safeUrl(post?.sourceUrl), status, reason, explanation: REASONS[reason] || 'Passed current deterministic content checks.', at };
    recent.set(id, item); pending.set(id, item);
    while (recent.size > MAX_EVENTS) recent.delete(recent.keys().next().value);
    while (pending.size > 2000) { pending.delete(pending.keys().next().value); health.droppedEvents++; }
    if (status === 'held') totals.held++;
    else { totals.checked++; totals[status]++; totals.lastCheckedAt = at; }
    if (reason) totals.byReason[reason] = (totals.byReason[reason] || 0) + 1;
    if (status === 'rejected') totals.lastRejected = { id: item.postId, source: item.source, reason, at };
    if (status !== 'held' && !['source_blocked', 'policy_unavailable'].includes(reason)) {
      const outcomes = quality.get(item.source) || [];
      outcomes.push({ approved: status === 'approved', at: now() });
      boundedSet(quality, item.source, outcomes.filter(value => value.at > now() - 300000).slice(-Math.max(100, policy.minimumSample)), 1000);
    }
    enqueue();
  }
  function boundedSet(map, key, value, max = 20000) { map.set(key, value); while (map.size > max) map.delete(map.keys().next().value); }
  function countRate(map, key) {
    const current = map.get(key);
    const rate = !current || now() - current.start >= 60000 ? { start: now(), count: 0 } : current;
    boundedSet(map, key, rate); return rate;
  }
  function sourceCooldown(source) {
    const cooldown = cooldowns.get(source);
    if (cooldown && cooldown > now()) return cooldown;
    if (cooldown) { cooldowns.delete(source); quality.delete(source); }
    const outcomes = (quality.get(source) || []).filter(value => value.at > now() - 300000);
    if (outcomes.length >= policy.minimumSample && outcomes.filter(value => value.approved).length * 100 / outcomes.length < policy.targetApprovalPct) {
      const until = now() + policy.cooldownSeconds * 1000;
      boundedSet(cooldowns, source, until, 1000); return until;
    }
    return null;
  }
  // Scheduling checks do not spend admission capacity or invent audit records.
  // Provider pull ceilings still apply when the optional post flood guard is off.
  function collectionState(value) {
    const source = sourceId(value);
    const minSpacingMs = sourcePullLimit(source, policy.sourcePullLimits).minSpacingMs;
    const permission = access({ source });
    if (!permission.allowed) return { ...permission, remaining: 0, retryAt: null, minSpacingMs };
    if (!policy.enabled || source === 'uficonnect') return { allowed: true, reason: null, remaining: null, retryAt: null, minSpacingMs };
    const rate = sourceRates.get(source);
    const activeRate = rate && now() - rate.start < 60000 ? rate : null;
    const remaining = Math.max(0, policy.maxPerSourcePerMinute - (activeRate?.count || 0));
    const cooldown = sourceCooldown(source);
    if (cooldown) return { allowed: false, reason: 'approval_cooldown', remaining, retryAt: cooldown, minSpacingMs };
    if (!remaining) return { allowed: false, reason: 'source_flood', remaining, retryAt: activeRate.start + 60000, minSpacingMs };
    return { allowed: true, reason: null, remaining, retryAt: null, minSpacingMs };
  }
  function authorIdentity(post, source) {
    if (post?.author?.isUnknown === true) return '';
    const author = post?.author || {};
    const id = clean(author.id, 200).trim().toLowerCase();
    if (id === `${source}_author`) {
      const name = clean(author.name, 200).trim().toLowerCase();
      const sourceNames = [source, post?.sourceLabel, author.title, author.organization].map(value => clean(value, 200).trim().toLowerCase());
      return name && !sourceNames.includes(name) ? name : '';
    }
    return clean(author.id || author.username || author.name || '', 200).trim().toLowerCase();
  }
  function admit(post) {
    const permission = access(post);
    if (!permission.allowed) { record(post, permission, permission.reason === 'policy_unavailable' ? 'held' : 'rejected'); return permission; }
    if (!policy.enabled || post?.source === 'uficonnect') return { allowed: true };
    const source = sourceId(post?.source), key = digest(JSON.stringify([source, post?.id]));
    // Remember accepted items so a delivery retry cannot charge the same ID twice.
    if ((admissions.get(key) || 0) > now()) return { allowed: true };
    const hold = (reason, retryAt = null) => {
      const result = { allowed: false, reason, ...(Number.isFinite(retryAt) ? { retryAt } : {}) };
      record(post, result, 'held'); return result;
    };
    const collection = collectionState(source);
    if (!collection.allowed) return hold(collection.reason, collection.retryAt);
    const sourceRate = countRate(sourceRates, source);
    const author = authorIdentity(post, source);
    const authorRate = author ? countRate(authorRates, `${source}:${author}`) : null;
    if (authorRate && authorRate.count >= policy.maxPerAuthorPerMinute) return hold('author_flood', authorRate.start + 60000);
    const normalizedText = `${post?.title || ''} ${post?.content || ''}`.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    const contentKey = digest(`${source}:${normalizedText}`);
    const duplicate = duplicateTexts.get(contentKey);
    if (normalizedText.length > 30 && duplicate && duplicate.until > now() && duplicate.id !== String(post?.id)) return hold('duplicate_content');
    sourceRate.count++; if (authorRate) authorRate.count++;
    boundedSet(duplicateTexts, contentKey, { id: String(post?.id), until: now() + policy.duplicateWindowSeconds * 1000 });
    boundedSet(admissions, key, now() + 300000);
    return { allowed: true };
  }
  async function flush() {
    if (flushing || !pending.size) return;
    if (!db.isConnected()) { health.lastError = 'Audit database unavailable'; enqueue(); return; }
    flushing = true;
    const batch = [...pending.values()].slice(0, 500);
    try {
      await db.query(`INSERT INTO office_feed_audit(id,post_id,source,title,content,source_url,status,reason,role,occurred_at)
        SELECT id,"postId",source,title,content,"sourceUrl",status,reason,$2,at::timestamptz
        FROM jsonb_to_recordset($1::jsonb) AS x(id TEXT,"postId" TEXT,source TEXT,title TEXT,content TEXT,"sourceUrl" TEXT,status TEXT,reason TEXT,at TEXT)
        ON CONFLICT(id) DO NOTHING`, [JSON.stringify(batch), role]);
      batch.forEach(item => pending.delete(item.id)); health.lastError = null; health.lastPersistedAt = new Date(now()).toISOString();
      if (now() - lastCleanup > 60000) {
        await db.query(`DELETE FROM office_feed_audit WHERE occurred_at < NOW() - INTERVAL '7 days'
          OR id IN (SELECT id FROM office_feed_audit ORDER BY occurred_at DESC,id DESC OFFSET ${MAX_EVENTS})`);
        lastCleanup = now();
      }
    } catch { health.lastError = 'Audit history could not be persisted; bounded retry is pending.'; }
    finally { flushing = false; enqueue(); }
  }
  const itemFromRow = row => ({ id: row.id, postId: row.post_id, source: row.source, title: row.title, content: row.content,
    sourceUrl: safeUrl(row.source_url), status: row.status, reason: row.reason, explanation: REASONS[row.reason] || 'Passed current deterministic content checks.', at: row.occurred_at,
    contentTruncated: String(row.content || '').length >= (row.status === 'approved' ? 500 : 6000) });
  async function list(query = {}) {
    await reload(); await flush();
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 40));
    const offset = Math.min(MAX_EVENTS, Math.max(0, parseInt(query.offset, 10) || 0));
    if (query.status && !['all', 'approved', 'rejected', 'held'].includes(query.status)) throw new Error('Invalid audit status.');
    const params = [], where = [], bind = value => { params.push(value); return `$${params.length}`; };
    if (query.status && query.status !== 'all') where.push(`status=${bind(query.status)}`);
    if (query.source) where.push(`source=${bind(sourceId(query.source))}`);
    if (query.reason) where.push(`reason=${bind(clean(query.reason, 80))}`);
    if (query.q) { const term = bind('%' + clean(query.q, 200).replace(/[\\%_]/g, '\\$&') + '%'); where.push(`(title ILIKE ${term} OR content ILIKE ${term} OR post_id ILIKE ${term})`); }
    const { rows } = await db.query(`SELECT * FROM office_feed_audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY occurred_at DESC,id DESC LIMIT ${bind(limit + 1)} OFFSET ${bind(offset)}`, params);
    const counts = await db.query(`SELECT status,reason,COUNT(*)::int AS count FROM office_feed_audit GROUP BY status,reason`);
    const aggregate = { checked: 0, approved: 0, rejected: 0, held: 0, byReason: {} };
    for (const row of counts.rows) { const count = Number(row.count); aggregate[row.status] += count; if (row.status !== 'held') aggregate.checked += count; if (row.reason) aggregate.byReason[row.reason] = (aggregate.byReason[row.reason] || 0) + count; }
    aggregate.approvalPct = aggregate.checked ? Math.round(aggregate.approved / aggregate.checked * 1000) / 10 : null;
    aggregate.scope = 'All retained unique content/outcome records across API and pipeline, before filters; up to 10,000 records over 7 days. Held intake is not counted as screened approval.';
    return { items: rows.slice(0, limit).map(itemFromRow), hasMore: rows.length > limit, offset, limit, summary: aggregate,
      policy: policySnapshot(), health: status(), reasons: Object.entries(REASONS).map(([id, explanation]) => ({ id, label: id.replaceAll('_', ' '), explanation })),
      coverage: { retentionDays: 7, maxEvents: MAX_EVENTS, rejectedContentMaxChars: 6000 } };
  }
  async function detail(id) { const { rows } = await db.query('SELECT * FROM office_feed_audit WHERE id=$1', [clean(id, 64)]); return rows[0] ? itemFromRow(rows[0]) : recent.get(id) || null; }
  async function refreshAfterWrite() {
    // A periodic reload may have selected a snapshot before this write. Let
    // that read finish, then enforce and return a freshly selected policy.
    try { await reloadInFlight; } catch { /* The fresh read below reports any continuing failure. */ }
    return reload();
  }
  async function configure(settings) {
    const validated = normalizePolicy(settings, {});
    // Merge nested source entries in SQL too: simultaneous updates to different
    // sources must not replace one another's freshly persisted pull ceiling.
    await db.query(`UPDATE office_feed_policy SET settings=(settings || ($1::jsonb - 'sourcePullLimits'))
      || CASE WHEN $1::jsonb ? 'sourcePullLimits' THEN jsonb_build_object('sourcePullLimits',
        COALESCE(settings->'sourcePullLimits','{}'::jsonb) || ($1::jsonb->'sourcePullLimits')) ELSE '{}'::jsonb END,
      updated_at=NOW() WHERE id=1`, [JSON.stringify(validated)]);
    await refreshAfterWrite(); return policySnapshot();
  }
  async function block(source, reason) {
    const id = sourceId(source), explanation = clean(reason, 500).trim();
    if (!/^[a-z0-9][a-z0-9_-]{1,79}$/.test(id) || id === 'uficonnect') throw new Error('Choose a supported external source.');
    if (!explanation) throw new Error('Provide a reason for blocking the source.');
    await db.query(`INSERT INTO office_feed_source_blocks(source,reason) VALUES($1,$2) ON CONFLICT(source) DO UPDATE SET reason=EXCLUDED.reason,blocked_at=NOW()`, [id, explanation]);
    await refreshAfterWrite(); return policySnapshot();
  }
  async function unblock(source) { await db.query('DELETE FROM office_feed_source_blocks WHERE source=$1', [sourceId(source)]); await refreshAfterWrite(); return policySnapshot(); }
  function status() { return { ...health, pendingEvents: pending.size, policyReady: ready, cooldowns: [...cooldowns].filter(([, until]) => until > now()).map(([source, until]) => ({ source, until: new Date(until).toISOString() })) }; }
  return { initialize, reload, access, record, admit, collectionState, flush, list, detail, configure, block, unblock, summary, policy: policySnapshot, status };
}

module.exports = { migrateLegacySourcePullLimits, createFeedAudit, DEFAULT_POLICY, normalizePolicy, REASONS };
