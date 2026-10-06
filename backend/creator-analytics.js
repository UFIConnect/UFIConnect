'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { listSourcePolicies, getSourcePolicy, validateOriginalUrl, normalizeSource } = require('./source-policy');
const { analyzeActivity } = require('./activity-learning');
const DAY = 86400000;
const CREATOR_ANALYTICS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS creator_source_snapshots (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL, period_days INTEGER NOT NULL CHECK(period_days IN (7,30)),
    connection_hash TEXT NOT NULL, data JSONB NOT NULL, fetched_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(user_id,source,period_days))`,
  `CREATE TABLE IF NOT EXISTS source_interaction_audit (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, source TEXT NOT NULL, source_post_id TEXT NOT NULL,
    action TEXT NOT NULL, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(user_id,request_id))`,
  `CREATE INDEX IF NOT EXISTS source_interaction_audit_date ON source_interaction_audit(created_at)`,
  `CREATE TABLE IF NOT EXISTS source_interaction_requests (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id TEXT NOT NULL,
    request_hash TEXT NOT NULL, response JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,request_id))`,
  `CREATE TABLE IF NOT EXISTS creator_copyright_reports (
    id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL, source_url TEXT NOT NULL, reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'received', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS creator_copyright_reports_owner ON creator_copyright_reports(user_id,created_at)`,
];
const failure = (status, message) => Object.assign(new Error(message), { status });
function period(value) {
  if (value === undefined || value === '30' || value === 30) return 30;
  if (value === '7' || value === 7) return 7;
  throw failure(400, 'Choose a 7 or 30 day report.');
}
function count(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
const emptyMetrics = () => ({ views: null, likes: null, comments: null, posts: null });
const connectionHash = (user, source) => createHash('sha256').update(JSON.stringify([user.socialTokens?.[source], user.socialConnectedAt?.[source]])).digest('hex');
const dayOf = value => new Date(value).toISOString().slice(0, 10);

async function providerJSON(fetchImpl, url, token) {
  let response;
  try { response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(8000) }); }
  catch { throw failure(502, 'The source did not respond.'); }
  if (!response.ok) throw failure([401,403].includes(response.status) ? 403 : response.status === 429 ? 429 : 502,
    [401,403].includes(response.status) ? 'Reconnect with the required source permissions.' : 'Source metrics are temporarily unavailable.');
  const reader = response.body?.getReader();
  let text;
  if (reader) {
    let length = 0; const chunks = [];
    try {
      while (true) { const result = await reader.read(); if (result.done) break;
        length += result.value.byteLength; if (length > 128 * 1024) throw failure(502, 'Source response exceeded the supported size.'); chunks.push(Buffer.from(result.value)); }
      text = Buffer.concat(chunks).toString('utf8');
    } finally { await reader.cancel().catch(() => {}); }
  } else { text = await response.text(); if (Buffer.byteLength(text) > 128 * 1024) throw failure(502, 'Source response exceeded the supported size.'); }
  try { return JSON.parse(text); } catch { throw failure(502, 'The source returned an invalid response.'); }
}

async function collectYouTube({ user, days, now, fetchImpl, features = {} }) {
  const token = user.socialTokens.youtube;
  const channelData = await providerJSON(fetchImpl, 'https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', token);
  if (channelData.items?.length !== 1 || !/^UC[\w-]{22}$/.test(channelData.items[0].id || '')) throw failure(403, 'No single authorized YouTube channel was returned.');
  const channel = channelData.items[0];
  const result = { metrics: { ...emptyMetrics(), views: count(channel.statistics?.viewCount), posts: count(channel.statistics?.videoCount) },
    metricScope: 'Current channel totals reported by YouTube; not selected-period traffic or UFIConnect-attributed views.',
    originalUrl: `https://www.youtube.com/channel/${channel.id}`, revenue: { amount: null, currency: null, status: 'requires_permission' },
    periodMetrics: null, reason: 'Channel totals from the official YouTube Data API.' };
  const range = { startDate: dayOf(now - days * DAY), endDate: dayOf(now - DAY) };
  const query = new URLSearchParams({ ids: 'channel==MINE', ...range, metrics: 'views,likes,comments' });
  if (features.creatorAnalytics) try {
    const data = await providerJSON(fetchImpl, `https://youtubeanalytics.googleapis.com/v2/reports?${query}`, token);
    const headers = data.columnHeaders?.map(item => item.name) || [];
    if (Array.isArray(data.rows) && data.rows.length === 1 && ['views','likes','comments'].every(name => headers.includes(name))) {
      result.periodMetrics = Object.fromEntries(['views','likes','comments'].map(name => [name, count(data.rows[0][headers.indexOf(name)])]));
      result.periodRange = range;
    }
  } catch { /* Channel totals remain valid; unavailable analytics stay null. */ }
  if (features.sourceMonetization) try {
    const query = new URLSearchParams({ ids: 'channel==MINE', ...range, metrics: 'estimatedRevenue', currency: 'USD' });
    const data = await providerJSON(fetchImpl, `https://youtubeanalytics.googleapis.com/v2/reports?${query}`, token);
    const index = data.columnHeaders?.findIndex(item => item.name === 'estimatedRevenue');
    const value = index >= 0 && data.rows?.length === 1 ? data.rows[0][index] : null;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) result.revenue = { amount: value, currency: 'USD', status: 'estimated', ...range,
      note: 'YouTube estimated revenue; subject to reporting delays and adjustments. This is not a UFIConnect payout.' };
  } catch { /* Never infer revenue from views, likes or ad rates. */ }
  return result;
}

function createCreatorAnalytics({ db, getUser, fetchImpl = fetch, env = process.env, now = Date.now,
  localPreview = false, getLocalPosts = () => [], getLocalComments = () => [], vaultStatus = async () => null }) {
  const localReports = [];
  const inFlight = new Map();
  const preview = localPreview && env.NODE_ENV !== 'production';
  let lastPrune = 0;
  async function prune() {
    if (!db.isConnected() || now() - lastPrune < 3600000) return;
    const snapshotRetention = Math.min(...listSourcePolicies({ env }).map(policy => policy.rules.caching.metricSnapshotRetentionMs));
    await db.query(`DELETE FROM creator_source_snapshots WHERE fetched_at < $1`, [new Date(now() - snapshotRetention).toISOString()]);
    await db.query(`DELETE FROM source_interaction_audit WHERE created_at < $1`, [new Date(now() - 30 * DAY).toISOString()]);
    await db.query(`DELETE FROM source_interaction_requests WHERE created_at < $1`, [new Date(now() - 30 * DAY).toISOString()]);
    await db.query(`WITH removed AS (DELETE FROM creator_copyright_reports WHERE created_at < $1 RETURNING id)
      DELETE FROM reports WHERE id IN (SELECT id::text FROM removed)`, [new Date(now() - 90 * DAY).toISOString()]);
    lastPrune = now();
  }
  async function member(id) { const user = await getUser(id); if (!user) throw failure(401, 'Sign in to view analytics.'); return user; }
  async function reserveInteraction({memberId,requestId,fingerprint}) {
    if (!db.isConnected()) throw failure(503,'Source action storage is unavailable.');
    const digest = createHash('sha256').update(fingerprint).digest('hex');
    const claim = await db.query(`INSERT INTO source_interaction_requests(user_id,request_id,request_hash,created_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,request_id) DO NOTHING RETURNING request_id`, [memberId,requestId,digest,new Date(now()).toISOString()]);
    if (claim.rows.length) return null;
    const old = (await db.query('SELECT request_hash,response FROM source_interaction_requests WHERE user_id=$1 AND request_id=$2',[memberId,requestId])).rows[0];
    if (!old || old.request_hash !== digest) return {status:409,body:{message:'This request ID was used for another action.'}};
    return old.response || {status:409,body:{message:'This source request is pending or unconfirmed. Check the original post before starting another request.'}};
  }
  async function completeInteraction({memberId,requestId,result}) {
    const {fallback,...body} = result.body;
    await db.query('UPDATE source_interaction_requests SET response=$3 WHERE user_id=$1 AND request_id=$2',[memberId,requestId,JSON.stringify({...result,body})]);
  }
  async function auditInteraction(event) {
    if (!db.isConnected()) throw failure(503, 'Source audit storage is unavailable.');
    await db.query(`INSERT INTO source_interaction_audit (user_id,request_id,source,source_post_id,action,status,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,request_id) DO UPDATE SET status=EXCLUDED.status`,
    [event.memberId, event.interactionRequestId, event.sourcePlatform, String(event.sourcePostId || '').slice(0,512), event.actionType, event.status, event.timestamp]);
  }
  async function nativeActivity(id, days, user) {
    const start = dayOf(now() - (days - 1) * DAY);
    const trainingStart = dayOf(now() - 30 * DAY);
    if (!db.isConnected()) {
      if (!preview) return { scope: 'your-account', status: 'unavailable', posts: null, likesReceived: null, commentsReceived: null, interactionRequests: null, daily: [], training: [] };
      const posts = getLocalPosts().filter(post => post.authorId === id && String(post.createdAt).slice(0,10) >= start);
      return { scope: 'your-account', status: 'local_preview', posts: posts.length, likesReceived: posts.reduce((sum,post) => sum + (post.likes?.length || 0),0),
        commentsReceived: getLocalComments().filter(comment => posts.some(post => post.id === comment.postId)).length,
        interactionRequests: 0, daily: [], training: [], note: 'Local preview account only; no production activity is connected.' };
    }
    const [totals, daily, audits] = await Promise.all([
      db.query(`SELECT COUNT(*)::integer AS posts, COALESCE(SUM(cardinality(p.likes)),0)::integer AS likes,
        COALESCE(SUM((SELECT COUNT(*) FROM post_comments c WHERE c.post_id=p.id)),0)::integer AS comments
        FROM community_posts p WHERE p.author_id=$1 AND p.source='uficonnect' AND p.created_at >= $2::date AND p.created_at <= $3::timestamptz`, [id,start,new Date(now()).toISOString()]),
      db.query(`SELECT day, SUM(posts)::integer AS posts, SUM(comments)::integer AS comments, SUM(actions)::integer AS actions FROM (
        SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day, COUNT(*) AS posts, 0::bigint AS comments, 0::bigint AS actions
          FROM community_posts WHERE author_id=$1 AND source='uficonnect' AND created_at >= $2::date GROUP BY 1
        UNION ALL SELECT (created_at AT TIME ZONE 'UTC')::date::text,0,COUNT(*),0 FROM post_comments WHERE author_id=$1 AND created_at >= $2::date GROUP BY 1
        UNION ALL SELECT (created_at AT TIME ZONE 'UTC')::date::text,0,0,COUNT(*) FROM source_interaction_audit WHERE user_id=$1::uuid AND created_at >= $2::date GROUP BY 1
      ) activity GROUP BY day ORDER BY day`, [id,trainingStart]),
      db.query(`SELECT COUNT(*)::integer AS count FROM source_interaction_audit WHERE user_id=$1 AND created_at >= $2::date`, [id,start]),
    ]);
    const byDay = new Map(daily.rows.map(row => [row.day,row]));
    const training = Array.from({ length: 31 }, (_, i) => { const day = dayOf(now() - (30-i)*DAY); return { day,posts:0,comments:0,actions:0,...byDay.get(day) }; })
      .filter(row => !user.createdAt || row.day >= dayOf(new Date(user.createdAt).getTime()));
    return { scope: 'your-account', status: 'available', posts: totals.rows[0]?.posts || 0, likesReceived: totals.rows[0]?.likes || 0,
      commentsReceived: totals.rows[0]?.comments || 0, interactionRequests: audits.rows[0]?.count || 0,
      daily: training.filter(row => row.day >= start).map(({day,posts}) => ({day,posts})), training,
      note: 'Posts created in the selected UTC period. Likes and comments are current totals on those posts.' };
  }
  async function report(id, daysValue) {
    const days = period(daysValue), user = await member(id);
    await prune();
    const native = await nativeActivity(id, days, user);
    let snapshots = [], reports = localReports.filter(row => row.userId === id);
    if (db.isConnected()) {
      snapshots = (await db.query('SELECT source, connection_hash, data, fetched_at FROM creator_source_snapshots WHERE user_id=$1 AND period_days=$2', [id,days])).rows;
      reports = (await db.query(`SELECT id,source,source_url AS "sourceUrl",reason,status,created_at AS "createdAt" FROM creator_copyright_reports
        WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`, [id])).rows;
      const invalid = snapshots.filter(row => !user.socialTokens?.[row.source] || row.connection_hash !== connectionHash(user,row.source));
      for (const row of invalid) await db.query('DELETE FROM creator_source_snapshots WHERE user_id=$1 AND source=$2', [id,row.source]);
      snapshots = snapshots.filter(row => !invalid.includes(row));
    }
    const sources = listSourcePolicies({env}).map(policy => {
      const connected = Boolean(user.socialTokens?.[policy.source]);
      const snapshot = snapshots.find(row => row.source === policy.source);
      const allowed = policy.features.sourceAnalytics && policy.enabled;
      const fresh = allowed && connected && snapshot && now() - new Date(snapshot.fetched_at).getTime() < policy.rules.caching.metricSnapshotFreshnessMs;
      return { id:policy.source,label:policy.label,connected,capabilities:policy.features,documentation:policy.documentation,
        status: !connected ? 'not_connected' : !allowed ? 'disabled' : fresh ? snapshot.data.status : snapshot ? 'stale' : policy.source === 'youtube' ? 'not_synced' : 'not_supported',
        lastSyncedAt:snapshot?.fetched_at || null,metrics:emptyMetrics(),revenue:{amount:null,currency:null,status:'unavailable'},
        originalUrl: `https://${policy.hosts?.[0] || 'uficonnect.org'}/`,
        reason: !connected ? 'Connect this source to review available permissions.' : !allowed ? 'Source analytics are disabled by policy.' : policy.source !== 'youtube' ? 'An approved analytics collector is not implemented for this source yet.' : snapshot ? 'Refresh to retrieve current source metrics.' : 'Refresh to retrieve official channel metrics.',
        ...(fresh ? snapshot.data : {}),
        ...(!policy.features.creatorAnalytics ? {periodMetrics:null} : {}),
        ...(!policy.features.sourceMonetization ? {revenue:{amount:null,currency:null,status:'disabled'}} : {}) };
    });
    const deepLearning = analyzeActivity(native.training, {enabled:env.ACTIVITY_LEARNING_ENABLED !== 'false',now:now()});
    delete native.training;
    return { generatedAt:new Date(now()).toISOString(),days,localPreview:preview,sources,uficonnect:native,
      monetization:{plan:user.plan || 'free',status:'account_plan',sourceRevenueAvailable:sources.some(source => source.revenue.amount !== null),
        note:'Your UFIConnect membership funds UFIConnect features. Source advertising, eligibility and creator payouts remain controlled by the original platform.'},
      copyright:{reports:reports.map(({userId,...row}) => row),policy:'Reports enter UFIConnect review only; this does not file a legal notice or a source takedown. The source remains responsible for its content and playback controls.',retentionDays:90},
      security:{rules:['Official APIs and approved players only','No scraping or media extraction','No third-party media rehosting by default','No simulated engagement or locally generated source counts','Original links and source attribution required'],
        credentialStorage:'Connected-account OAuth credentials use the existing server token encryption. Your browser Vault is separate; hardware-rooted protection awaits device integration.',auditRetentionDays:30,vault:await vaultStatus(id)},deepLearning };
  }
  async function refresh(id, daysValue) {
    const days = period(daysValue), user = await member(id);
    if (preview) return { refreshed:0,localPreview:true,message:'Local preview has no connected source credentials.' };
    if (!db.isConnected()) throw failure(503,'Analytics storage is unavailable.');
    const policy = getSourcePolicy('youtube',{env});
    if (!user.socialTokens?.youtube || !policy.enabled || !policy.features.sourceAnalytics) return {refreshed:0,message:'Connect an available analytics source first.'};
    const capturedConnection = connectionHash(user,'youtube');
    const key = `${id}:${days}`;
    if (inFlight.has(key)) return inFlight.get(key);
    if (inFlight.size >= 20) throw failure(503,'Source refresh is busy. Try again shortly.');
    const run = (async () => {
      const previous = (await db.query('SELECT fetched_at FROM creator_source_snapshots WHERE user_id=$1 AND source=$2 AND period_days=$3',[id,'youtube',days])).rows[0];
      if (previous && now() - new Date(previous.fetched_at).getTime() < 60000) return {refreshed:0,message:'Metrics were checked within the last minute.'};
      let data;
      try { data = {status:'available',...await collectYouTube({user,days,now:now(),fetchImpl,features:policy.features})}; }
      catch (error) { data = {status:error.status===403 ? 'requires_permission':'unavailable',metrics:emptyMetrics(),revenue:{amount:null,currency:null,status:'unavailable'},reason:error.status ? error.message:'Source metrics are temporarily unavailable.'}; }
      const current = await member(id);
      if (!current.socialTokens?.youtube || connectionHash(current,'youtube') !== capturedConnection) throw failure(409,'The account connection changed. Refresh again.');
      await db.query(`INSERT INTO creator_source_snapshots(user_id,source,period_days,connection_hash,data,fetched_at) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(user_id,source,period_days) DO UPDATE SET connection_hash=EXCLUDED.connection_hash,data=EXCLUDED.data,fetched_at=EXCLUDED.fetched_at`,
      [id,'youtube',days,capturedConnection,JSON.stringify(data),new Date(now()).toISOString()]);
      return {refreshed:data.status==='available'?1:0,status:data.status};
    })();
    inFlight.set(key,run);
    try { return await run; } finally {inFlight.delete(key);}
  }
  async function copyrightReport(id, body) {
    await member(id);
    if (!body || Object.keys(body).some(key => !['source','sourceUrl','reason'].includes(key))) throw failure(400,'Invalid copyright report.');
    const url = validateOriginalUrl(body.source,body.sourceUrl,{env});
    if (!url || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 2000) throw failure(400,'Use an original source link and a reason between 10 and 2000 characters.');
    const record = {id:randomUUID(),userId:id,source:normalizeSource(body.source),sourceUrl:url,reason:body.reason.trim(),status:preview?'local_preview':'received',createdAt:new Date(now()).toISOString()};
    if (preview) { if (localReports.length >= 200) localReports.shift(); localReports.unshift(record); }
    else {
      if (!db.isConnected()) throw failure(503,'Copyright report storage is unavailable.');
      await db.query(`WITH submitted AS (
        INSERT INTO creator_copyright_reports(id,user_id,source,source_url,reason,status,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
      ) INSERT INTO reports(id,reporter_id,target_type,target_id,reason,details,source,source_url,status,created_at)
        SELECT id::text,user_id::text,'post',source_url,'copyright',reason,source,source_url,'open',created_at FROM submitted`,Object.values(record));
    }
    const {userId,...publicRecord} = record; return publicRecord;
  }
  return {report,refresh,copyrightReport,auditInteraction,reserveInteraction,completeInteraction,prune};
}

function registerCreatorAnalyticsRoutes(app,{service,authenticate,limiter}) {
  const route = fn => async (req,res) => {
    res.set('Cache-Control','private, no-store');
    try {const result = await fn(req); res.json(result);}
    catch(error) {res.status(error.status || 503).json({message:error.status ? error.message:'Analytics are temporarily unavailable.'});}
  };
  app.get('/creator-analytics/report',authenticate,limiter,route(req=>service.report(req.user.id,req.query.days)));
  app.post('/creator-analytics/refresh',authenticate,limiter,route(req=>service.refresh(req.user.id,req.body?.days)));
  app.post('/creator-analytics/copyright-reports',authenticate,limiter,route(req=>service.copyrightReport(req.user.id,req.body)));
}
module.exports = { CREATOR_ANALYTICS_SCHEMA,createCreatorAnalytics,registerCreatorAnalyticsRoutes,collectYouTube,period,count };
