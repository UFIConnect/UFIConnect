'use strict';
const { isSourceDisplayAllowed } = require('./source-policy');

// Public bibliographic metadata only. Full text, abstracts, figures and files
// have separate rights and are never imported by these readers.
const LABELS = Object.freeze({ crossref: 'Crossref', datacite: 'DataCite', zenodo: 'Zenodo', openalex: 'OpenAlex' });
const RESEARCH_SOURCE_IDS = Object.freeze(Object.keys(LABELS));
const text = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 500) : '';
const names = values => (Array.isArray(values) ? values : []).filter(value => value && typeof value === 'object').slice(0, 8).map(value => text(value.name || [value.given, value.family].filter(Boolean).join(' '))).filter(Boolean).join(', ');
function doiUrl(value) {
  return typeof value === 'string' && /^10\.\d{4,9}\/[^\s<>"\\]{1,200}$/i.test(value)
    ? `https://doi.org/${value.split('/').map(encodeURIComponent).join('/')}` : null;
}

function createResearchFeedSources({ fetchJSON, rssPost, now = Date.now, env = process.env }) {
  const cache = new Map(), pending = new Map(), nextRequest = new Map();
  const ttl = 6 * 60 * 60 * 1000;
  const requestSpacing = source => source === 'openalex' ? 300000 : 60000;
  const openAlexKey = () => {
    const value = typeof env.OPENALEX_API_KEY === 'string' ? env.OPENALEX_API_KEY.trim() : '';
    return /^[\x21-\x7e]{1,512}$/.test(value) ? value : '';
  };
  const rateLimited = source => Object.assign(new Error('Research source refresh is limited. Try again shortly.'), {
    status: 429, retryAfter: Math.max(1, Math.ceil(((nextRequest.get(source) || now() + 60000) - now()) / 1000)),
  });
  function item(source, record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    let title, link, author, date, year, publisher;
    if (source === 'crossref') {
      title = text(record.title?.[0]); link = doiUrl(record.DOI); author = names(record.author);
      date = record.created?.['date-time'] || record.deposited?.['date-time'];
      year = record.published?.['date-parts']?.[0]?.[0]; publisher = text(record.publisher);
    } else if (source === 'datacite') {
      const data = record.attributes || {};
      title = text(data.titles?.[0]?.title); link = doiUrl(data.doi || record.id); author = names(data.creators);
      date = data.created; year = data.publicationYear; publisher = text(data.publisher?.name || data.publisher);
    } else if (source === 'openalex') {
      // Construct a canonical record link, never a provider-supplied PDF,
      // credential-bearing URL, abstract, image or full-text download link.
      if (typeof record.id !== 'string' || !/^https:\/\/openalex\.org\/W\d{1,20}$/.test(record.id)) return null;
      title = text(record.title); link = record.id;
      author = names((Array.isArray(record.authorships) ? record.authorships : []).slice(0, 8)
        .map(authorship => ({ name: authorship?.author?.display_name })));
      date = record.publication_date; year = record.publication_year;
    } else {
      const data = record.metadata || {};
      if (!/^\d{1,20}$/.test(String(record.id))) return null;
      title = text(data.title); link = `https://zenodo.org/records/${record.id}`; author = names(data.creators);
      date = record.created; year = String(data.publication_date || '').slice(0, 4); publisher = 'Zenodo';
    }
    if (!title || !link || !Number.isFinite(Date.parse(date))) return null;
    const details = [publisher, /^\d{4}$/.test(String(year)) ? `Publication year: ${year}` : '',
      `Bibliographic metadata from ${LABELS[source]}. Open the original record for access and its content license.`].filter(Boolean).join(' · ');
    return { title, link, author, pubDate: new Date(date).toISOString(), desc: details };
  }
  function endpoint(source, query) {
    if (source === 'crossref') {
      const url = new URL('https://api.crossref.org/works');
      url.search = new URLSearchParams({ query, rows: '20', sort: 'published', order: 'desc',
        select: 'DOI,title,author,publisher,published,created,deposited' });
      return url;
    }
    if (source === 'datacite') {
      const url = new URL('https://api.datacite.org/dois');
      url.search = new URLSearchParams({ query: query.replace(/[^\p{L}\p{N}\s-]/gu, ' '), 'page[size]': '20', sort: '-published',
        'fields[dois]': 'doi,titles,creators,publisher,publicationYear,created' });
      return url;
    }
    if (source === 'openalex') {
      const url = new URL('https://api.openalex.org/works');
      url.search = new URLSearchParams({ search: query, per_page: '20', sort: 'publication_date:desc',
        filter: `to_publication_date:${new Date(now()).toISOString().slice(0, 10)}`,
        select: 'id,title,authorships,publication_date,publication_year' });
      return url;
    }
    const url = new URL('https://zenodo.org/api/records');
    url.search = new URLSearchParams({ q: query.replace(/[^\p{L}\p{N}\s-]/gu, ' '), size: '20', sort: 'mostrecent' });
    return url;
  }
  async function read(source, topic = 'research') {
    if (!isSourceDisplayAllowed(source, { env })) return [];
    // UFIConnect deliberately requires an activated API-only key, including
    // for cached reads. Never silently fall back to anonymous API access.
    const apiKey = source === 'openalex' ? openAlexKey() : '';
    if (source === 'openalex' && !apiKey) throw Object.assign(new Error('OpenAlex is not configured yet.'), {
      status: 503, code: 'source_not_configured',
    });
    const query = text(topic).slice(0, 120) || 'research';
    const key = `${source}:${query.toLowerCase()}`;
    if (cache.get(key)?.expiresAt > now()) return cache.get(key).posts;
    if (pending.has(key)) return pending.get(key);
    // Manual refresh and multiple topic workers share this budget. Do not
    // turn a refresh into parallel requests across all topics or retry storms.
    if ((nextRequest.get(source) || 0) > now()) throw rateLimited(source);
    nextRequest.set(source, now() + requestSpacing(source));
    const task = Promise.resolve().then(async () => {
      try {
        const response = await fetchJSON(endpoint(source, query).href, {
          'User-Agent': 'UFIConnect/1.0 (https://uficonnect.org; public research metadata)',
          ...(source === 'openalex' ? { Authorization: `Bearer ${apiKey}` } : {}),
        });
        const rows = source === 'crossref' ? response?.message?.items : source === 'datacite' ? response?.data
          : source === 'openalex' ? response?.results : response?.hits?.hits;
        if (!Array.isArray(rows)) throw new Error(`${LABELS[source]} returned invalid metadata.`);
        const seen = new Set();
        const posts = rows.slice(0, 20).map(record => item(source, record)).filter(record => {
          if (!record || seen.has(record.link)) return false;
          seen.add(record.link); return true;
        }).map(record => rssPost(record, source, LABELS[source], `ext_${source}`, LABELS[source], 'Research', query));
        cache.delete(key);
        cache.set(key, { expiresAt: now() + ttl, posts });
        while (cache.size > 96) cache.delete(cache.keys().next().value);
        return isSourceDisplayAllowed(source, { env }) && (source !== 'openalex' || openAlexKey() === apiKey) ? posts : [];
      } catch (error) {
        const retry = error.headers?.['retry-after'];
        const delay = /^\d+$/.test(String(retry)) ? Number(retry) * 1000 : Date.parse(retry) - now();
        if (Number.isFinite(delay)) nextRequest.set(source, now() + Math.min(86400000, Math.max(requestSpacing(source), delay)));
        if (error.status === 429) throw rateLimited(source);
        // Even a custom transport must not expose headers, request URLs,
        // response bodies or the key through worker logs or route errors.
        if (source === 'openalex') throw Object.assign(new Error(
          [401, 403].includes(error.status) ? 'OpenAlex access needs activation or configuration.' : 'OpenAlex metadata is temporarily unavailable.'
        ), { status: 503, code: [401, 403].includes(error.status) ? 'source_authorization_required' : 'source_unavailable' });
        throw error;
      } finally { pending.delete(key); }
    });
    pending.set(key, task);
    return task;
  }
  return Object.fromEntries(Object.keys(LABELS).map(source => [source, topic => read(source, topic)]));
}

module.exports = { createResearchFeedSources, RESEARCH_SOURCE_IDS };
