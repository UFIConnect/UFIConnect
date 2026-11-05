'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { jobDescriptionText } = require('./job-content');
const BUSINESS_POST_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS business_posts (
    id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_id UUID NOT NULL, fingerprint TEXT NOT NULL, details JSONB NOT NULL,
    content TEXT NOT NULL, targets JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL,
    native_post_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id,request_id))`,
  `CREATE INDEX IF NOT EXISTS business_posts_owner ON business_posts(user_id,created_at DESC,id)`,
];
const fail = (status, message) => Object.assign(new Error(message), { status });
const text = value => typeof value === 'string' ? value.trim() : '';
const count = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const list = value => text(value).split(/\n+/).map(item => item.replace(/^(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
function normalizeDetails(input = {}, { validatePhoto = () => false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Add the hiring post details.');
  const limits = { title: 150, company: 150, location: 150, pay: 150, description: 1500, duties: 1500, requirements: 1500, applyUrl: 500 };
  const details = {};
  for (const [key, limit] of Object.entries(limits)) {
    details[key] = text(input[key]);
    if (details[key].length > limit) throw fail(400, `${key} is too long.`);
  }
  if (details.title.length < 3 || details.description.length < 20) throw fail(400, 'Add a role title and a description of at least 20 characters.');
  if (details.applyUrl && !safeUrl(details.applyUrl)) throw fail(400, 'Use an https or http application link.');
  if (input.mediaUrl) {
    if (typeof input.mediaUrl !== 'string' || input.mediaUrl.length > 1000 || !safeUrl(input.mediaUrl) || !validatePhoto(input.mediaUrl)) throw fail(400, 'Upload the photo through UFIConnect before attaching it.');
    details.mediaUrl = input.mediaUrl.trim();
  }
  const content = [details.title, details.company, details.location && `Location: ${details.location}`,
    details.pay && `Pay: ${details.pay}`, details.description,
    details.duties && `Responsibilities\n${list(details.duties).map(item => `- ${item}`).join('\n')}`,
    details.requirements && `Requirements\n${list(details.requirements).map(item => `- ${item}`).join('\n')}`,
    details.applyUrl && `Apply: ${details.applyUrl}`].filter(Boolean).join('\n\n');
  if (content.length > 2000) throw fail(400, 'Keep the complete hiring post within 2,000 characters.');
  return { details, content };
}
function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
const stop = new Set('a an and are as at be by for from in is it of on or our the this to we with you your job jobs role opportunity company hiring senior junior principal staff lead ii iii'.split(' '));
const terms = value => [...new Set(jobDescriptionText(value).toLowerCase().match(/[\p{L}\p{N}+#.]{2,}/gu) || [])].filter(word => !stop.has(word));
const sourceName = url => {
  const host = new URL(url).hostname.replace(/^www\./, '');
  return ({ 'remotive.com': 'Remotive', 'remoteok.com': 'Remote OK', 'themuse.com': 'The Muse', 'usajobs.gov': 'USAJobs', 'weworkremotely.com': 'We Work Remotely' })[host] || host;
};
function comparableJob(job) {
  const url = safeUrl(job.sourceUrl);
  if (!url) return null;
  const content = jobDescriptionText(job.fullDescription || job.description || job.content || '');
  const title = text(job.title), company = text(job.org || job.company || job.author?.name);
  if (title.length < 3 || !content) return null;
  const native = job.source === 'uficonnect';
  const metrics = native ? { likes: count(job.likesCount), comments: count(job.commentsCount), views: null }
    : { likes: null, comments: null, views: null };
  const payLine = content.split('\n').find(line => /^(?:salary|pay|compensation)\s*:/i.test(line));
  return { id: String(job.id), title, company, content, sourceUrl: url,
    source: native ? 'UFIConnect' : sourceName(url), createdAt: job.createdAt || job.posted || null,
    location: text(job.location) || content.match(/(?:^|\n)Location:\s*([^\n]+)/i)?.[1] || '',
    pay: text(job.pay) || payLine?.replace(/^[^:]+:\s*/, '') || '',
    metrics, metricScope: native ? 'Current UFIConnect likes and comments on this post.' : 'This job board does not provide public engagement counts to UFIConnect.' };
}
function compareJobs(post, candidates) {
  const ownTitle = terms(post.details.title), ownBody = new Set(terms(post.content));
  const seen = new Set();
  return candidates.map(comparableJob).filter(job => {
    if (!job || seen.has(job.sourceUrl)) return false;
    seen.add(job.sourceUrl); return true;
  }).map(job => {
    const titleTerms = new Set(terms(job.title));
    const matchingTitle = ownTitle.filter(term => titleTerms.has(term));
    const matchedTerms = terms(job.content).filter(term => ownBody.has(term));
    // Require a role-title match: shared recruiting boilerplate is not similarity.
    const score = matchingTitle.length / Math.max(1, ownTitle.length) * 100 + Math.min(20, matchedTerms.length);
    return { ...job, match: { titleTerms: matchingTitle, sharedTerms: matchedTerms.slice(0, 12) }, score };
  }).filter(job => job.match.titleTerms.length > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

function createBusinessPosts({ db, getUser, screenContent, publishNative, publishLinkedIn, loadJobs, loadHiringPosts = async () => [], validatePhoto = () => false }) {
  async function member(id) {
    const user = await getUser(id);
    if (!user || user.plan !== 'business') throw fail(403, 'Business membership is required.');
    if (!db.isConnected()) throw fail(503, 'Hiring post storage is temporarily unavailable.');
    return user;
  }
  const rowToPost = row => ({ id: row.id, details: row.details, content: row.content, status: row.status,
    targets: row.targets, createdAt: row.created_at, nativePostId: row.native_post_id || null,
    metrics: { likes: row.native_visible ? Number(row.likes_count) : null, comments: row.native_visible ? Number(row.comments_count) : null, views: null },
    metricScope: 'Current UFIConnect totals. Website and LinkedIn engagement counts are unavailable.' });
  const select = `SELECT b.*, p.id IS NOT NULL AS native_visible, cardinality(p.likes) AS likes_count,
    (SELECT COUNT(*)::int FROM post_comments c WHERE c.post_id=p.id) AS comments_count
    FROM business_posts b LEFT JOIN community_posts p ON p.id=b.native_post_id AND p.author_id=b.user_id::text`;
  async function owned(id, postId) {
    const { rows } = await db.query(`${select} WHERE b.user_id=$1 AND b.id=$2`, [id, postId]);
    if (!rows[0]) throw fail(404, 'Hiring post not found.');
    return rows[0];
  }
  async function create(id, input) {
    const user = await member(id);
    return createPost(id, input, user);
  }
  // Native Jobs are available to members. The separate entry point fixes the
  // destination before sharing validation, screening and durable publication.
  // Business APIs continue to require Business membership above.
  async function createNativeJob(id, input = {}) {
    const user = await getUser(id);
    if (!user) throw fail(403, 'Sign in to post a job.');
    if (!db.isConnected()) throw fail(503, 'Hiring post storage is temporarily unavailable.');
    return createPost(id, { requestId: input.requestId, details: input.details, targets: ['uficonnect'] }, user);
  }
  async function createPost(id, input, user) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId || '')) throw fail(400, 'A request ID is required.');
    const { details, content } = normalizeDetails(input.details, { validatePhoto });
    const targets = [...new Set(Array.isArray(input.targets) ? input.targets : [])];
    if (targets.some(target => !['uficonnect', 'linkedin'].includes(target))) throw fail(400, 'Choose a supported recruiting destination.');
    if (targets.includes('linkedin') && !user.socialTokens?.linkedin) throw fail(400, 'Connect LinkedIn before publishing there.');
    const fingerprint = createHash('sha256').update(JSON.stringify({ details, targets: [...targets].sort() })).digest('hex');
    const existing = (await db.query('SELECT id,fingerprint,status FROM business_posts WHERE user_id=$1 AND request_id=$2', [id, input.requestId])).rows[0];
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw fail(409, 'This request was already used for a different post.');
      return rowToPost(await owned(id, existing.id));
    }
    const mediaUrl = details.mediaUrl || null;
    const screening = await screenContent({ content, mediaUrl, mediaType: mediaUrl ? 'image' : null, kind: 'post', maxLength: 2000 });
    if (!screening.allowed) throw fail(screening.reason === 'screening_unavailable' ? 503 : 422, 'This hiring post could not be approved for publication.');
    const postId = `bp_${randomUUID()}`;
    const pending = targets.map(platform => ({ platform, status: 'processing' }));
    const inserted = await db.query(`INSERT INTO business_posts(id,user_id,request_id,fingerprint,details,content,targets,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,request_id) DO NOTHING RETURNING id`,
    [postId, id, input.requestId, fingerprint, JSON.stringify(details), screening.content, JSON.stringify(pending), targets.length ? 'processing' : 'draft']);
    if (!inserted.rows.length) {
      const duplicate = (await db.query('SELECT id,fingerprint FROM business_posts WHERE user_id=$1 AND request_id=$2', [id, input.requestId])).rows[0];
      if (!duplicate || duplicate.fingerprint !== fingerprint) throw fail(409, 'A different post already used this request.');
      return rowToPost(await owned(id, duplicate.id));
    }
    // The durable processing row precedes every provider call. Repeated requests
    // read its outcome instead of sending a second LinkedIn post.
    const outcomes = [];
    let nativePostId = null;
    for (const platform of targets) {
      try {
        const outcome = platform === 'uficonnect'
          ? await publishNative(user, { id: postId, title: details.title, content: screening.content, mediaUrl, mediaType: mediaUrl ? 'image' : null })
          : await publishLinkedIn(user, { content: screening.content, crossPostId: postId, mediaUrl, mediaType: mediaUrl ? 'image' : null });
        outcomes.push({ ...outcome, platform });
        if (platform === 'uficonnect' && outcome.status === 'posted') nativePostId = postId;
      } catch { outcomes.push({ platform, status: 'unconfirmed', error: 'Delivery could not be confirmed. Check the destination before creating another post.' }); }
    }
    if (targets.length) await db.query('UPDATE business_posts SET targets=$1,status=$2,native_post_id=$3 WHERE id=$4 AND user_id=$5',
      [JSON.stringify(outcomes), outcomes.some(target => target.status === 'posted') ? 'published' : 'failed', nativePostId, postId, id]);
    return rowToPost(await owned(id, postId));
  }
  async function posts(id, query = {}) {
    await member(id);
    const page = Math.max(1, Math.min(10000, parseInt(query.page, 10) || 1));
    const { rows } = await db.query(`${select} WHERE b.user_id=$1 ORDER BY b.created_at DESC,b.id LIMIT 13 OFFSET $2`, [id, (page - 1) * 12]);
    return { posts: rows.slice(0, 12).map(rowToPost), page, hasMore: rows.length > 12 };
  }
  async function similar(id, postId, query = {}) {
    await member(id);
    const post = rowToPost(await owned(id, postId));
    const [jobResult, hiringResult] = await Promise.allSettled([loadJobs(), loadHiringPosts(id)]);
    const jobs = jobResult.status === 'fulfilled' ? jobResult.value : [];
    const hiringPosts = hiringResult.status === 'fulfilled' ? hiringResult.value : [];
    const candidates = compareJobs(post, [...hiringPosts.filter(job => job.id !== post.nativePostId), ...jobs]);
    const page = Math.max(1, Math.min(10000, parseInt(query.page, 10) || 1));
    return { post, posts: candidates.slice((page - 1) * 6, page * 6), page, hasMore: candidates.length > page * 6, total: candidates.length,
      warning: jobResult.status === 'rejected' || hiringResult.status === 'rejected' ? 'Some comparison sources are temporarily unavailable. Refresh to try again.' : null };
  }
  return { create, createNativeJob, posts, similar };
}
function registerBusinessPostRoutes(app, { service, authenticate, limiter }) {
  const handler = fn => async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try { res.json(await fn(req)); } catch (error) {
      res.status(error.status || 503).json({ message: error.status ? error.message : 'Hiring posts are temporarily unavailable. Please try again.' });
    }
  };
  app.get('/business/posts', authenticate, handler(req => service.posts(req.user.id, req.query)));
  app.post('/business/posts', authenticate, limiter, handler(req => service.create(req.user.id, req.body || {})));
  app.get('/business/posts/:id/similar', authenticate, handler(req => service.similar(req.user.id, req.params.id, req.query)));
}
module.exports = { BUSINESS_POST_SCHEMA, normalizeDetails, comparableJob, compareJobs, createBusinessPosts, registerBusinessPostRoutes };
