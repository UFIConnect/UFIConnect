'use strict';

// Each adapter writes through a member's own grant. Provider replies and tokens
// stay on the server; only an allowlisted delivery receipt reaches the client.
const BASES = Object.freeze({
  pinterest: 'https://api.pinterest.com/v5',
  tumblr: 'https://api.tumblr.com/v2',
  wordpress: 'https://public-api.wordpress.com/rest/v1.1',
  devto: 'https://dev.to/api',
  medium: 'https://api.medium.com/v1',
  dribbble: 'https://api.dribbble.com/v2',
});
const APPROVALS = Object.freeze({
  pinterest: 'PINTEREST_STANDARD_ACCESS_APPROVED',
  medium: 'MEDIUM_LEGACY_ACCESS_APPROVED',
  dribbble: 'DRIBBBLE_USE_APPROVED',
});
const LABELS = { pinterest: 'Pinterest', tumblr: 'Tumblr', wordpress: 'WordPress.com', devto: 'DEV Community', medium: 'Medium', dribbble: 'Dribbble' };

function fail(message, status = 400, code = 'publishing_invalid') {
  return Object.assign(new Error(message), { status, code });
}
function text(value, max = 200) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function objectId(value) {
  const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value)
    : typeof value === 'string' && value.trim().length <= 256 ? value.trim() : '';
  return /^[A-Za-z0-9:_-]+$/.test(id) ? id : '';
}
function title(settings, max = 200) {
  if (typeof settings?.title !== 'string' || !settings.title.trim() || settings.title.trim().length > max) {
    throw fail(`Enter a title of 1–${max} characters.`);
  }
  return settings.title.trim();
}
function contentText(value) {
  if (typeof value !== 'string' || !value.trim()) throw fail('Enter content before publishing.');
  if (value.length > 100000) throw fail('Content must be at most 100,000 characters.');
  return value.trim();
}
function destination(settings) {
  const id = objectId(settings?.destinationId);
  if (!id) throw fail('Choose a publishing destination.');
  return id;
}
function publicUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|authorization|^code$/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}
function optionalLink(value) {
  if (!value) return '';
  const url = publicUrl(value);
  if (!url) throw fail('Use a valid HTTPS link.');
  return url;
}
function imageUrl(value, mediaType) {
  if (!value) return '';
  if (mediaType && mediaType !== 'image') throw fail('This destination accepts an image attachment.');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.username || url.password || url.port ||
        !/^\/[A-Za-z0-9_-]+\/image\/upload\//.test(url.pathname) || url.search || url.hash) throw Error();
    return url.toString();
  } catch { throw fail('Attach an image uploaded to UFIConnect.'); }
}
function html(value) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function paragraphs(value) { return value.split(/\n\s*\n/).map(part => `<p>${html(part).replace(/\n/g, '<br>')}</p>`).join('\n'); }
function tagList(value, max) {
  return typeof value === 'string' ? [...new Set(value.split(',').map(tag => tag.trim()).filter(Boolean))].slice(0, max) : [];
}
function fields(max = 200, extra = []) {
  return [{ key: 'title', label: 'Title', type: 'text', required: true, maxLength: max }, ...extra];
}
function filterDestinations(items, query) {
  const search = text(typeof query === 'string' ? query : query?.q || query?.search, 100).toLowerCase();
  return search ? items.filter(item => `${item.label} ${item.description || ''}`.toLowerCase().includes(search)) : items;
}
function receipt(id, destinationId, status = 'processing', providerStatus, postedUrl) {
  const result = { status, delivery: 'direct', publishId: String(id), providerId: String(id), destinationId };
  if (providerStatus) result.providerStatus = text(providerStatus, 60);
  const url = publicUrl(postedUrl);
  if (url) result.postedUrl = url;
  return result;
}
function capability(label, publishType, extra = {}) {
  return { supported: true, delivery: 'direct', media: 'native-image', allowedMedia: ['text', 'image'], requiresPhoto: false, settingsRequired: true, publishType, label, ...extra };
}
function dribbbleImageUrl(value) {
  const url = new URL(imageUrl(value, 'image'));
  // Pad preserves the entire member image and meets Dribbble's exact size.
  // Apply it after any existing transformations, before the upload version.
  const parts = url.pathname.split('/');
  let version = parts.findIndex((part, index) => index >= 4 && /^v\d+$/.test(part));
  if (version < 0) {
    version = 4;
    while (parts[version] && /^(?:[a-z][a-z0-9]*_)/i.test(parts[version])) version++;
  }
  parts.splice(version, 0, 'c_pad,w_800,h_600,b_white', 'f_png');
  url.pathname = parts.join('/');
  return url.toString();
}

function createBlogPublishingAdapters({ env = process.env, request, downloadMedia } = {}) {
  if (typeof request !== 'function') throw new TypeError('A provider request function is required.');
  function approval(provider) {
    const setting = APPROVALS[provider];
    if (setting && String(env[setting] || '').trim().toLowerCase() !== 'true') {
      throw fail(`${LABELS[provider]} publishing requires verified provider access.`, 403, 'provider_approval_required');
    }
  }
  async function call(provider, token, path, options = {}) {
    approval(provider);
    if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw fail('Reconnect this source before publishing.', 401, 'source_not_connected');
    if (!path.startsWith('/') || path.startsWith('//')) throw new TypeError('Provider paths must be relative.');
    const { allowStatuses = [], ...requestOptions } = options;
    const headers = provider === 'devto'
      ? { 'api-key': token, Accept: 'application/vnd.forem.api-v1+json' }
      : { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    let response;
    try {
      response = await request(`${BASES[provider]}${path}`, { timeoutMs: 30000, ...requestOptions, headers: { ...headers, ...requestOptions.headers } });
    } catch {
      const error = fail(`${LABELS[provider]} could not confirm the request.`, 502, 'provider_unavailable');
      if (requestOptions.method && requestOptions.method !== 'GET') error.deliveryUncertain = true;
      throw error;
    }
    const status = Number(response?.status);
    if ((status >= 200 && status < 300) || allowStatuses.includes(status)) return response;
    const error = fail(status === 401 || status === 403
      ? `Reconnect ${LABELS[provider]} and grant publishing access.`
      : `${LABELS[provider]} rejected the request (${Number.isFinite(status) ? status : 'invalid response'}).`,
    status === 401 || status === 403 ? status : 502, 'provider_request_failed');
    error.providerStatus = status;
    if (requestOptions.method === 'POST' && status >= 500) error.deliveryUncertain = true;
    throw error;
  }
  function createdId(data, keys = ['id']) {
    const ids = [];
    for (const key of keys) {
      const id = objectId(data?.[key]);
      if (id) ids.push(id);
    }
    if (new Set(ids).size > 1) throw uncertainReceipt();
    if (ids.length) return ids[0];
    throw Object.assign(fail('The provider did not return a publishing receipt. Check the destination before retrying.', 502, 'provider_receipt_missing'), { deliveryUncertain: true });
  }
  function uncertainReceipt() {
    return Object.assign(fail('The provider returned conflicting or incomplete publishing details. Check the destination before retrying.', 502, 'provider_receipt_invalid'), { deliveryUncertain: true });
  }

  async function pinterestBoards(token) {
    const boards = [], seen = new Set();
    let bookmark = '';
    for (let page = 0; page < 20; page++) {
      const { data } = await call('pinterest', token, `/boards?page_size=100${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ''}`);
      if (!Array.isArray(data?.items)) throw fail('Pinterest could not verify your boards.', 502);
      for (const board of data.items) {
        const id = objectId(board.id);
        if (id && board.privacy === 'PUBLIC') boards.push({ id, label: text(board.name) || 'Pinterest board', description: 'Public board' });
      }
      if (!data.bookmark) return boards;
      bookmark = text(data.bookmark, 2000);
      if (!bookmark || seen.has(bookmark)) break;
      seen.add(bookmark);
    }
    throw fail('Pinterest could not verify the complete board list. Try again.', 502);
  }
  async function pinterestStatus(token, id, boardId, fallback) {
    try {
      const { data } = await call('pinterest', token, `/pins/${encodeURIComponent(id)}`);
      if (objectId(data?.id) !== id || String(data?.board_id) !== boardId) throw uncertainReceipt();
      if (data?.is_removable === true) return receipt(id, boardId, 'handoff', 'ad_only');
      return receipt(id, boardId, 'posted', 'published', `https://www.pinterest.com/pin/${id}/`);
    } catch (error) { if (error.deliveryUncertain) throw error; return fallback; }
  }
  const pinterest = {
    capability: capability('Pinterest Pin', 'pin', { requiresPhoto: true, allowedMedia: ['image'] }),
    async destinations(token, query) {
      return { label: 'Pinterest Pin', destinationLabel: 'Public board', destinations: filterDestinations(await pinterestBoards(token), query), fields: fields(100, [{ key: 'link', label: 'Destination link (optional)', type: 'text', maxLength: 2000 }]), notice: 'Publish an image Pin to a public board. Pinterest Standard access is required.' };
    },
    async publish(token, { content, mediaUrl, mediaType, settings = {} }) {
      const boardId = destination(settings), pinTitle = title(settings, 100), description = contentText(content), photo = imageUrl(mediaUrl, mediaType);
      if (!photo) throw fail('Attach an image for Pinterest.');
      if (description.length > 800) throw fail('Pinterest descriptions must be at most 800 characters.');
      const link = optionalLink(settings.link);
      if (!(await pinterestBoards(token)).some(board => board.id === boardId)) throw fail('Choose one of your current public Pinterest boards.', 403, 'destination_not_authorized');
      const { data } = await call('pinterest', token, '/pins', { method: 'POST', json: { board_id: boardId, title: pinTitle, description, ...(link ? { link } : {}), media_source: { source_type: 'image_url', url: photo } } });
      const id = createdId(data), pending = receipt(id, boardId);
      if (data.board_id != null && String(data.board_id) !== boardId) throw uncertainReceipt();
      if (String(data.board_id) === boardId && data.is_removable !== true) return receipt(id, boardId, 'posted', 'published', `https://www.pinterest.com/pin/${id}/`);
      return pinterestStatus(token, id, boardId, pending);
    },
    async sync(token, saved = {}) {
      const id = objectId(saved.publishId || saved.providerId), boardId = destination(saved);
      if (!id) throw fail('Pinterest publishing receipt is missing.');
      if (!(await pinterestBoards(token)).some(board => board.id === boardId)) return receipt(id, boardId, 'handoff', 'destination_unavailable');
      return pinterestStatus(token, id, boardId, receipt(id, boardId));
    },
  };

  async function tumblrBlogs(token) {
    const { data } = await call('tumblr', token, '/user/info');
    const blogs = data?.response?.user?.blogs;
    if (!Array.isArray(blogs)) throw fail('Tumblr could not verify your blogs.', 502);
    return blogs.filter(blog => blog.type !== 'private' && blog.is_private !== true && /^[a-z0-9-]{1,128}$/i.test(blog.name || ''))
      .map(blog => ({ id: blog.name, label: text(blog.title) || blog.name, description: blog.name }));
  }
  async function tumblrStatus(token, id, blog, fallback) {
    try {
      const { data } = await call('tumblr', token, `/blog/${encodeURIComponent(blog)}/posts/${encodeURIComponent(id)}`);
      const post = data?.response;
      if (createdId(post, ['id', 'id_string']) !== id ||
          (post.blog_name != null && post.blog_name !== blog) ||
          (post.blog?.name != null && post.blog.name !== blog)) throw uncertainReceipt();
      if (post.state === 'published') return receipt(id, blog, 'posted', 'published', post.post_url || `https://${blog}.tumblr.com/post/${id}`);
      if (['draft', 'private', 'queue', 'queued', 'unapproved'].includes(post.state)) return receipt(id, blog, 'handoff', post.state, post.post_url);
      return fallback;
    } catch (error) { if (error.deliveryUncertain) throw error; return fallback; }
  }
  const tumblr = {
    capability: capability('Tumblr post', 'blog-post'),
    async destinations(token, query) {
      return { label: 'Tumblr post', destinationLabel: 'Public blog', destinations: filterDestinations(await tumblrBlogs(token), query), fields: [], notice: 'Publishes immediately to the selected blog.' };
    },
    async publish(token, { content, mediaUrl, mediaType, settings = {} }) {
      const blog = destination(settings), body = contentText(content), photo = imageUrl(mediaUrl, mediaType);
      if (!(await tumblrBlogs(token)).some(item => item.id === blog)) throw fail('Choose a Tumblr blog you can publish to.', 403, 'destination_not_authorized');
      const blocks = body.split(/\n\s*\n/).map(part => ({ type: 'text', text: part }));
      if (photo) blocks.push({ type: 'image', media: [{ url: photo }], alt_text: text(settings.altText, 500) });
      const { data } = await call('tumblr', token, `/blog/${encodeURIComponent(blog)}/posts`, { method: 'POST', json: { content: blocks, state: 'published', send_to_twitter: false } });
      const id = createdId(data?.response, ['id', 'id_string']);
      return tumblrStatus(token, id, blog, receipt(id, blog));
    },
    async sync(token, saved = {}) {
      const id = objectId(saved.publishId || saved.providerId), blog = destination(saved);
      if (!id) throw fail('Tumblr publishing receipt is missing.');
      if (!(await tumblrBlogs(token)).some(item => item.id === blog)) return receipt(id, blog, 'handoff', 'destination_unavailable');
      return tumblrStatus(token, id, blog, receipt(id, blog));
    },
  };

  async function wordpressSites(token) {
    const { data } = await call('wordpress', token, '/me/sites');
    if (!Array.isArray(data?.sites)) throw fail('WordPress.com could not verify your sites.', 502);
    return data.sites.filter(site => objectId(site.ID) && site.is_private !== true && site.is_coming_soon !== true && site.capabilities?.publish_posts === true)
      .map(site => ({ id: String(site.ID), label: text(site.name) || 'WordPress.com site', description: publicUrl(site.URL) }));
  }
  function wordpressResult(post, id, site) {
    if (post.status === 'publish' && post.password === '' && post.has_password !== true) return receipt(id, site, 'posted', 'publish', post.URL);
    if (['draft', 'pending', 'private', 'future', 'publish'].includes(post.status)) return receipt(id, site, 'handoff', post.status, post.URL);
    return receipt(id, site, 'processing', post.status);
  }
  const wordpress = {
    capability: capability('WordPress.com article', 'article'),
    async destinations(token, query) {
      return { label: 'WordPress.com article', destinationLabel: 'Public site', destinations: filterDestinations(await wordpressSites(token), query), fields: fields(), notice: 'Publishes on your selected site. WordPress social sharing is disabled for this post.' };
    },
    async publish(token, { content, mediaUrl, mediaType, settings = {} }) {
      const site = destination(settings), postTitle = title(settings), body = contentText(content), photo = imageUrl(mediaUrl, mediaType);
      if (!(await wordpressSites(token)).some(item => item.id === site)) throw fail('Choose a public WordPress.com site where you can publish.', 403, 'destination_not_authorized');
      const { data } = await call('wordpress', token, `/sites/${encodeURIComponent(site)}/posts/new`, { method: 'POST', json: { title: html(postTitle), content: paragraphs(body) + (photo ? `\n<p><img src="${html(photo)}" alt="${html(text(settings.altText, 500))}"></p>` : ''), status: 'publish', password: '', publicize: false } });
      const id = createdId(data, ['ID']);
      if (String(data.site_ID) !== site) throw uncertainReceipt();
      return wordpressResult(data, id, site);
    },
    async sync(token, saved = {}) {
      const id = objectId(saved.publishId || saved.providerId), site = destination(saved);
      if (!id) throw fail('WordPress.com publishing receipt is missing.');
      if (!(await wordpressSites(token)).some(item => item.id === site)) return receipt(id, site, 'handoff', 'destination_unavailable');
      const { data } = await call('wordpress', token, `/sites/${encodeURIComponent(site)}/posts/${encodeURIComponent(id)}`);
      if (objectId(data?.ID) !== id || String(data?.site_ID) !== site) throw uncertainReceipt();
      return wordpressResult(data, id, site);
    },
  };

  async function devUser(token) {
    const { data } = await call('devto', token, '/users/me');
    if (!objectId(data?.id)) throw fail('DEV Community could not verify the API key owner.', 401);
    return { id: String(data.id), label: text(data.name) || text(data.username) || 'My DEV profile', description: text(data.username) };
  }
  function devResult(post, id, userId) {
    if (String(post.user?.user_id ?? post.user?.id ?? '') !== userId || post.organization != null) throw uncertainReceipt();
    const publishedAt = Date.parse(post.published_at || post.published_timestamp || '');
    // Forem's normal public Article serializer omits `published`; an actual
    // publication timestamp is the authoritative state in that response.
    if (post.published !== false && Number.isFinite(publishedAt) && publishedAt <= Date.now()) return receipt(id, userId, 'posted', 'published', post.url);
    if (post.published === false || post.published_at === null) return receipt(id, userId, 'handoff', 'draft', post.url);
    return receipt(id, userId);
  }
  const devto = {
    capability: capability('DEV Community article', 'article'),
    async destinations(token, query) {
      return { label: 'DEV Community article', destinationLabel: 'DEV profile', destinations: filterDestinations([await devUser(token)], query), fields: fields(128, [{ key: 'tags', label: 'Tags (up to 4, comma separated)', type: 'text', maxLength: 120 }]), notice: 'Uses the API key belonging to your DEV Community profile.' };
    },
    async publish(token, { content, mediaUrl, mediaType, settings = {} }) {
      const userId = destination(settings), postTitle = title(settings, 128), body = contentText(content), photo = imageUrl(mediaUrl, mediaType);
      if ((await devUser(token)).id !== userId) throw fail('Choose the DEV profile connected by your API key.', 403, 'destination_not_authorized');
      // A heading prevents member text from becoming YAML front matter that
      // could override the explicitly selected article publication settings.
      const { data } = await call('devto', token, '/articles', { method: 'POST', json: { article: { title: postTitle, body_markdown: `# ${postTitle.replace(/[\r\n]/g, ' ')}\n\n${body}`, published: true, ...(photo ? { main_image: photo } : {}), tags: tagList(settings.tags, 4).join(',') } } });
      const id = createdId(data);
      return devResult(data, id, userId);
    },
    async sync(token, saved = {}) {
      const id = objectId(saved.publishId || saved.providerId), userId = destination(saved);
      if (!id) throw fail('DEV Community publishing receipt is missing.');
      if ((await devUser(token)).id !== userId) return receipt(id, userId, 'handoff', 'destination_unavailable');
      const { data } = await call('devto', token, `/articles/${encodeURIComponent(id)}`);
      if (objectId(data?.id) !== id) throw uncertainReceipt();
      return devResult(data, id, userId);
    },
  };

  async function mediumUser(token) {
    const { data } = await call('medium', token, '/me');
    if (!objectId(data?.data?.id)) throw fail('Medium could not verify the legacy integration owner.', 401);
    return { id: data.data.id, label: text(data.data.name) || text(data.data.username) || 'My Medium profile', description: text(data.data.username) };
  }
  const medium = {
    capability: capability('Medium legacy article', 'article'),
    async destinations(token, query) {
      return { label: 'Medium legacy article', destinationLabel: 'Medium profile', destinations: filterDestinations([await mediumUser(token)], query), fields: fields(100), notice: 'Available only to verified existing Medium integrations. Medium accepts no new integrations or tokens.' };
    },
    async publish(token, { content, mediaUrl, mediaType, settings = {} }) {
      const author = destination(settings), postTitle = title(settings, 100), body = contentText(content), photo = imageUrl(mediaUrl, mediaType);
      if ((await mediumUser(token)).id !== author) throw fail('Choose the Medium profile connected by your legacy integration.', 403, 'destination_not_authorized');
      const { data } = await call('medium', token, `/users/${encodeURIComponent(author)}/posts`, { method: 'POST', json: { title: postTitle, contentFormat: 'markdown', content: `# ${postTitle.replace(/[\r\n]/g, ' ')}\n\n${body}${photo ? `\n\n![${text(settings.altText, 500).replace(/[\[\]\\\r\n]/g, '')}](${photo})` : ''}`, publishStatus: 'public' } });
      const post = data?.data, id = createdId(post);
      if (String(post.authorId ?? '') !== author) throw uncertainReceipt();
      return receipt(id, author, post.publishStatus === 'public' ? 'posted' : ['draft', 'unlisted'].includes(post.publishStatus) ? 'handoff' : 'processing', post.publishStatus, post.url);
    },
  };

  async function dribbbleUser(token) {
    const { data } = await call('dribbble', token, '/user');
    if (!objectId(data?.id)) throw fail('Dribbble could not verify your profile.', 401);
    if (!['Player', 'Team'].includes(data.type)) throw fail('Dribbble publishing requires an account permitted to upload shots.', 403, 'provider_account_ineligible');
    return { id: String(data.id), label: text(data.name) || text(data.login) || 'My Dribbble profile', description: text(data.login) };
  }
  async function dribbbleStatus(token, id, userId) {
    const { data, status } = await call('dribbble', token, `/shots/${encodeURIComponent(id)}`, { allowStatuses: [404] });
    if (status === 404) return receipt(id, userId);
    if (objectId(data?.id) !== id || (data.user?.id != null && String(data.user.id) !== userId)) throw uncertainReceipt();
    if (data.published_at && Number.isFinite(Date.parse(data.published_at)) && Date.parse(data.published_at) <= Date.now()) return receipt(id, userId, 'posted', 'published', data.html_url);
    if (data.scheduled_for) return receipt(id, userId, 'handoff', 'scheduled', data.html_url);
    return receipt(id, userId);
  }
  const dribbble = {
    capability: capability('Dribbble shot', 'shot', { requiresPhoto: true, allowedMedia: ['image'] }),
    async destinations(token, query) {
      return { label: 'Dribbble shot', destinationLabel: 'Dribbble profile', destinations: filterDestinations([await dribbbleUser(token)], query), fields: fields(100), notice: 'Your image is padded to 800 × 600 pixels without cropping. Dribbble processes uploads before publishing.' };
    },
    async publish(token, { content, mediaUrl, mediaType, settings = {} }) {
      const userId = destination(settings), shotTitle = title(settings, 100), body = contentText(content), photo = imageUrl(mediaUrl, mediaType);
      if (!photo) throw fail('Attach an image for Dribbble.');
      if ((await dribbbleUser(token)).id !== userId) throw fail('Choose your connected Dribbble profile.', 403, 'destination_not_authorized');
      if (typeof downloadMedia !== 'function') throw fail('Image upload is temporarily unavailable.', 503);
      const media = await downloadMedia(dribbbleImageUrl(photo), { kind: 'image', maxBytes: 8 * 1024 * 1024 });
      if (!Buffer.isBuffer(media?.body) || !media.body.length || media.body.length > 8 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/gif'].includes(media.contentType)) throw fail('Dribbble needs a PNG, JPG or GIF image under 8 MB.');
      const form = new FormData();
      form.set('title', shotTitle);
      form.set('description', paragraphs(body));
      form.set('image', new Blob([media.body], { type: media.contentType }), `ufi-shot.${{ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }[media.contentType]}`);
      const response = await call('dribbble', token, '/shots', { method: 'POST', body: form, timeoutMs: 60000 });
      let id = objectId(response.data?.id), locationId = '';
      if (response.headers?.location) {
        try {
          const location = new URL(response.headers?.location);
          if (location.origin === 'https://api.dribbble.com' && /^\/v2\/shots\/\d+$/.test(location.pathname) && !location.search && !location.hash) locationId = location.pathname.split('/').pop();
        } catch { /* Never follow an arbitrary Location header with a token. */ }
      }
      if (id && locationId && id !== locationId) throw uncertainReceipt();
      if (!id) id = locationId;
      if (!id) createdId(null);
      if (response.data?.user?.id != null && String(response.data.user.id) !== userId) throw uncertainReceipt();
      try { return await dribbbleStatus(token, id, userId); } catch (error) { if (error.deliveryUncertain) throw error; return receipt(id, userId); }
    },
    async sync(token, saved = {}) {
      const id = objectId(saved.publishId || saved.providerId), userId = destination(saved);
      if (!id) throw fail('Dribbble publishing receipt is missing.');
      if ((await dribbbleUser(token)).id !== userId) return receipt(id, userId, 'handoff', 'destination_unavailable');
      return dribbbleStatus(token, id, userId);
    },
  };
  return { pinterest, tumblr, wordpress, devto, medium, dribbble };
}

module.exports = { createBlogPublishingAdapters };
