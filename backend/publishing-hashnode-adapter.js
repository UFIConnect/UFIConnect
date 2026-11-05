'use strict';

// Hashnode's publication API requires a member PAT and a Pro publication.
// Keep this separate from the legacy `hashnode` feed key (freeCodeCamp RSS).
const ENDPOINT = 'https://gql-beta.hashnode.com/';
const POST_FIELDS = 'id url publishedAt author { id } publication { id } preferences { isDelisted }';
const ACCOUNT_QUERY = `query UfiHashnodePublications($after: String) {
  me { id username name publications(first: 100, after: $after) {
    edges { node { id title url author { id } isHeadless } }
    pageInfo { hasNextPage endCursor }
  } }
}`;
const DESTINATION_QUERY = `query UfiHashnodeDestination($id: ObjectId!) {
  me { id }
  publication(id: $id) { id title url author { id } isHeadless }
}`;
const MEMBERS_QUERY = `query UfiHashnodeMembers($id: ObjectId!, $after: String) {
  publication(id: $id) { id members(first: 100, after: $after) {
    edges { node { role user { id } } } pageInfo { hasNextPage endCursor }
  } }
}`;
const PUBLISH_QUERY = `mutation UfiHashnodePublish($input: PublishPostInput!) {
  publishPost(input: $input) { post { ${POST_FIELDS} } }
}`;
const POSTS_QUERY = `query UfiHashnodePublished($id: ObjectId!, $after: String) {
  publication(id: $id) { id posts(first: 100, after: $after) {
    edges { node { ${POST_FIELDS} } } pageInfo { hasNextPage endCursor }
  } }
}`;

function problem(message, status = 400, extra = {}) { return Object.assign(new Error(message), { status, ...extra }); }
function uncertain() { return problem('Hashnode did not confirm matching publishing details. Check the publication before retrying.', 502, { deliveryUncertain: true }); }
function id(value) { return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : ''; }
function publicationId(value) { return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value) ? value.toLowerCase() : ''; }
function publicUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash ? url.toString() : '';
  } catch { return ''; }
}
function receipt(postId, destinationId, authorId, status = 'processing', postedUrl) {
  return { status, delivery: 'direct', providerId: postId, publishId: postId, destinationId, authorId, ...(postedUrl ? { postedUrl } : {}) };
}
function page(connection) {
  if (!Array.isArray(connection?.edges) || typeof connection?.pageInfo?.hasNextPage !== 'boolean') throw problem('Hashnode could not verify the complete publication list.', 502);
  const next = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : '';
  if (connection.pageInfo.hasNextPage && (typeof next !== 'string' || !next || next.length > 2048)) throw problem('Hashnode could not verify the complete publication list.', 502);
  return { nodes: connection.edges.map(edge => edge?.node).filter(Boolean), next };
}

function createHashnodePublishingAdapter({ env = process.env, request } = {}) {
  if (typeof request !== 'function') throw new TypeError('A publishing request function is required.');
  async function graphql(token, operationName, query, variables = {}, write = false) {
    if (typeof token !== 'string' || !token.trim() || token.length > 4096 || /[\s\x00-\x1f]/.test(token)) throw problem('Reconnect Hashnode with a valid personal access token.', 401, { reconnectRequired: true });
    let response;
    try {
      response = await request(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'x-hashnode-client': 'uficonnect', Accept: 'application/json' }, json: { operationName, query, variables }, timeoutMs: 30000 });
    } catch {
      throw problem(write ? 'Hashnode did not confirm delivery. Check the publication before retrying.' : 'Hashnode could not verify this account right now.', 502, write ? { deliveryUncertain: true } : {});
    }
    const status = Number(response?.status), errors = Array.isArray(response?.data?.errors) ? response.data.errors : [];
    const codes = errors.map(error => String(error?.extensions?.code || ''));
    const createdPayload = write && response?.data?.data?.publishPost?.post;
    if (createdPayload && (status < 200 || status >= 300)) throw uncertain();
    if (!createdPayload && (status === 401 || codes.includes('UNAUTHENTICATED'))) throw problem('Reconnect Hashnode with a valid personal access token.', 401, { reconnectRequired: true });
    if (!createdPayload && (status === 403 || codes.includes('FORBIDDEN'))) throw problem('Hashnode publishing needs an active Pro publication and owner or editor permission.', 403, { code: 'hashnode_access_required' });
    if (status < 200 || status >= 300 || (errors.length && !(write && response?.data?.data?.publishPost?.post))) {
      if (codes.includes('BAD_USER_INPUT') || codes.includes('GRAPHQL_VALIDATION_FAILED') || status === 400 || status === 422) throw problem('Hashnode rejected these publishing settings. Check the title and publication.', 400);
      throw problem('Hashnode could not confirm this request. Check the publication before retrying.', 502, write ? { deliveryUncertain: true } : {});
    }
    if (!response?.data?.data || typeof response.data.data !== 'object') throw problem('Hashnode did not return a valid response.', 502, write ? { deliveryUncertain: true } : {});
    return response.data.data;
  }

  async function eligible(token, value, expectedAuthor) {
    const destination = publicationId(value);
    if (!destination) throw problem('Choose a valid Hashnode publication ID.');
    // This root query is Pro-gated by Hashnode. Do not substitute a guessed
    // local billing flag or the unrelated Pro-team feature for actual access.
    const data = await graphql(token, 'UfiHashnodeDestination', DESTINATION_QUERY, { id: destination });
    const authorId = id(data.me?.id), publication = data.publication;
    if (!authorId || (expectedAuthor && authorId !== expectedAuthor)) throw problem('The Hashnode account changed. Reconnect the intended account.', 401, { reconnectRequired: true });
    if (!publication || publicationId(publication.id) !== destination || publication.isHeadless !== false || !publicUrl(publication.url)) throw problem('Choose a public, non-headless Hashnode Pro publication.', 403);
    if (id(publication.author?.id) === authorId) return { authorId, destination, publication };
    let after = '', allowed = false;
    const seen = new Set();
    for (let index = 0; index < 20; index++) {
      const members = await graphql(token, 'UfiHashnodeMembers', MEMBERS_QUERY, { id: destination, after: after || null });
      if (publicationId(members.publication?.id) !== destination) throw problem('Hashnode could not verify this publication.', 502);
      const result = page(members.publication.members);
      allowed = result.nodes.some(member => id(member.user?.id) === authorId && ['OWNER', 'EDITOR', 'ADMIN'].includes(member.role));
      if (allowed) break;
      if (!result.next) break;
      if (seen.has(result.next)) throw problem('Hashnode could not verify publication membership.', 502);
      seen.add(result.next); after = result.next;
    }
    if (!allowed) throw problem('Choose a publication you own or where you are listed as an editor. Contributors must use the Hashnode review workflow.', 403);
    return { authorId, destination, publication };
  }

  function validatedPost(post, expectedId, context) {
    const postId = id(post?.id);
    if (!postId || (expectedId && postId !== expectedId) || id(post.author?.id) !== context.authorId || publicationId(post.publication?.id) !== context.destination) throw uncertain();
    const url = publicUrl(post.url), publicationUrl = publicUrl(context.publication.url);
    if (!url || new URL(url).origin !== new URL(publicationUrl).origin || new URL(url).pathname === '/') throw uncertain();
    const published = Date.parse(post.publishedAt || '');
    const state = post.preferences?.isDelisted === true ? 'handoff' : post.preferences?.isDelisted === false && Number.isFinite(published) && published <= Date.now() ? 'posted' : 'processing';
    return receipt(postId, context.destination, context.authorId, state, url);
  }

  async function confirmedPost(token, target, context) {
    let after = '';
    const seen = new Set();
    // root post(id) can return soft-deleted posts. Check the publication's
    // published listing instead before reporting that an article is live.
    for (let index = 0; index < 20; index++) {
      const data = await graphql(token, 'UfiHashnodePublished', POSTS_QUERY, { id: context.destination, after: after || null });
      if (publicationId(data.publication?.id) !== context.destination) throw uncertain();
      const result = page(data.publication.posts), post = result.nodes.find(item => id(item.id) === target.publishId);
      if (post) return validatedPost(post, target.publishId, context);
      if (!result.next) return { ...target, status: 'processing' };
      if (seen.has(result.next)) throw problem('Hashnode could not confirm publication status.', 502);
      seen.add(result.next); after = result.next;
    }
    return { ...target, status: 'processing' };
  }

  return {
    capability: { supported: true, delivery: 'direct', media: 'native-image', allowedMedia: ['text', 'image'], requiresPhoto: false, settingsRequired: true, publishType: 'article', label: 'Hashnode article', note: 'Requires a personal access token and a Pro publication you own or can publish to as an editor.' },
    async destinations(token, query = {}) {
      let after = '', current = '', destinations = [], account;
      const seen = new Set();
      for (let index = 0; index < 20; index++) {
        const data = await graphql(token, 'UfiHashnodePublications', ACCOUNT_QUERY, { after: after || null });
        const owner = id(data.me?.id);
        if (!owner || (current && current !== owner)) throw problem('Hashnode could not verify the token owner.', 401, { reconnectRequired: true });
        current = owner;
        account = { id: owner, label: data.me.name || data.me.username || `Hashnode account ${owner}`, handle: data.me.username };
        const result = page(data.me.publications);
        for (const publication of result.nodes) {
          if (id(publication.author?.id) !== owner || !publicationId(publication.id)) continue;
          try {
            const verified = await eligible(token, publication.id, owner);
            destinations.push({ id: verified.destination, label: String(verified.publication.title || 'My Hashnode publication').slice(0, 200), description: publicUrl(verified.publication.url) });
          } catch (error) { if (error.status !== 403) throw error; }
        }
        if (!result.next) break;
        if (seen.has(result.next) || index === 19) throw problem('Hashnode could not verify the complete publication list.', 502);
        seen.add(result.next); after = result.next;
      }
      if (query.destinationId) {
        const verified = await eligible(token, query.destinationId, current);
        if (!destinations.some(item => item.id === verified.destination)) destinations.push({ id: verified.destination, label: String(verified.publication.title || 'Hashnode publication').slice(0, 200), description: publicUrl(verified.publication.url) });
      }
      const search = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
      if (search) destinations = destinations.filter(item => `${item.label} ${item.description}`.toLowerCase().includes(search));
      return { account, accountVerified: true, label: 'Hashnode article', destinationLabel: 'Hashnode Pro publication ID', allowCustomDestination: true, destinations, fields: [{ key: 'title', label: 'Article title', type: 'text', required: true, maxLength: 200 }], notice: 'Choose an owned Pro publication or enter a publication ID where you are an editor. Headless publications and contributor review queues are unavailable here. The PAT stays private to your connected account.' };
    },
    async publish(token, { content, mediaUrl, mediaType, settings = {} }) {
      const title = typeof settings.title === 'string' ? settings.title.trim() : '';
      if (!title || title.length > 200) throw problem('Enter a Hashnode article title of 1–200 characters.');
      const body = typeof content === 'string' ? content.trim() : '';
      if (!body || body.length > 60000 || Buffer.byteLength(body, 'utf8') > 60000) throw problem('Write a Hashnode article of at most 60,000 bytes.');
      let photo = '';
      if (mediaUrl) {
        const cloud = String(env.CLOUDINARY_CLOUD_NAME || '').trim();
        try {
          const url = new URL(mediaUrl);
          if (mediaType !== 'image' || !cloud || !publicUrl(mediaUrl) || url.hostname !== 'res.cloudinary.com' || !url.pathname.startsWith(`/${cloud}/image/upload/`)) throw Error();
          photo = url.toString();
        } catch { throw problem('Attach an image uploaded through UFIConnect.'); }
      }
      const context = await eligible(token, settings.destinationId);
      const contentMarkdown = `# ${title.replace(/[\r\n]/g, ' ')}\n\n${body}${photo ? `\n\n![Image](${photo})` : ''}`;
      const data = await graphql(token, 'UfiHashnodePublish', PUBLISH_QUERY, { input: { publicationId: context.destination, title, contentMarkdown, isDelisted: false } }, true);
      const target = validatedPost(data.publishPost?.post, null, context);
      if (target.status !== 'posted') return target;
      try { return await confirmedPost(token, target, context); }
      catch (error) { if (error.deliveryUncertain) throw error; return { ...target, status: 'processing' }; }
    },
    async sync(token, saved = {}) {
      const postId = id(saved.publishId || saved.providerId), owner = id(saved.authorId);
      if (!postId || !owner) throw problem('Hashnode publishing receipt is incomplete.');
      const context = await eligible(token, saved.destinationId, owner);
      return confirmedPost(token, receipt(postId, context.destination, owner, 'processing', publicUrl(saved.postedUrl)), context);
    },
  };
}

module.exports = { createHashnodePublishingAdapter };
