'use strict';

// Account publishing is deliberately destination-specific. Profile access alone
// never proves that the member may write to a repository, channel, or file.
const VIDEO_MAX_BYTES = 64 * 1024 * 1024;
const HOSTS = new Set(['api.github.com', 'gitlab.com', 'discord.com', 'api.twitch.tv', 'api.figma.com', 'www.googleapis.com', 'youtube.googleapis.com']);

function problem(message, status = 400, reconnectRequired = false) {
  return Object.assign(new Error(message), { status, reconnectRequired });
}
function unconfirmed(message) { return Object.assign(problem(message, 502), { deliveryUncertain: true }); }
function text(value, max, label, required = true) {
  const result = typeof value === 'string' ? value.trim() : '';
  if ((required && !result) || result.length > max) throw problem(`${label} ${result ? `must be at most ${max} characters` : 'is required'}.`);
  return result;
}
function credentials(value) {
  let token = value;
  if (typeof token === 'string' && token.trim().startsWith('{')) {
    try { token = JSON.parse(token); } catch { throw problem('Reconnect this account before publishing.', 401, true); }
  }
  if (typeof token === 'string') return { accessToken: token };
  if (token && typeof token === 'object') return { ...token, accessToken: token.accessToken || token.access_token };
  throw problem('Reconnect this account before publishing.', 401, true);
}
function authorization(value) {
  const token = credentials(value);
  if (!token.accessToken || typeof token.accessToken !== 'string' || /[\r\n]/.test(token.accessToken)) throw problem('Reconnect this account before publishing.', 401, true);
  return { Authorization: `Bearer ${token.accessToken}` };
}
function linkedText(content, mediaUrl, max) {
  const body = text(content, max, 'Post text', false);
  let media = '';
  if (mediaUrl) {
    let parsed;
    try { parsed = new URL(mediaUrl); } catch { throw problem('The uploaded media URL is invalid.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw problem('The uploaded media URL must use HTTPS.');
    media = parsed.href;
  }
  return text([body, media].filter(Boolean).join('\n\n'), max, 'Post text');
}
function safePublicUrl(value, hostname, fallback) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === hostname && !url.username && !url.password) return url.href;
  } catch { /* use a provider URL built from verified IDs */ }
  return fallback;
}
function capability(label, publishType, options = {}) {
  return { supported: true, delivery: 'direct', media: 'link', allowedMedia: ['text', 'image', 'video'], requiresPhoto: false, settingsRequired: true, publishType, label, ...options };
}
function posted(providerId, destinationId, postedUrl, extra = {}) {
  return { status: 'posted', delivery: 'direct', providerId: String(providerId), publishId: String(providerId), destinationId: String(destinationId), postedUrl, ...extra };
}
function repositoryId(value) {
  const id = text(value, 201, 'Repository');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(id) || id.split('/').some(part => part === '.' || part === '..')) throw problem('Choose a valid GitHub repository.');
  return id;
}
function projectId(value) {
  const id = String(value || '').trim();
  if (!/^[1-9]\d{0,15}$/.test(id)) throw problem('Choose a valid GitLab project.');
  return id;
}
function snowflake(value) { return typeof value === 'string' && /^\d{5,22}$/.test(value); }
function fileKey(value) {
  let key = text(value, 1000, 'Figma file URL or key');
  if (/^https?:/i.test(key)) {
    let url;
    try { url = new URL(key); } catch { throw problem('Enter a valid Figma file URL.'); }
    if (url.protocol !== 'https:' || !['www.figma.com', 'figma.com'].includes(url.hostname) || url.username || url.password) throw problem('Enter a Figma file URL using HTTPS.');
    const match = url.pathname.match(/^\/(?:file|design|board|slides|proto)\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (!match) throw problem('Enter a Figma file URL or file key.');
    key = match[1];
  }
  if (!/^[A-Za-z0-9_-]{5,200}$/.test(key)) throw problem('Enter a valid Figma file key.');
  return key;
}

function createAccountPublishingAdapters({ env = process.env, request, downloadMedia } = {}) {
  if (typeof request !== 'function') throw new TypeError('A publishing request function is required.');
  async function call(url, options = {}, allowed = []) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !HOSTS.has(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw problem('Invalid provider request destination.');
    let response;
    try { response = await request(parsed.href, { timeoutMs: 20000, ...options }); }
    catch (error) {
      // Never surface a webhook token, bearer token, request body, or upload URL.
      const status = Number(error?.status || error?.statusCode);
      throw Object.assign(problem(status === 401 || status === 403 ? 'Publishing access was denied. Reconnect this account and check its permissions.' : 'The provider request could not be completed. Check the destination before retrying.', status === 401 || status === 403 ? status : 502, status === 401 || status === 403), { deliveryUncertain: error?.deliveryUncertain === true });
    }
    const status = Number(response?.status);
    if (!(status >= 200 && status < 300) && !allowed.includes(status)) {
      if (status === 401 || status === 403) throw problem('Publishing access was denied. Reconnect this account and check its permissions.', status, true);
      throw Object.assign(problem(status === 404 ? 'The selected destination or existing tag is unavailable.' : status === 409 || status === 422 ? 'The provider rejected this publication. Check whether this destination already contains it.' : 'The provider could not complete this publication.', status >= 400 && status <= 499 ? status : 502), { deliveryUncertain: status >= 500 && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method) });
    }
    return { ...response, status, data: response.data || {}, headers: response.headers || {} };
  }
  async function githubUser(token) {
    const response = await call('https://api.github.com/user', { headers: githubHeaders(token) });
    if (!response.data.id || !response.data.login) throw problem('GitHub could not verify the connected member.', 502);
    return response.data;
  }
  function githubHeaders(token) { return { ...authorization(token), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'UFIConnect' }; }
  async function githubRepository(token, destination) {
    const id = repositoryId(destination);
    const path = id.split('/').map(encodeURIComponent).join('/');
    const { data } = await call(`https://api.github.com/repos/${path}`, { headers: githubHeaders(token) });
    if (data.full_name?.toLowerCase() !== id.toLowerCase() || data.private !== false || !data.permissions?.push || data.archived || data.disabled) throw problem('Choose an active public repository where you have push access.', 403);
    return { id: data.full_name, path: data.full_name.split('/').map(encodeURIComponent).join('/'), data };
  }
  function releaseFields(tags = []) {
    return [
      { key: 'title', label: 'Release title', type: 'text', required: true, maxLength: 200 },
      { key: 'tagName', label: 'Existing release tag', type: 'select', required: true, options: tags.map(tag => ({ value: tag.name, label: tag.name })) },
    ];
  }
  const github = {
    capability: capability('GitHub release', 'release'),
    async destinations(token, query = {}) {
      const user = await githubUser(token);
      const rows = [];
      for (let page = 1; page <= 10; page++) {
        const { data } = await call(`https://api.github.com/user/repos?visibility=public&affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`, { headers: githubHeaders(token) });
        if (!Array.isArray(data)) throw problem('GitHub returned an invalid repository list.', 502);
        rows.push(...data.filter(repo => repo.private === false && repo.permissions?.push && !repo.archived && !repo.disabled));
        if (data.length < 100) break;
      }
      let tags = [];
      if (query.destinationId) {
        const repo = await githubRepository(token, query.destinationId);
        const response = await call(`https://api.github.com/repos/${repo.path}/tags?per_page=100`, { headers: githubHeaders(token) });
        tags = Array.isArray(response.data) ? response.data : [];
      }
      return { account: { id: String(user.id), label: user.name || user.login, handle: user.login }, label: 'GitHub release', destinationLabel: 'Public repository', destinations: rows.map(repo => ({ id: repo.full_name, label: repo.full_name })), fields: releaseFields(tags), notice: 'Publishes release notes against an existing tag. Choose a repository, then an existing tag; no code or tags are created.' };
    },
    async publish(token, { content, mediaUrl, settings = {} }) {
      const user = await githubUser(token);
      const repo = await githubRepository(token, settings.destinationId);
      const title = text(settings.title, 200, 'Release title');
      const tag = text(settings.tagName, 200, 'Existing release tag');
      const headers = githubHeaders(token);
      const existing = await call(`https://api.github.com/repos/${repo.path}/git/ref/tags/${encodeURIComponent(tag)}`, { headers });
      if (existing.data.ref !== `refs/tags/${tag}` || !existing.data.object?.sha) throw problem('Choose an existing repository tag.');
      const duplicate = await call(`https://api.github.com/repos/${repo.path}/releases/tags/${encodeURIComponent(tag)}`, { headers }, [404]);
      if (duplicate.status !== 404) throw problem('This tag already has a release. Choose another existing tag.', 409);
      const { data } = await call(`https://api.github.com/repos/${repo.path}/releases`, { method: 'POST', headers, json: { tag_name: tag, name: title, body: linkedText(content, mediaUrl, 100000), draft: false, prerelease: false, make_latest: 'false' } });
      if (!data.id || data.tag_name !== tag || data.draft !== false || String(data.author?.id) !== String(user.id)) throw unconfirmed('GitHub did not confirm a published release. Check the repository before retrying.');
      return posted(data.id, repo.id, safePublicUrl(data.html_url, 'github.com', `https://github.com/${repo.id}/releases/tag/${encodeURIComponent(tag)}`));
    },
  };

  async function gitlabUser(token) {
    const { data } = await call('https://gitlab.com/api/v4/user', { headers: authorization(token) });
    if (!data.id) throw problem('GitLab could not verify the connected member.', 502);
    return data;
  }
  async function gitlabProject(token, id, user) {
    const destination = projectId(id);
    const { data } = await call(`https://gitlab.com/api/v4/projects/${destination}`, { headers: authorization(token) });
    if (String(data.id) !== destination || data.archived || data.releases_access_level === 'disabled') throw problem('Choose an active GitLab project with releases enabled.', 403);
    const member = await call(`https://gitlab.com/api/v4/projects/${destination}/members/all/${encodeURIComponent(user.id)}`, { headers: authorization(token) });
    if (Number(member.data.access_level) < 30 || String(member.data.id) !== String(user.id)) throw problem('GitLab requires Developer access to publish this release.', 403);
    return data;
  }
  const gitlab = {
    capability: capability('GitLab release', 'release'),
    async destinations(token, query = {}) {
      const user = await gitlabUser(token);
      const rows = [];
      for (let page = 1; page <= 10; page++) {
        const { data } = await call(`https://gitlab.com/api/v4/projects?membership=true&min_access_level=30&archived=false&simple=true&per_page=100&page=${page}`, { headers: authorization(token) });
        if (!Array.isArray(data)) throw problem('GitLab returned an invalid project list.', 502);
        rows.push(...data.filter(project => !project.archived));
        if (data.length < 100) break;
      }
      let tags = [];
      if (query.destinationId) {
        const project = await gitlabProject(token, query.destinationId, user);
        const response = await call(`https://gitlab.com/api/v4/projects/${project.id}/repository/tags?per_page=100`, { headers: authorization(token) });
        tags = Array.isArray(response.data) ? response.data : [];
      }
      return { account: { id: String(user.id), label: user.name || user.username || `GitLab account ${user.id}`, handle: user.username }, label: 'GitLab release', destinationLabel: 'Project', destinations: rows.map(project => ({ id: String(project.id), label: project.path_with_namespace || project.name })), fields: releaseFields(tags), notice: 'Publishes release notes against an existing tag. Developer access and GitLab API permission are required.' };
    },
    async publish(token, { content, mediaUrl, settings = {} }) {
      const user = await gitlabUser(token);
      const project = await gitlabProject(token, settings.destinationId, user);
      const tag = text(settings.tagName, 200, 'Existing release tag');
      const title = text(settings.title, 200, 'Release title');
      const headers = authorization(token);
      const existing = await call(`https://gitlab.com/api/v4/projects/${project.id}/repository/tags/${encodeURIComponent(tag)}`, { headers });
      if (existing.data.name !== tag || !existing.data.commit?.id) throw problem('Choose an existing project tag.');
      const duplicate = await call(`https://gitlab.com/api/v4/projects/${project.id}/releases/${encodeURIComponent(tag)}`, { headers }, [404]);
      if (duplicate.status !== 404) throw problem('This tag already has a release. Choose another existing tag.', 409);
      const { data } = await call(`https://gitlab.com/api/v4/projects/${project.id}/releases`, { method: 'POST', headers, json: { tag_name: tag, name: title, description: linkedText(content, mediaUrl, 100000) } });
      if (data.tag_name !== tag || !data._links?.self || String(data.author?.id) !== String(user.id)) throw unconfirmed('GitLab did not confirm a published release. Check the project before retrying.');
      return posted(tag, project.id, safePublicUrl(data._links.self, 'gitlab.com', `https://gitlab.com/${project.path_with_namespace}/-/releases/${encodeURIComponent(tag)}`));
    },
  };

  async function discordWebhook(value) {
    const token = credentials(value);
    const saved = token.webhook;
    if (!saved || !snowflake(saved.id) || !snowflake(saved.channel_id) || !snowflake(saved.guild_id) || typeof saved.token !== 'string' || !/^[A-Za-z0-9_.-]{10,250}$/.test(saved.token)) throw problem('Reconnect Discord and select a server channel to allow publishing.', 401, true);
    const identity = await call('https://discord.com/api/v10/users/@me', { headers: authorization(token) });
    if (!snowflake(String(identity.data.id || ''))) throw problem('Discord could not verify the connected member.', 502);
    const endpoint = `https://discord.com/api/v10/webhooks/${saved.id}/${saved.token}`;
    const { data } = await call(endpoint);
    if (String(data.id) !== saved.id || String(data.channel_id) !== saved.channel_id || String(data.guild_id) !== saved.guild_id || String(data.application_id) !== String(env.DISCORD_CLIENT_ID || '') || data.type !== 1) throw problem('The Discord publishing channel no longer matches this connection. Reconnect Discord.', 403, true);
    return { endpoint, webhook: data, saved, account: { id: String(identity.data.id), label: identity.data.global_name || identity.data.username || `Discord account ${identity.data.id}`, handle: identity.data.username } };
  }
  const discord = {
    capability: capability('Discord channel message', 'channel-message'),
    async destinations(token) {
      const { webhook, saved, account } = await discordWebhook(token);
      return { account, label: 'Discord channel message', destinationLabel: 'Authorized server channel', destinations: [{ id: saved.channel_id, label: webhook.name ? `${webhook.name} · channel ${saved.channel_id}` : `Channel ${saved.channel_id}` }], fields: [{ key: 'threadName', label: 'New post title (required for forum channels)', type: 'text', maxLength: 100 }], notice: 'Posts through the webhook in the channel you selected during Discord authorization. Mentions are disabled. Reconnect to choose another channel.' };
    },
    async publish(token, { content, mediaUrl, settings = {} }) {
      const { endpoint, saved } = await discordWebhook(token);
      if (String(settings.destinationId || '') !== saved.channel_id) throw problem('Choose the Discord channel authorized for this connection.');
      const threadName = text(settings.threadName, 100, 'Forum post title', false);
      const { data } = await call(`${endpoint}?wait=true`, { method: 'POST', json: { content: linkedText(content, mediaUrl, 2000), allowed_mentions: { parse: [] }, ...(threadName ? { thread_name: threadName } : {}) } });
      const inAuthorizedChannel = String(data.channel_id) === saved.channel_id;
      const inCreatedThread = threadName && String(data.webhook_id) === saved.id && snowflake(String(data.channel_id || ''));
      if (!snowflake(String(data.id || '')) || (!inAuthorizedChannel && !inCreatedThread)) throw unconfirmed('Discord did not confirm the message. Check the channel before retrying.');
      return posted(data.id, saved.channel_id, `https://discord.com/channels/${saved.guild_id}/${data.channel_id}/${data.id}`);
    },
  };

  function twitchHeaders(token) {
    const clientId = String(env.TWITCH_CLIENT_ID || '').trim();
    if (!clientId || /[\r\n]/.test(clientId)) throw problem('Twitch publishing is not configured.', 503);
    return { ...authorization(token), 'Client-Id': clientId };
  }
  async function twitchUser(token) {
    const { data } = await call('https://api.twitch.tv/helix/users', { headers: twitchHeaders(token) });
    const user = data.data?.[0];
    if (!user?.id || !user.login) throw problem('Twitch could not verify the connected member.', 502);
    return user;
  }
  const twitch = {
    capability: capability('Twitch channel chat', 'chat-message'),
    async destinations(token) {
      const user = await twitchUser(token);
      return { account: { id: String(user.id), label: user.display_name || user.login, handle: user.login }, label: 'Twitch channel chat', destinationLabel: 'Your channel chat', destinations: [{ id: String(user.id), label: `${user.display_name || user.login} · channel chat` }], fields: [], notice: 'Sends a chat message in your own channel; this does not create a stream or upload a video. Shared Chat can also relay it to other participating channels.' };
    },
    async publish(token, { content, mediaUrl, settings = {} }) {
      const user = await twitchUser(token);
      if (String(settings.destinationId || '') !== String(user.id)) throw problem('Choose your own Twitch channel chat.');
      const { data } = await call('https://api.twitch.tv/helix/chat/messages', { method: 'POST', headers: twitchHeaders(token), json: { broadcaster_id: String(user.id), sender_id: String(user.id), message: linkedText(content, mediaUrl, 500) } });
      const result = data.data?.[0];
      if (result?.is_sent === false) throw problem('Twitch did not send this chat message. Check channel restrictions before retrying.', 422);
      if (result?.is_sent !== true || typeof result.message_id !== 'string' || !result.message_id) throw unconfirmed('Twitch did not confirm this chat message. Check the channel before retrying.');
      return posted(result.message_id, user.id, `https://www.twitch.tv/${encodeURIComponent(user.login)}`);
    },
  };

  async function figmaUser(token) {
    const { data } = await call('https://api.figma.com/v1/me', { headers: authorization(token) });
    if (!data.id) throw problem('Figma could not verify the connected member.', 502);
    return data;
  }
  async function figmaAccess(token, destination) {
    const key = fileKey(destination);
    const { data } = await call(`https://api.figma.com/v1/files/${encodeURIComponent(key)}/comments`, { headers: authorization(token) });
    if (!Array.isArray(data.comments)) throw problem('Figma could not verify access to this file.', 502);
    return key;
  }
  const figma = {
    capability: capability('Figma file comment', 'file-comment'),
    async destinations(token, query = {}) {
      const user = await figmaUser(token);
      const destinations = [];
      if (query.destinationId) {
        const key = await figmaAccess(token, query.destinationId);
        destinations.push({ id: key, label: `Figma file ${key}` });
      }
      return { account: { id: String(user.id), label: user.handle || `Figma account ${user.id}`, handle: user.handle }, label: 'Figma file comment', destinationLabel: 'Figma file URL or key', destinations, allowCustomDestination: true, fields: [], notice: 'Adds a comment to a file you can access. This does not publish a Figma Community resource.' };
    },
    async publish(token, { content, mediaUrl, settings = {} }) {
      const user = await figmaUser(token);
      const key = await figmaAccess(token, settings.destinationId);
      const { data } = await call(`https://api.figma.com/v1/files/${encodeURIComponent(key)}/comments`, { method: 'POST', headers: authorization(token), json: { message: linkedText(content, mediaUrl, 10000) } });
      if (!data.id || String(data.user?.id) !== String(user.id) || data.file_key !== key) throw unconfirmed('Figma did not confirm your file comment. Check the file before retrying.');
      return posted(data.id, key, `https://www.figma.com/file/${encodeURIComponent(key)}?comment-id=${encodeURIComponent(data.id)}`);
    },
  };

  async function youtubeChannels(token) {
    const { data } = await call('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50', { headers: authorization(token) });
    if (!Array.isArray(data.items)) throw problem('YouTube could not verify your channel.', 502);
    return data.items;
  }
  function youtubeFields() {
    return [
      { key: 'title', label: 'Video title', type: 'text', required: true, maxLength: 100 },
      { key: 'privacyStatus', label: 'Video visibility', type: 'select', required: true, options: [{ value: 'public', label: 'Public' }, { value: 'unlisted', label: 'Unlisted' }, { value: 'private', label: 'Private' }] },
      { key: 'madeForKids', label: 'Is this video made for kids?', type: 'select', required: true, options: [{ value: 'yes', label: 'Yes, made for kids' }, { value: 'no', label: 'No, not made for kids' }] },
      { key: 'notifySubscribers', label: 'Notify subscribers', type: 'checkbox' },
    ];
  }
  async function youtubeStatus(token, target) {
    const id = text(String(target.providerId || target.publishId || ''), 64, 'YouTube video ID');
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw problem('Invalid YouTube video ID.');
    const channels = await youtubeChannels(token);
    const destination = String(target.destinationId || '');
    if (!destination || !channels.some(channel => channel.id === destination)) throw problem('This YouTube video belongs to a different connected channel.', 403);
    const { data } = await call(`https://www.googleapis.com/youtube/v3/videos?part=snippet,status,processingDetails&id=${encodeURIComponent(id)}`, { headers: authorization(token) });
    const video = data.items?.find(item => item.id === id);
    if (!video) return { ...target, status: 'processing', delivery: 'direct', providerId: id, publishId: id };
    if (video.snippet?.channelId !== destination) throw problem('YouTube returned a video from another channel.', 403);
    const privacyStatus = target.privacyStatus || target.settings?.privacyStatus;
    const result = { delivery: 'direct', providerId: id, publishId: id, destinationId: destination, privacyStatus, postedUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` };
    if (['failed', 'rejected', 'deleted'].includes(video.status?.uploadStatus) || ['failed', 'terminated'].includes(video.processingDetails?.processingStatus)) return { ...result, status: 'failed', error: 'YouTube could not process or publish this video. Review it in YouTube Studio.' };
    if (privacyStatus && video.status?.privacyStatus !== privacyStatus) return { ...result, status: 'handoff', error: 'YouTube changed the requested visibility. Review the video in YouTube Studio.' };
    if (video.status?.uploadStatus === 'processed' && video.processingDetails?.processingStatus !== 'processing') return { ...result, status: 'posted' };
    return { ...result, status: 'processing' };
  }
  const youtube = {
    capability: capability('YouTube video', 'video-upload', { media: 'video', requiresVideo: true, allowedMedia: ['video'], maxMediaBytes: VIDEO_MAX_BYTES, maxVideoBytes: VIDEO_MAX_BYTES }),
    async destinations(token) {
      const channels = await youtubeChannels(token);
      return { ...(channels.length === 1 ? { account: { id: channels[0].id, label: channels[0].snippet?.title || channels[0].id } } : {}), label: 'YouTube video', destinationLabel: 'YouTube channel', destinations: channels.map(channel => ({ id: channel.id, label: channel.snippet?.title || channel.id })), fields: youtubeFields(), notice: 'Uploads the selected video (up to 64 MB). Choose visibility and audience. The upload stays processing until YouTube confirms it is ready.' };
    },
    async publish(token, { content, mediaUrl, mediaType, settings = {} }) {
      if (mediaType !== 'video' || !mediaUrl) throw problem('Choose an uploaded video for YouTube.');
      const title = text(settings.title, 100, 'Video title');
      if (/[<>]/.test(title)) throw problem('YouTube video titles cannot contain angle brackets.');
      const description = text(content, 5000, 'Video description', false);
      if (Buffer.byteLength(description, 'utf8') > 5000) throw problem('YouTube video descriptions must be at most 5000 bytes.');
      if (/[<>]/.test(description)) throw problem('YouTube video descriptions cannot contain angle brackets.');
      if (!['public', 'unlisted', 'private'].includes(settings.privacyStatus)) throw problem('Choose YouTube video visibility.');
      if (!['yes', 'no'].includes(settings.madeForKids)) throw problem('Choose whether the YouTube video is made for kids.');
      if (settings.notifySubscribers !== undefined && typeof settings.notifySubscribers !== 'boolean') throw problem('The subscriber notification setting is invalid.');
      const channels = await youtubeChannels(token);
      const destination = String(settings.destinationId || '');
      if (!destination || !channels.some(channel => channel.id === destination)) throw problem('Choose a channel authorized by your YouTube connection.');
      if (typeof downloadMedia !== 'function') throw problem('YouTube video upload is not configured.', 503);
      const media = await downloadMedia(mediaUrl, { kind: 'video', maxBytes: VIDEO_MAX_BYTES });
      if (!Buffer.isBuffer(media?.body) || !media.body.length || media.body.length > VIDEO_MAX_BYTES || !/^video\/[A-Za-z0-9.+-]+$/i.test(media.contentType || '')) throw problem('Choose a valid video file up to 64 MB.', 413);
      const notify = settings.notifySubscribers === true;
      const start = await call(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${notify}`, { method: 'POST', headers: { ...authorization(token), 'X-Upload-Content-Length': String(media.body.length), 'X-Upload-Content-Type': media.contentType }, json: { snippet: { title, description }, status: { privacyStatus: settings.privacyStatus, selfDeclaredMadeForKids: settings.madeForKids === 'yes' } } });
      let location;
      try { location = new URL(start.headers.location); } catch { throw problem('YouTube did not create a video upload session.', 502); }
      if (location.protocol !== 'https:' || !['www.googleapis.com', 'youtube.googleapis.com'].includes(location.hostname) || location.username || location.password || location.port || !location.pathname.startsWith('/upload/youtube/v3/videos')) throw problem('YouTube returned an invalid upload session.', 502);
      const upload = await call(location.href, { method: 'PUT', headers: { ...authorization(token), 'Content-Type': media.contentType, 'Content-Length': String(media.body.length) }, body: media.body, timeoutMs: 120000 });
      const video = upload.data;
      if (!/^[A-Za-z0-9_-]{6,64}$/.test(video.id || '') || video.snippet?.channelId !== destination) throw unconfirmed('YouTube did not confirm this channel video upload. Check YouTube Studio before retrying.');
      const target = { status: 'processing', delivery: 'direct', publishId: video.id, providerId: video.id, destinationId: destination, privacyStatus: settings.privacyStatus, postedUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}` };
      // Only an actual accepted upload is pending. History polling verifies the
      // provider's processing status before it can become posted.
      return target;
    },
    sync: youtubeStatus,
  };
  return { github, gitlab, discord, twitch, figma, youtube };
}

module.exports = { createAccountPublishingAdapters, VIDEO_MAX_BYTES };
