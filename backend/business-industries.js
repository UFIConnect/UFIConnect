'use strict';

const { randomUUID, createHash } = require('node:crypto');
const catalog = require('./business-industries.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fault = (status, message) => Object.assign(new Error(message), { status });
const text = value => typeof value === 'string' ? value.trim() : '';
const industryById = new Map(catalog.map(item => [item.id, item]));
const BUSINESS_INDUSTRY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS business_industry_workspaces (
    id UUID PRIMARY KEY, owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    industry_id TEXT NOT NULL, name TEXT NOT NULL, source_ids JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(owner_id,industry_id))`,
  `CREATE TABLE IF NOT EXISTS business_industry_posts (
    id TEXT PRIMARY KEY, workspace_id UUID NOT NULL REFERENCES business_industry_workspaces(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, request_id UUID NOT NULL,
    fingerprint TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, media_url TEXT,
    targets JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(author_id,request_id))`,
  `CREATE INDEX IF NOT EXISTS business_industry_posts_workspace ON business_industry_posts(workspace_id,created_at DESC,id)`,
];

function safeHttps(value) {
  if (typeof value !== 'string' || /[\\\u0000-\u0020\u007f]/.test(value)) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
for (const industry of catalog) for (const source of industry.sources) {
  if (!safeHttps(source.url) || source.kind !== 'resource' || source.publishing !== false) throw Error('Invalid industry resource catalog');
}
function normalizePost(input, validatePhoto) {
  const title = text(input.title), body = text(input.content), mediaUrl = text(input.mediaUrl);
  if (title.length < 3 || title.length > 150 || body.length < 20 || `${title}\n\n${body}`.length > 2000) {
    throw fault(400, 'Add a title and at least 20 characters of text, within 2,000 characters in total.');
  }
  if (mediaUrl && (!safeHttps(mediaUrl) || mediaUrl.length > 1000 || !validatePhoto(mediaUrl))) throw fault(400, 'Upload the photo through UFIconnect before attaching it.');
  if (!Array.isArray(input.targets) || input.targets.length > 2 || input.targets.some(value => !['uficonnect','linkedin'].includes(value))) throw fault(400, 'Choose UFIconnect or a supported connected LinkedIn account.');
  const targets = [...new Set(input.targets)].sort();
  if (targets.includes('uficonnect') && input.publicConfirmed !== true) throw fault(400, 'Confirm that the UFIconnect post will be public.');
  return { title, body, content: `${title}\n\n${body}`, mediaUrl: mediaUrl || null, targets };
}
const workspaceToApi = row => ({ id: row.id, industryId: row.industry_id, name: row.name,
  sourceIds: row.source_ids, createdAt: row.created_at, updatedAt: row.updated_at });
const postToApi = row => ({ id: row.id, workspaceId: row.workspace_id, authorId: row.author_id,
  title: row.title, content: row.content, mediaUrl: row.media_url || null, targets: row.targets,
  status: row.status, createdAt: row.created_at });

function createBusinessIndustries({ db, getUser, getMembership, screenContent, publishNative, publishLinkedIn, validatePhoto = () => false }) {
  async function access(id, ownerOnly = false) {
    if (!db.isConnected()) throw fault(503, 'Business workspace storage is temporarily unavailable.');
    const { rows: [self] } = await db.query('SELECT id,plan,billing_closed FROM users WHERE id=$1', [id]);
    if (!self || self.billing_closed) throw fault(403, 'An active Business membership is required.');
    // Always read billing ownership and the existing paid-seat calculation.
    // A profile cache or a caller-provided organization can never grant access.
    const membership = self.plan === 'business' ? null : await getMembership(id);
    const ownerId = self.plan === 'business' ? self.id : membership?.active ? membership.ownerId : null;
    if (!ownerId) throw fault(403, 'An active Business membership is required.');
    if (ownerOnly && ownerId !== id) throw fault(403, 'Only the Business membership owner can change industry spaces.');
    return { ownerId, canManage: ownerId === id };
  }
  async function workspace(ownerId, id) {
    if (!UUID.test(id || '')) throw fault(404, 'Industry space not found.');
    const { rows: [row] } = await db.query('SELECT * FROM business_industry_workspaces WHERE owner_id=$1 AND id=$2', [ownerId,id]);
    if (!row) throw fault(404, 'Industry space not found.');
    return row;
  }
  async function list(id) {
    const context = await access(id);
    const { rows } = await db.query('SELECT * FROM business_industry_workspaces WHERE owner_id=$1 ORDER BY name,id', [context.ownerId]);
    return { catalog, workspaces: rows.map(workspaceToApi), canManage: context.canManage };
  }
  async function save(id, input = {}) {
    const context = await access(id, true);
    if (Object.keys(input).some(key => !['industryId','name','sourceIds'].includes(key))) throw fault(400, 'Use the industry space fields shown in the form.');
    const industry = industryById.get(input.industryId), name = text(input.name);
    if (!industry || name.length < 2 || name.length > 80) throw fault(400, 'Choose an industry and a space name between 2 and 80 characters.');
    if (!Array.isArray(input.sourceIds) || input.sourceIds.length > industry.sources.length
      || input.sourceIds.some(source => !industry.sources.some(item => item.id === source))) throw fault(400, 'Choose resources from this industry’s official source list.');
    const sources = [...new Set(input.sourceIds)].sort();
    const { rows: [row] } = await db.query(`INSERT INTO business_industry_workspaces(id,owner_id,industry_id,name,source_ids)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id,industry_id) DO UPDATE SET name=EXCLUDED.name,source_ids=EXCLUDED.source_ids,updated_at=NOW() RETURNING *`,
    [randomUUID(),context.ownerId,industry.id,name,JSON.stringify(sources)]);
    return { workspace: workspaceToApi(row) };
  }
  async function posts(id, workspaceId, query = {}) {
    const context = await access(id);
    const current = await workspace(context.ownerId, workspaceId);
    const page = Math.max(1, Math.min(10000, parseInt(query.page,10) || 1));
    const { rows } = await db.query(`SELECT * FROM business_industry_posts WHERE workspace_id=$1 AND (status<>'draft' OR author_id=$2)
      ORDER BY created_at DESC,id LIMIT 13 OFFSET $3`, [current.id,id,(page-1)*12]);
    return { workspace: workspaceToApi(current), posts: rows.slice(0,12).map(postToApi), page, hasMore: rows.length > 12 };
  }
  async function createPost(id, workspaceId, input = {}) {
    const context = await access(id);
    const current = await workspace(context.ownerId, workspaceId);
    if (Object.keys(input).some(key => !['requestId','title','content','mediaUrl','targets','publicConfirmed'].includes(key))) throw fault(400, 'Use the publishing fields shown in the form.');
    if (!UUID.test(input.requestId || '')) throw fault(400, 'A request ID is required.');
    const normalized = normalizePost(input, validatePhoto);
    const fingerprint = createHash('sha256').update(JSON.stringify({ workspaceId, ...normalized })).digest('hex');
    const previous = async () => {
      const { rows: [row] } = await db.query('SELECT * FROM business_industry_posts WHERE author_id=$1 AND request_id=$2', [id,input.requestId]);
      if (!row || row.fingerprint !== fingerprint || row.workspace_id !== current.id) throw fault(409, 'This request was already used for a different post.');
      return postToApi(row);
    };
    const { rows: existing } = await db.query('SELECT id FROM business_industry_posts WHERE author_id=$1 AND request_id=$2', [id,input.requestId]);
    if (existing.length) return previous();
    const user = await getUser(id);
    if (!user || user.id !== id) throw fault(403, 'Sign in again before publishing.');
    if (normalized.targets.includes('linkedin') && !user.socialTokens?.linkedin) throw fault(400, 'Connect your LinkedIn account before publishing there.');
    const screened = await screenContent({ content: normalized.content, mediaUrl: normalized.mediaUrl,
      mediaType: normalized.mediaUrl ? 'image' : null, kind: 'post', maxLength: 2000 });
    if (!screened.allowed) throw fault(screened.reason === 'screening_unavailable' ? 503 : 422, 'This post could not be approved for publication.');
    // Recheck the paid seat after screening, before reserving any publication.
    if ((await access(id)).ownerId !== context.ownerId) throw fault(403, 'Your Business membership changed. Reload the space before publishing.');
    const postId = `bi_${randomUUID()}`;
    const { rows: inserted } = await db.query(`INSERT INTO business_industry_posts(id,workspace_id,author_id,request_id,fingerprint,title,content,media_url,targets,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(author_id,request_id) DO NOTHING RETURNING id`,
    [postId,current.id,id,input.requestId,fingerprint,normalized.title,screened.content,normalized.mediaUrl,
      JSON.stringify(normalized.targets.map(platform => ({ platform,status:'processing' }))),normalized.targets.length ? 'processing' : 'draft']);
    if (!inserted.length) return previous();
    const outcomes = [];
    for (const platform of normalized.targets) {
      try {
        const payload = { id:postId,crossPostId:postId,title:normalized.title,content:screened.content,
          industryId:current.industry_id,mediaUrl:normalized.mediaUrl,mediaType:normalized.mediaUrl ? 'image' : null };
        const result = await (platform === 'uficonnect' ? publishNative(user,payload) : publishLinkedIn(user,payload));
        const status = ['posted','failed','unconfirmed'].includes(result?.status) ? result.status : 'unconfirmed';
        // Provider adapters own their tokens. Expose only public outcome fields.
        const postedUrl = safeHttps(result?.postedUrl);
        const allowedHost = postedUrl && new URL(postedUrl).hostname;
        outcomes.push({ platform,status,
          ...(postedUrl && (platform === 'uficonnect' ? allowedHost === 'uficonnect.org' : ['www.linkedin.com','linkedin.com'].includes(allowedHost)) ? { postedUrl } : {}),
          ...(status !== 'posted' ? { error: status === 'unconfirmed' ? 'Delivery could not be confirmed. Check the destination before publishing another copy.' : 'This destination could not publish the post. Check its connection before creating a new post.' } : {}) });
      } catch { outcomes.push({ platform,status:'unconfirmed',error:'Delivery could not be confirmed. Check the destination before publishing another copy.' }); }
    }
    if (normalized.targets.length) await db.query('UPDATE business_industry_posts SET targets=$1,status=$2 WHERE id=$3 AND author_id=$4',
      [JSON.stringify(outcomes),outcomes.some(outcome => outcome.status === 'unconfirmed') ? 'unconfirmed' : outcomes.every(outcome => outcome.status === 'posted') ? 'published' : outcomes.some(outcome => outcome.status === 'posted') ? 'partial' : 'failed',postId,id]);
    return previous();
  }
  return { list,save,posts,createPost };
}
function registerBusinessIndustryRoutes(app, { service,authenticate,limiter }) {
  const handler = fn => async (req,res) => {
    res.set('Cache-Control','private, no-store');
    try { res.json(await fn(req)); } catch (error) { res.status(error.status || 503).json({ message:error.status ? error.message : 'Business spaces are temporarily unavailable. Try again shortly.' }); }
  };
  app.get('/business/industries',authenticate,handler(req => service.list(req.user.id)));
  app.post('/business/industries',authenticate,limiter,handler(req => service.save(req.user.id,req.body || {})));
  app.get('/business/industries/:id/posts',authenticate,handler(req => service.posts(req.user.id,req.params.id,req.query)));
  app.post('/business/industries/:id/posts',authenticate,limiter,handler(req => service.createPost(req.user.id,req.params.id,req.body || {})));
}
module.exports = { BUSINESS_INDUSTRY_SCHEMA,catalog,safeHttps,normalizePost,createBusinessIndustries,registerBusinessIndustryRoutes };
