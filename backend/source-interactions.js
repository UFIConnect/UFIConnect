// Provider writes only occur on an authenticated member's explicit action.
// Fixed API origins and strict target parsing prevent forwarding credentials
// to a URL supplied by a post. Never log tokens or provider response bodies.
const { normalizeSource, getSourcePolicy, isSourceActionAllowed, getInteractionCapabilities, validateOriginalUrl } = require('./source-policy');
const { createHash } = require('node:crypto');
const { mastodonOrigin, mastodonPostUrl, mastodonCanInteract } = require('./mastodon-oauth');
const { youtubeCanInteract } = require('./youtube-permissions');
const SUPPORTED = Object.freeze({
  reddit: { label: 'Reddit', likeLabel: 'Upvote', maxLength: 1000 },
  twitter: { label: 'X', likeLabel: 'Like', maxLength: 280 },
  bluesky: { label: 'Bluesky', likeLabel: 'Like', maxLength: 300 },
  mastodon: { label: 'Mastodon', likeLabel: 'Favourite', maxLength: 500 },
  youtube: { label: 'YouTube', likeLabel: 'Like', maxLength: 1000 },
  github: { label: 'GitHub', likeLabel: 'Star repository', maxLength: 1000 },
  gitlab: { label: 'GitLab', likeLabel: 'Star project', maxLength: 1000 },
});

function failure(message, status = 400) { return Object.assign(new Error(message), { status }); }
function parseTarget(source, sourceUrl) {
  source = normalizeSource(source);
  const original = validateOriginalUrl(source, sourceUrl);
  if (!original) throw failure('This post has no valid original link.');
  const url = new URL(original);
  const host = url.hostname.toLowerCase(), parts = url.pathname.split('/').filter(Boolean);
  if (source === 'mastodon') return { id: original, url: original, comment: true };
  if (source === 'reddit' && ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'oauth.reddit.com'].includes(host)) {
    const index = parts.indexOf('comments'), id = index >= 0 ? parts[index + 1] : null;
    if ((index === 0 || (index === 2 && parts[0] === 'r')) && /^[a-z0-9]+$/i.test(id || '')) return { id: `t3_${id}`, comment: true };
  }
  if (source === 'twitter' && ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(host)) {
    const id = parts[parts.indexOf('status') + 1];
    if ((parts[1] === 'status' || (parts[0] === 'i' && parts[1] === 'web' && parts[2] === 'status')) && /^\d+$/.test(id || '')) return { id, comment: true };
  }
  if (source === 'youtube' && ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) {
    const id = host === 'youtu.be' && parts.length === 1 ? parts[0] : parts[0] === 'watch' && parts.length === 1 && url.searchParams.getAll('v').length === 1 ? url.searchParams.get('v') : ['shorts', 'live', 'embed'].includes(parts[0]) && parts.length === 2 ? parts[1] : '';
    if (/^[\w-]{11}$/.test(id || '')) return { id, comment: true };
  }
  if (source === 'bluesky' && host === 'bsky.app' && parts.length === 4 && parts[0] === 'profile' && parts[2] === 'post') {
    if (/^(?:did:plc:[a-z0-9]+|[a-z0-9][a-z0-9.-]+)$/i.test(parts[1]) && /^[a-z0-9]+$/i.test(parts[3])) return { actor: parts[1], rkey: parts[3], comment: true };
  }
  if (source === 'github' && host === 'github.com' && parts.length >= 2 && parts.slice(0, 2).every(part => /^[\w.-]+$/.test(part) && !['.', '..'].includes(part))) {
    return { project: parts.slice(0, 2).map(encodeURIComponent).join('/'), number: /^\d+$/.test(parts[3] || '') ? parts[3] : null, comment: ['issues', 'pull'].includes(parts[2]) && /^\d+$/.test(parts[3] || '') };
  }
  if (source === 'gitlab' && host === 'gitlab.com') {
    const divider = parts.indexOf('-'), project = divider < 0 ? parts : parts.slice(0, divider);
    if (project.length >= 2 && project.every(part => /^[\w.-]+$/.test(part) && !['.', '..'].includes(part))) {
      const type = parts[divider + 1], number = parts[divider + 2];
      return { project: encodeURIComponent(project.join('/')), type, number, comment: divider >= 0 && ['issues', 'merge_requests'].includes(type) && /^\d+$/.test(number || '') };
    }
  }
  throw failure('This source does not support actions for that original link.');
}

function createSourceInteractions({ fetchImpl = fetch, atprotoGet, atprotoPostJSON, mastodonService, policyEnv = process.env } = {}) {
  async function request(url, token, method = 'GET', body, form = false) {
    let response;
    try {
      response = await fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'UFIconnect/1.0',
          ...(body ? { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' } : {}) },
        ...(body ? { body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) } : {}) });
    } catch { throw failure('The source did not confirm this action. Check the original post before retrying.', 502); }
    if (!response.ok) {
      if (response.status === 401) throw Object.assign(failure('This account access expired. Reconnect the source if it cannot be renewed.', 403), { accessExpired: true });
      if (url.startsWith('https://www.googleapis.com/youtube/v3/')) {
        let data;
        try { data = await response.json(); } catch {}
        const reasons = data?.error?.errors?.map(error => error.reason) || [];
        const messages = {
          commentsDisabled: 'Comments are disabled for this YouTube video.',
          videoRatingDisabled: 'Ratings are disabled for this YouTube video.',
          quotaExceeded: 'YouTube has reached its API quota. Please try again later.',
          dailyLimitExceeded: 'YouTube has reached its API quota. Please try again later.',
          youtubeSignupRequired: 'Create a YouTube channel for this Google account, then reconnect YouTube.',
          insufficientPermissions: 'Reconnect YouTube and allow all five permissions, including likes and comments.',
        };
        const reason = reasons.find(value => Object.hasOwn(messages, value));
        if (reason) throw failure(messages[reason], ['quotaExceeded', 'dailyLimitExceeded'].includes(reason) ? 429 : 403);
      }
      if ([401, 403].includes(response.status)) throw failure('The source denied this action. Reconnect this account with interaction permissions, or open the original post.', 403);
      if (response.status === 429) throw failure('This source is temporarily rate limited. Try again later.', 429);
      throw failure('The source could not complete this action. Open the original post to check its availability.', 502);
    }
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { throw failure('The source returned an unexpected response. Check the original post.', 502); }
  }
  async function bluesky(token, target, action, content, liked) {
    let session;
    try { session = JSON.parse(token); } catch { throw failure('Reconnect your Bluesky account.', 403); }
    if (!session?.did || !session.accessToken || !session.pdsUrl) throw failure('Reconnect your Bluesky account.', 403);
    const base = String(session.pdsUrl).replace(/\/$/, '');
    if (!base.startsWith('https://')) throw failure('Reconnect your Bluesky account.', 403);
    const call = async (method, endpoint, body, allowMissing = false) => {
      const result = method === 'GET' ? await atprotoGet(`${base}/xrpc/${endpoint}`, { accessToken: session.accessToken })
        : await atprotoPostJSON(`${base}/xrpc/${endpoint}`, body, { accessToken: session.accessToken });
      if (allowMissing && result?.status === 400 && result.data?.error === 'RecordNotFound') return null;
      if (!result || result.status < 200 || result.status >= 300) throw Object.assign(failure('Bluesky denied this action. Reconnect your account or check the original post.', [401, 403].includes(result?.status) ? 403 : 502), { accessExpired: result?.status === 401 });
      return result.data;
    };
    let did = target.actor;
    if (!did.startsWith('did:')) did = (await call('GET', `com.atproto.identity.resolveHandle?handle=${encodeURIComponent(did)}`))?.did;
    if (!/^did:[a-z]+:[a-zA-Z0-9:._%-]+$/.test(did || '')) throw failure('Bluesky could not resolve this author.', 502);
    const uri = `at://${did}/app.bsky.feed.post/${target.rkey}`;
    const post = (await call('GET', `app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`))?.posts?.[0];
    if (post?.uri !== uri || !post.cid) throw failure('This Bluesky post is no longer available.', 404);
    const metrics = value => ({ sourceLikedByMe: Boolean(value.viewer?.like),
      ...(Number.isSafeInteger(value.likeCount) && value.likeCount >= 0 ? { sourceLikesCount: value.likeCount } : {}),
      ...(Number.isSafeInteger(value.replyCount) && value.replyCount >= 0 ? { commentsCount: value.replyCount } : {}) });
    if (action === 'state') return metrics(post);
    if (action === 'like') {
      const prefix = `at://${session.did}/app.bsky.feed.like/`;
      if (post.viewer?.like && (!post.viewer.like.startsWith(prefix) || !/^[a-z0-9]+$/i.test(post.viewer.like.slice(prefix.length)))) throw failure('Bluesky could not resolve your like.', 502);
      // Stable repository identity prevents duplicate likes and makes a rapid
      // unlike work even before AppView has indexed the preceding like.
      // app.bsky.feed.like uses TID-shaped record keys. Encode a stable
      // 63-bit identity with AT Protocol's sortable base32 alphabet.
      const alphabet = '234567abcdefghijklmnopqrstuvwxyz';
      let keyBits = createHash('sha256').update(uri).digest().readBigUInt64BE() & 0x7fffffffffffffffn;
      let stableKey = '';
      for (let index = 0; index < 13; index++) { stableKey = alphabet[Number(keyBits & 31n)] + stableKey; keyBits >>= 5n; }
      let rkey = post.viewer?.like?.slice(prefix.length) || stableKey;
      let existing = await call('GET', `com.atproto.repo.getRecord?${new URLSearchParams({ repo: session.did, collection: 'app.bsky.feed.like', rkey })}`, undefined, true);
      if (!existing && rkey !== stableKey) {
        rkey = stableKey;
        existing = await call('GET', `com.atproto.repo.getRecord?${new URLSearchParams({ repo: session.did, collection: 'app.bsky.feed.like', rkey })}`, undefined, true);
      }
      if (existing && existing.value?.subject?.uri !== uri) throw failure('Bluesky could not resolve your like.', 502);
      if (liked && !existing) {
        const created = await call('POST', 'com.atproto.repo.putRecord', { repo: session.did, collection: 'app.bsky.feed.like', rkey: stableKey, record: { $type: 'app.bsky.feed.like', subject: { uri, cid: post.cid }, createdAt: new Date().toISOString() } });
        if (created?.uri !== prefix + stableKey) throw failure('Bluesky did not confirm your like. Check the original post before retrying.', 502);
      }
      if (!liked && existing) await call('POST', 'com.atproto.repo.deleteRecord', { repo: session.did, collection: 'app.bsky.feed.like', rkey });
      // AppView indexing can lag behind a confirmed repository write. Only
      // attach a source count if its viewer state has caught up to the write.
      let current = post;
      try { current = (await call('GET', `app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`))?.posts?.find(value => value.uri === uri) || post; } catch {}
      const state = metrics(current);
      return { liked, ...(state.sourceLikedByMe === liked && state.sourceLikesCount !== undefined ? { likesCount: state.sourceLikesCount } : {}) };
    }
    const record = { $type: 'app.bsky.feed.post', text: content, createdAt: new Date().toISOString(), reply: { parent: { uri, cid: post.cid }, root: post.record?.reply?.root || { uri, cid: post.cid } } };
    const data = await call('POST', 'com.atproto.repo.createRecord', { repo: session.did, collection: 'app.bsky.feed.post', record });
    if (!data?.uri) throw failure('Bluesky did not confirm the reply. Check the original post.', 502);
    const rkey = data.uri.split('/').pop();
    return { commentId: data.uri, commentUrl: `https://bsky.app/profile/${session.did}/post/${rkey}` };
  }
  async function mastodon(user, token, target, action, content, liked, requestId) {
    if (!mastodonCanInteract(token, action)) throw failure('Reconnect Mastodon to allow favourites and replies.', 403);
    let session, origin;
    try {
      session = JSON.parse(token);
      origin = mastodonOrigin(session.origin);
      if (typeof session.accessToken !== 'string' || !session.accessToken || !/^\d+$/.test(session.accountId || '')) throw new Error('Invalid account');
    } catch { throw failure('Reconnect your Mastodon account.', 403); }
    if (!mastodonService?.json) throw failure('Mastodon actions are temporarily unavailable.', 503);
    const call = async (path, options = {}) => {
      try { return await mastodonService.json(origin, path, { ...options, token: session.accessToken }); }
      catch (error) {
        if ([401, 403].includes(error.status)) throw failure('Mastodon denied this action. Reconnect with interaction permissions, or open the original post.', 403);
        if (error.status === 429) throw failure('Mastodon is temporarily rate limited. Try again later.', 429);
        if (error.status === 404) throw failure('This Mastodon post is no longer available to your account.', 404);
        throw failure('Mastodon did not confirm this action. Check the original post before retrying.', 502);
      }
    };
    // A remote status has a different numeric ID on every federated server.
    // Resolve its canonical URL on this account's server, never on its author host.
    const resolved = await call(`/api/v2/search?${new URLSearchParams({ q: target.url, type: 'statuses', resolve: 'true', limit: '5' })}`);
    const status = (Array.isArray(resolved?.statuses) ? resolved.statuses : []).find(item => !item.reblog
      && /^\d+$/.test(item.id || '')
      && [item.url, item.uri].some(value => mastodonPostUrl(value) === target.url));
    if (!status) throw failure('Your Mastodon server could not find this exact post. Open the original post to continue.', 404);
    if (action === 'like') {
      const result = await call(`/api/v1/statuses/${status.id}/${liked ? 'favourite' : 'unfavourite'}`, { form: {} });
      if (String(result?.id) !== String(status.id) || result.favourited !== liked
          || ![result.url, result.uri].some(value => mastodonPostUrl(value) === target.url)) throw failure('Mastodon did not confirm this favourite. Check the original post.', 502);
      return { liked, ...(Number.isSafeInteger(result.favourites_count) && result.favourites_count >= 0 ? { likesCount: result.favourites_count } : {}) };
    }
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId || '')) throw failure('A reply request identity is required. Please try again.', 400);
    if (!['public', 'unlisted', 'private', 'direct'].includes(status.visibility)) throw failure('Mastodon could not confirm this post visibility. Open the original post to reply.', 502);
    const idempotencyKey = createHash('sha256').update(JSON.stringify(['uficonnect-mastodon-reply', user.id, session.accountId, requestId])).digest('hex');
    const result = await call('/api/v1/statuses', {
      form: { status: content, in_reply_to_id: status.id, visibility: status.visibility,
        ...(status.sensitive ? { sensitive: 'true' } : {}), ...(status.spoiler_text ? { spoiler_text: status.spoiler_text } : {}) },
      idempotencyKey,
    });
    if (!/^\d+$/.test(result?.id || '') || String(result.in_reply_to_id) !== String(status.id)
        || String(result.account?.id) !== String(session.accountId)) throw failure('Mastodon did not confirm the reply. Check the original post before retrying.', 502);
    const commentUrl = mastodonPostUrl(result.url) || mastodonPostUrl(result.uri);
    return { commentId: String(result.id), ...(commentUrl ? { commentUrl } : {}) };
  }
  async function perform({ user, source, sourceUrl, action, content, liked, requestId }) {
    source = normalizeSource(source);
    if (!['like', 'comment'].includes(action)) throw failure('Unsupported action.');
    if (!isSourceActionAllowed(source, action, { env: policyEnv })) throw failure('This action is unavailable here. Open the original source to continue.', 422);
    const capability = SUPPORTED[source];
    if (!capability) throw failure('Open the original source to interact with this post.', 422);
    const token = user?.socialTokens?.[source];
    if (!token) throw failure('Connect this source before interacting with its posts.', 403);
    const target = parseTarget(source, sourceUrl);
    if (action === 'like' && typeof liked !== 'boolean') throw failure('Choose whether to like this post.');
    if (action === 'comment') {
      if (!target.comment) throw failure('Open the original source to comment on this item.', 422);
      if (typeof content !== 'string' || !content.trim() || Array.from(content.trim()).length > capability.maxLength) throw failure(`Comments must be between 1 and ${capability.maxLength} characters.`);
      content = content.trim();
    }
    if (source === 'bluesky') return bluesky(token, target, action, content, liked);
    if (source === 'mastodon') return mastodon(user, token, target, action, content, liked, requestId);
    if (source === 'reddit') {
      const data = action === 'like'
        ? await request('https://oauth.reddit.com/api/vote', token, 'POST', { id: target.id, dir: liked ? '1' : '0', api_type: 'json' }, true)
        : await request('https://oauth.reddit.com/api/comment', token, 'POST', { thing_id: target.id, text: content, api_type: 'json' }, true);
      if (data?.json?.errors?.length) throw failure('Reddit rejected this action. Check the original post and your account permissions.', 422);
      if (action === 'comment' && !data?.json?.data?.things?.[0]?.data?.id) throw failure('Reddit did not confirm the comment. Check the original post.', 502);
      return action === 'like' ? { liked } : { commentId: data.json.data.things[0].data.id };
    }
    if (source === 'twitter') {
      if (action === 'comment') { const data = await request('https://api.x.com/2/tweets', token, 'POST', { text: content, reply: { in_reply_to_tweet_id: target.id } }); if (!data.data?.id) throw failure('X did not confirm the reply.', 502); return { commentId: data.data.id }; }
      const me = await request('https://api.x.com/2/users/me', token);
      if (!/^\d+$/.test(me.data?.id || '')) throw failure('Reconnect your X account.', 403);
      const data = await request(`https://api.x.com/2/users/${me.data.id}/likes${liked ? '' : `/${target.id}`}`, token, liked ? 'POST' : 'DELETE', liked ? { tweet_id: target.id } : undefined);
      if (data.data?.liked !== liked) throw failure('X did not confirm this like.', 502);
      return { liked };
    }
    if (source === 'youtube') {
      if (!youtubeCanInteract(user?.socialGrantedScopes?.youtube, action)) throw failure('Reconnect YouTube and allow all five permissions, including publishing, likes and comments.', 403);
      if (action === 'like') { await request(`https://www.googleapis.com/youtube/v3/videos/rate?id=${target.id}&rating=${liked ? 'like' : 'none'}`, token, 'POST'); return { liked }; }
      const video = await request(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${target.id}`, token);
      const channelId = video.items?.[0]?.snippet?.channelId;
      if (!channelId) throw failure('This video is no longer available.', 404);
      const data = await request('https://www.googleapis.com/youtube/v3/commentThreads?part=snippet', token, 'POST', { snippet: { videoId: target.id, channelId, topLevelComment: { snippet: { textOriginal: content } } } });
      if (!data.id) throw failure('YouTube did not confirm this comment.', 502);
      return { commentId: data.id };
    }
    if (source === 'github') {
      if (action === 'like') { await request(`https://api.github.com/user/starred/${target.project}`, token, liked ? 'PUT' : 'DELETE'); return { liked }; }
      const data = await request(`https://api.github.com/repos/${target.project}/issues/${target.number}/comments`, token, 'POST', { body: content });
      if (!data.id) throw failure('GitHub did not confirm this comment.', 502);
      return { commentId: String(data.id) };
    }
    if (source === 'gitlab') {
      if (action === 'like') { await request(`https://gitlab.com/api/v4/projects/${target.project}/${liked ? 'star' : 'unstar'}`, token, 'POST'); return { liked }; }
      const data = await request(`https://gitlab.com/api/v4/projects/${target.project}/${target.type}/${target.number}/notes`, token, 'POST', { body: content });
      if (!data.id) throw failure('GitLab did not confirm this comment.', 502);
      return { commentId: String(data.id) };
    }
  }
  async function read({ user, source, sourceUrl }) {
    if (source !== 'bluesky' || !user?.socialTokens?.bluesky) throw failure('Connect Bluesky to refresh this post.', 403);
    return bluesky(user.socialTokens.bluesky, parseTarget(source, sourceUrl), 'state');
  }
  return { perform, read };
}

function registerSourceInteractionRoutes(app, { authenticate, limiter, getUser, screenMemberContent, auditInteraction, reserveInteraction, completeInteraction, onPublished, refreshAccessToken, policyEnv = process.env, ...transport }) {
  if ((typeof reserveInteraction === 'function') !== (typeof completeInteraction === 'function')) throw new Error('Source reservations require both reserveInteraction and completeInteraction.');
  const { perform, read } = createSourceInteractions({ ...transport, policyEnv });
  async function withFreshAccess(user, source, work) {
    const rejectedToken = user?.socialTokens?.[source];
    const connection = user?.socialConnectedAt?.[source];
    try { return await work(user); }
    catch (error) {
      // Only an explicit authentication rejection is safe to repeat. Never
      // replay an uncertain write, a quota error, or a permission denial.
      if (!error.accessExpired || !refreshAccessToken) throw error;
      const renewed = await refreshAccessToken(user.id, source, rejectedToken);
      if (!renewed) throw error;
      const current = await getUser(user.id);
      if (!current?.socialTokens?.[source] || current.socialConnectedAt?.[source] !== connection) throw failure('This source connection changed. Refresh and try again.', 409);
      return work(current);
    }
  }
  const requests = new Map();
  app.get('/social/post-engagement', authenticate, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const { source, sourceUrl } = req.query;
    if (source !== 'bluesky' || typeof sourceUrl !== 'string' || sourceUrl.length > 2048) return res.status(400).json({ message: 'Invalid source post.' });
    try {
      if (!getSourcePolicy(source, { env: policyEnv })?.features.displayPost) throw failure('This source is unavailable.', 422);
      const user = await getUser(req.user.id);
      const state = await withFreshAccess(user, source, current => read({ user: current, source, sourceUrl }));
      res.json(state);
    } catch (error) { res.status(error.status || 502).json({ message: error.status ? error.message : 'This source post could not be refreshed.' }); }
  });
  app.get('/social/interaction-capabilities', authenticate, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const user = await getUser(req.user.id);
      res.json({ sources: getInteractionCapabilities(user, { env: policyEnv }) });
    } catch { res.status(503).json({ message: 'Connected source actions are temporarily unavailable.' }); }
  });
  app.post('/social/interactions', authenticate, limiter, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const { source: suppliedSource, sourceUrl, action, content, liked, requestId } = req.body || {};
    if (typeof suppliedSource !== 'string' || typeof sourceUrl !== 'string' || sourceUrl.length > 2048 || !/^[a-zA-Z0-9-]{16,80}$/.test(requestId || '')) return res.status(400).json({ message: 'Invalid source action.' });
    const source = normalizeSource(suppliedSource);
    const fingerprint = JSON.stringify([source, sourceUrl, action, content, liked]);
    const key = `${req.user.id}:${requestId}`;
    const now = Date.now();
    for (const [id, entry] of requests) if (entry.expiresAt < now) requests.delete(id);
    const previous = requests.get(key);
    if (previous && previous.fingerprint !== fingerprint) return res.status(409).json({ message: 'This request was already used for another action.' });
    if (!previous && requests.size >= 2000) return res.status(503).json({ message: 'Source actions are busy. Try again shortly.' });
    const run = async () => {
      let target, result, reserved = false;
      try {
        if (typeof reserveInteraction === 'function') {
          let previousResult;
          try {
            previousResult = await reserveInteraction({ memberId: req.user.id, requestId,
              fingerprint: createHash('sha256').update(fingerprint).digest('hex') });
          } catch { throw failure('Source action storage is temporarily unavailable. Try again later.', 503); }
          if (previousResult) return previousResult;
          reserved = true;
        }
        if (!['like', 'comment'].includes(action)) throw failure('Unsupported action.');
        if (!isSourceActionAllowed(source, action, { env: policyEnv })) throw failure('This action is unavailable here. Open the original source to continue.', 422);
        const user = await getUser(req.user.id);
        if (!SUPPORTED[source] || !user?.socialTokens?.[source]) throw failure('Connect a supported source to use this action.', 403);
        target = parseTarget(source, sourceUrl);
        let text = content;
        if (action === 'comment') {
          if (typeof content !== 'string' || !content.trim() || Array.from(content.trim()).length > SUPPORTED[source].maxLength) throw failure(`Comments must be between 1 and ${SUPPORTED[source].maxLength} characters.`);
          const screened = await screenMemberContent({ content: content.trim(), kind: 'source_comment', maxLength: SUPPORTED[source].maxLength });
          if (!screened.allowed) throw failure(screened.reason === 'screening_unavailable' ? 'Comment screening is temporarily unavailable.' : 'This comment cannot be published.', screened.reason === 'screening_unavailable' ? 503 : 422);
          text = screened.content;
        }
        result = { status: 200, body: { source, action, published: true, ...await withFreshAccess(user, source,
          current => perform({ user: current, source, sourceUrl, action, content: text, liked, requestId })) } };
        // The upstream write is already confirmed. Cache maintenance cannot
        // turn it into a retryable provider write if local invalidation fails.
        try { await onPublished?.({ memberId: req.user.id, source, sourceUrl, action, result: result.body }); } catch {}
      } catch (error) {
        const originalUrl = validateOriginalUrl(source, sourceUrl, { env: policyEnv });
        const policy = getSourcePolicy(source, { env: policyEnv });
        result = { status: error.status || 502, body: {
          message: error.status ? error.message : 'The source did not confirm this action. Check the original post before retrying.',
          ...(originalUrl && policy ? { fallback: { url: originalUrl, label: `${action === 'comment' ? policy.commentLabel : policy.likeLabel} on ${policy.label}` } } : {}),
        } };
      }
      if (typeof auditInteraction === 'function') {
        // Audit only request metadata. Never copy credentials, comment bodies,
        // provider responses or URL query strings into analytics storage.
        const sourcePostId = target?.id || (target?.actor ? `${target.actor}/${target.rkey}` : target?.project ? `${target.project}${target.number ? `/${target.number}` : ''}` : null);
        try {
          await auditInteraction({ memberId: req.user.id, interactionRequestId: requestId,
            sourcePlatform: Object.hasOwn(SUPPORTED, source) || getSourcePolicy(source) ? source : 'unknown',
            sourcePostId, actionType: ['like', 'comment'].includes(action) ? action : 'unknown',
            status: result.status === 200 ? 'succeeded' : result.status < 500 ? 'denied' : 'unconfirmed',
            timestamp: new Date().toISOString() });
        } catch {
          // A confirmed provider write must not become a retryable failure just
          // because audit storage is unavailable after the source accepted it.
          result.body.auditRecorded = false;
        }
      }
      if (reserved) {
        try { await completeInteraction({ memberId: req.user.id, requestId, result }); }
        catch {
          // Keep the durable reservation pending so another worker cannot
          // repeat a provider write whose response was already confirmed.
          result.body.completionRecorded = false;
        }
      }
      return result;
    };
    const entry = previous || { fingerprint, expiresAt: now + 10 * 60 * 1000, result: run() };
    if (!previous) requests.set(key, entry);
    const result = await entry.result;
    res.status(result.status).json(result.body);
  });
}

module.exports = { SUPPORTED, parseTarget, createSourceInteractions, registerSourceInteractionRoutes };
