'use strict';

// Owner-only Office sources. Requests are bounded, read-only, and restricted
// to provider API hosts; source content is never persisted or used as commands.
const SOURCE_DEFINITIONS = {
  notion: { name: 'Notion', key: 'OFFICE_NOTION_TOKEN', description: 'Shared page titles and top-level page excerpts' },
  slack: { name: 'Slack', key: 'OFFICE_SLACK_TOKEN', description: 'Public-channel messages visible to the connected user' },
  linear: { name: 'Linear', key: 'OFFICE_LINEAR_TOKEN', description: 'Issue titles, descriptions, and status in accessible teams' },
};
const SOURCE_IDS = Object.keys(SOURCE_DEFINITIONS);
const NOTION_VERSION = '2026-03-11';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const failure = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const clean = (value, limit = 1200) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, limit) : '';
const tokenValid = value => typeof value === 'string' && /^[\x21-\x7e]{20,4096}$/.test(value);
const richText = value => Array.isArray(value) ? value.slice(0, 50).map(item => clean(item?.plain_text || item?.text?.content, 1200)).join('').slice(0, 1200) : '';
function safeLink(value, provider) {
  try {
    const url = new URL(value);
    const hosts = provider === 'notion' ? ['notion.so', 'notion.com', 'notion.site'] : provider === 'slack' ? ['slack.com'] : ['linear.app'];
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.href.length > 2048
      || !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    return url.href;
  } catch { return null; }
}
function keywords(message) {
  const quoted = String(message).match(/["“]([^"”]{2,80})["”]/)?.[1];
  if (quoted) return [quoted];
  const stop = new Set('a an and are as at be been by can check could did do does find for from give how i in is it latest look me my of on or our please recent search show source sources status summary summarize tell that the their there these they this to up update updates us using want was were what when where which who why will with would you your notion slack linear office ai'.split(' '));
  return [...new Set((String(message).match(/[\p{L}\p{N}_-]{2,80}/gu) || []).filter(word => !stop.has(word.toLowerCase())))].slice(0, 4);
}
function createOfficeAISources({ env = process.env, fetcher = fetch, now = Date.now } = {}) {
  async function request(provider, path, token, body, signal) {
    const base = provider === 'notion' ? 'https://api.notion.com/v1/' : provider === 'slack' ? 'https://slack.com/api/' : 'https://api.linear.app/';
    const response = await fetcher(`${base}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers: { Authorization: provider === 'linear' ? token : `Bearer ${token}`, Accept: 'application/json',
        ...(provider === 'notion' ? { 'Notion-Version': NOTION_VERSION } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => {});
      throw failure(422, `Check the ${SOURCE_DEFINITIONS[provider].name} credential and read permissions, then retry.`);
    }
    const reader = response.body?.getReader?.();
    if (!reader) throw failure(502, 'Source returned an unreadable response.');
    const chunks = []; let bytes = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 262144) throw failure(502, 'Source response exceeded the retrieval limit.');
        chunks.push(Buffer.from(part.value));
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || typeof result !== 'object' || Array.isArray(result) || result.ok === false || result.object === 'error' || result.errors?.length) {
        throw failure(422, `Check the ${SOURCE_DEFINITIONS[provider].name} credential and read permissions, then retry.`);
      }
      return result;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  const slackSearch = (token, query, limit, signal) => request('slack', 'assistant.search.context', token,
    { query, limit, channel_types: ['public_channel'], content_types: ['messages'], include_context_messages: false }, signal);
  async function verify(provider, token) {
    if (!SOURCE_IDS.includes(provider) || !tokenValid(token)) throw failure(400, 'Enter a valid source credential.');
    if (provider === 'slack' && !token.startsWith('xoxp-')) throw failure(400, 'Use a Slack user OAuth token beginning with xoxp- and the search:read.public scope.');
    if (provider === 'notion') {
      const user = await request(provider, 'users/me', token);
      if (user.object !== 'user' || !user.id) throw failure(422, 'Notion integration access could not be verified.');
      const pages = await request(provider, 'search', token, { page_size: 1, filter: { property: 'object', value: 'page' } });
      if (!Array.isArray(pages.results)) throw failure(422, 'Notion page search access could not be verified.');
    } else if (provider === 'slack') {
      const user = await request(provider, 'auth.test', token);
      if (user.ok !== true || !user.user_id || !user.team_id) throw failure(422, 'Slack user access could not be verified.');
      const found = await slackSearch(token, 'Office connection check', 1);
      if (found.ok !== true || !Array.isArray(found.results?.messages)) throw failure(422, 'Slack public-channel search could not be verified. Enable AI features and search:read.public for the app.');
    } else {
      const result = await request(provider, 'graphql', token, { query: 'query OfficeConnection { viewer { id } issues(first: 1) { nodes { id } } }' });
      if (!result.data?.viewer?.id || !Array.isArray(result.data?.issues?.nodes)) throw failure(422, 'Linear issue read access could not be verified.');
    }
    const detail = provider === 'notion' ? 'Notion connection and page search verified. Page excerpt permissions are checked when used.'
      : `${SOURCE_DEFINITIONS[provider].name} read access verified.`;
    return { detail: `${detail} Select this source in a conversation to include relevant excerpts.`, checkedAt: new Date(now()).toISOString() };
  }
  async function retrieve(provider, message, token, signal) {
    if (provider === 'slack') {
      const result = await slackSearch(token, clean(message, 1000), 4, signal);
      if (!Array.isArray(result.results?.messages)) throw Error('Invalid Slack response.');
      return result.results.messages.slice(0, 4).map(item => ({ title: `Slack · ${clean(item.channel_name, 80) || 'Public channel'}`,
        url: safeLink(item.permalink, provider), description: clean(item.content), provider, publisher: 'Slack' }));
    }
    const terms = keywords(message);
    if (provider === 'linear') {
      const result = await request(provider, 'graphql', token, {
        query: 'query OfficeSourceIssues($filter: IssueFilter) { issues(first: 4, filter: $filter, orderBy: updatedAt) { nodes { identifier title description url state { name } } } }',
        variables: { filter: terms.length ? { or: terms.flatMap(term => [{ title: { containsIgnoreCase: term } }, { description: { containsIgnoreCase: term } }]) } : {} },
      }, signal);
      if (!Array.isArray(result.data?.issues?.nodes)) throw Error('Invalid Linear response.');
      return result.data.issues.nodes.slice(0, 4).map(item => ({ title: clean(`${item.identifier || ''} ${item.title || ''}`.trim(), 240),
        url: safeLink(item.url, provider), description: clean(`${item.state?.name || ''}: ${item.description || ''}`), provider, publisher: 'Linear' }));
    }
    const result = await request(provider, 'search', token, { ...(terms.length ? { query: terms[0] } : {}), page_size: 3,
      filter: { property: 'object', value: 'page' }, sort: { direction: 'descending', timestamp: 'last_edited_time' } }, signal);
    if (!Array.isArray(result.results)) throw Error('Invalid Notion response.');
    const pages = result.results.filter(page => UUID.test(page.id) && !page.archived && !page.in_trash).slice(0, 3);
    return Promise.all(pages.map(async page => {
      const title = richText(Object.values(page.properties || {}).find(value => value?.type === 'title')?.title) || 'Notion page';
      const blocks = await request(provider, `blocks/${page.id}/children?page_size=30`, token, undefined, signal);
      if (!Array.isArray(blocks.results)) throw Error('Invalid Notion page response.');
      const description = blocks.results.slice(0, 30).map(block => richText(block[block.type]?.rich_text)).filter(Boolean).join('\n').slice(0, 1200);
      return { title: clean(title, 240), url: safeLink(page.url, provider), description: description || 'No readable top-level text in this page.', provider, publisher: 'Notion' };
    }));
  }
  async function collect(ids, message, signal) {
    const results = await Promise.all(ids.map(async id => {
      const definition = SOURCE_DEFINITIONS[id], checkedAt = new Date(now()).toISOString(), token = env[definition.key];
      if (!tokenValid(token)) return { sources: [], status: { id, status: 'not-connected', count: 0, checkedAt, note: 'Connect this source in Connections.' } };
      try {
        const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(14000)]) : AbortSignal.timeout(14000);
        const sources = (await retrieve(id, message, token, boundedSignal)).filter(source => source.url);
        // Never forward an exact credential echo, even if a provider returns it
        // inside a document title, excerpt, or URL.
        for (const source of sources) for (const key of ['title', 'description', 'url']) source[key] = source[key].split(token).join('[credential omitted]');
        return { sources, status: { id, status: sources.length ? 'retrieved' : 'empty', count: sources.length, checkedAt,
          note: id === 'notion' ? 'Title search and top-level excerpts only; use a quoted page title for a focused search.' : definition.description } };
      } catch {
        return { sources: [], status: { id, status: 'unavailable', count: 0, checkedAt, note: 'Source retrieval failed. Verify the connection and read permissions, then retry.' } };
      }
    }));
    return { sources: results.flatMap(result => result.sources), statuses: results.map(result => result.status) };
  }
  return { verify, collect };
}

module.exports = { createOfficeAISources, SOURCE_DEFINITIONS, SOURCE_IDS };
