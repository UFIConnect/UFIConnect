'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createResearchFeedSources } = require('./research-feed-sources');
const rssPost = (item, source, sourceLabel, _id, _name, category, topic) => ({ ...item, source, sourceLabel, category, topic });
const crossref = { DOI: '10.1234/test', title: ['<i>Research</i> title'], author: [{ given: 'A', family: 'Author' }],
  created: { 'date-time': '2026-01-02T03:04:05Z' }, published: { 'date-parts': [[2026]] }, publisher: 'Publisher',
  abstract: 'Copyrighted abstract must not be copied', link: [{ URL: 'https://example.com/full.pdf' }] };

test('readers select bibliographic fields and preserve original source without importing full text/media', async () => {
  const urls = [];
  const readers = createResearchFeedSources({ rssPost, fetchJSON: async url => {
    urls.push(new URL(url));
    if (url.includes('crossref')) return { message: { items: [null, { ...crossref, author: [null, ...crossref.author] }, crossref, { ...crossref, DOI: 'javascript:alert(1)' }] } };
    if (url.includes('datacite')) return { data: [{ id: '10.5678/data', attributes: { titles: [{ title: 'A dataset' }], creators: [{ name: 'Data Author' }], created: '2026-01-01', publicationYear: 2026, descriptions: [{ description: 'Do not copy' }], publisher: { name: 'Repository' } } }] };
    return { hits: { hits: [{ id: 12345, created: '2026-01-01', metadata: { title: 'Zenodo record', publication_date: '2026', creators: [{ name: 'Record Author' }], description: 'Do not copy' }, files: [{ key: 'private.pdf' }] }] } };
  } });
  const first = await readers.crossref('AI & machine learning');
  assert.equal(first.length, 1); assert.equal(first[0].title, 'Research title');
  assert.equal(first[0].link, 'https://doi.org/10.1234/test'); assert.equal(first[0].author, 'A Author');
  assert.equal(first[0].pubDate, '2026-01-02T03:04:05.000Z'); assert.equal(first[0].sourceLabel, 'Crossref');
  assert.match(first[0].desc, /Publication year: 2026/);
  const second = await readers.datacite('AI: (private)');
  const third = await readers.zenodo('science');
  assert.equal(second[0].link, 'https://doi.org/10.5678/data');
  assert.equal(third[0].link, 'https://zenodo.org/records/12345');
  assert.doesNotMatch(JSON.stringify([first, second, third]), /Do not copy|Copyrighted|full.pdf|private.pdf/);
  assert.ok(urls.every(url => url.protocol === 'https:'));
  assert.equal(urls[0].searchParams.get('rows'), '20');
  assert.doesNotMatch(urls[0].searchParams.get('select'), /abstract/);
  assert.doesNotMatch(urls[1].searchParams.get('query'), /[:()]/);
});

test('same-query concurrency is coalesced and provider budget limits topic bursts', async () => {
  let calls = 0, clock = 0;
  const readers = createResearchFeedSources({ rssPost, now: () => clock, fetchJSON: async () => { calls++; return { message: { items: [crossref] } }; } });
  const [a, b] = await Promise.all([readers.crossref('AI'), readers.crossref('AI'), assert.rejects(readers.crossref('Other'), { status: 429 })]);
  assert.equal(calls, 1); assert.deepEqual(a, b);
  clock = 61000;
  await readers.crossref('AI'); assert.equal(calls, 1, 'Cached records do not consume provider quota');
  await readers.crossref('Other'); assert.equal(calls, 2);
  clock = 6 * 3600000 + 1;
  await readers.crossref('AI'); assert.equal(calls, 3);
});

test('invalid schemas and rate limits never become cached successful feeds; Retry-After is respected', async () => {
  let calls = 0, clock = 0;
  const readers = createResearchFeedSources({ rssPost, now: () => clock, fetchJSON: async () => {
    calls++; if (calls === 1) throw Object.assign(new Error('HTTP 429'), { headers: { 'retry-after': '600' } });
    if (calls === 2) return { html: 'Error page' };
    return { message: { items: [crossref] } };
  } });
  await assert.rejects(readers.crossref('AI'), /429/);
  clock = 61000; await assert.rejects(readers.crossref('AI'), { status: 429 }); assert.equal(calls, 1);
  clock = 600001; await assert.rejects(readers.crossref('AI'), /invalid metadata/);
  clock = 661000; assert.equal((await readers.crossref('AI')).length, 1);
});

test('research feed readers are in Home and never registered as connected Following feeds', () => {
  const catalog = require('../shared/feed-source-catalog.json');
  for (const source of ['crossref', 'datacite', 'zenodo', 'openalex']) {
    assert.ok(catalog.home.includes(source)); assert.equal(catalog.following[source], undefined);
  }
});

test('research workers activate on Pipeline only while OpenAlex setup remains separately reported', () => {
  const { officeSourceReady, planOfficeActivation } = require('./office-agent-activation');
  const sourceIds = ['crossref', 'datacite', 'zenodo', 'openalex'];
  const agents = Object.fromEntries(sourceIds.map(id => [id, { name: id }]));
  assert.equal(officeSourceReady('openalex', {}), false);
  assert.equal(officeSourceReady('openalex', { OPENALEX_API_KEY: 'fixture-key' }), true);
  const enabled = planOfficeActivation({ role: 'pipeline', agents, sourceIds, sourceEnabled: () => true });
  assert.deepEqual(enabled.filter(row => row.status === 'queue').map(row => row.id), sourceIds);
  const disabled = planOfficeActivation({ role: 'pipeline', agents, sourceIds, sourceEnabled: id => id !== 'openalex' });
  assert.equal(disabled.find(row => row.id === 'openalex').status, 'skipped');
  const api = planOfficeActivation({ role: 'api', agents, sourceIds, sourceEnabled: () => true });
  assert.ok(api.every(row => row.status === 'skipped'));
});

test('research switches revoke cached reads without calling upstream', async () => {
  const { isSourceDisplayAllowed } = require('./source-policy');
  const env = {};
  let calls = 0;
  const readers = createResearchFeedSources({ env, rssPost, fetchJSON: async () => { calls++; return { message: { items: [crossref] } }; } });
  assert.equal((await readers.crossref('AI')).length, 1);
  env.SOURCE_CROSSREF_ENABLED = 'false';
  assert.deepEqual(await readers.crossref('AI'), []);
  assert.equal(calls, 1);
  for (const source of ['crossref', 'datacite', 'zenodo', 'openalex']) {
    assert.equal(isSourceDisplayAllowed(source, { env: { SOURCE_ACCESS_ENABLED: 'false' } }), false);
    assert.equal(isSourceDisplayAllowed(source, { env: { [`SOURCE_${source.toUpperCase()}_DISPLAY_POST_ENABLED`]: 'false' } }), false);
    assert.equal(isSourceDisplayAllowed(source, { env: {} }), true);
  }
});

test('the provider transport passes Retry-After to feed-reader pacing', async () => {
  const { createProviderJsonClient } = require('./provider-json');
  let calls = 0, clock = 0;
  const https = { get(_url, _options, callback) {
    calls++;
    queueMicrotask(() => callback({ statusCode: 429, headers: { 'retry-after': '600' }, resume() {} }));
    return { on() {}, setTimeout() {} };
  } };
  const readers = createResearchFeedSources({ rssPost, env: {}, now: () => clock, fetchJSON: createProviderJsonClient(https).fetchJSON });
  for (let i = 0; i < 2; i++) {
    await assert.rejects(readers.crossref('research'), error => {
      assert.equal(error.status, 429);
      assert.equal(error.retryAfter, 600);
      assert.doesNotMatch(String(error.stack) + JSON.stringify(error), /api\.crossref|HTTP/);
      return true;
    });
  }
  clock = 60000;
  await assert.rejects(readers.crossref('another topic'), { status: 429, retryAfter: 540 });
  assert.equal(calls, 1);
  clock = 600000;
  await assert.rejects(readers.crossref('another topic'));
  assert.equal(calls, 2, 'The provider can be retried once its full Retry-After budget elapses');
});

const openalex = { id: 'https://openalex.org/W2741809807', title: '<i>Open</i> research',
  publication_date: '2026-01-03', publication_year: 2026,
  authorships: [null, { author: { display_name: 'Research Author' }, raw_affiliation_strings: ['Do not copy affiliation'] }],
  abstract_inverted_index: { 'Do not copy abstract': [0] }, content_urls: { pdf: 'https://content.openalex.org/paper.pdf' },
  primary_location: { landing_page_url: 'https://publisher.example/?api_key=secret', pdf_url: 'https://publisher.example/paper.pdf' },
  image: 'https://publisher.example/figure.png', fulltext: 'Do not copy fulltext' };

test('OpenAlex requires a server key before requests and cached reads, with no anonymous fallback', async () => {
  let calls = 0;
  const env = {};
  const readers = createResearchFeedSources({ rssPost, env, fetchJSON: async () => { calls++; return { results: [openalex] }; } });
  for (const key of [undefined, '', '  ', 'invalid\r\nHeader:value']) {
    env.OPENALEX_API_KEY = key;
    await assert.rejects(readers.openalex('science'), { status: 503, code: 'source_not_configured' });
  }
  assert.equal(calls, 0);
  env.OPENALEX_API_KEY = 'fixture-api-only-key';
  assert.equal((await readers.openalex('science')).length, 1);
  delete env.OPENALEX_API_KEY;
  await assert.rejects(readers.openalex('science'), { status: 503, code: 'source_not_configured' });
  assert.equal(calls, 1, 'Removing the key prevents access even to the reader cache');
});

test('OpenAlex uses header auth and returns only bounded bibliographic metadata with canonical links', async () => {
  const calls = [];
  const env = { OPENALEX_API_KEY: 'fixture-api-only-key' };
  const readers = createResearchFeedSources({ rssPost, env, fetchJSON: async (url, headers) => {
    calls.push({ url, headers });
    return { results: [null, openalex, openalex, { ...openalex, id: 'https://openalex.org/W123?api_key=secret' },
      { ...openalex, id: 'https://evil.example/W1' }, { ...openalex, id: ['https://openalex.org/W1'] },
      { ...openalex, publication_date: 'invalid' }] };
  } });
  const posts = await readers.openalex('AI & learning');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'Open research');
  assert.equal(posts[0].link, openalex.id);
  assert.equal(posts[0].author, 'Research Author');
  assert.equal(posts[0].pubDate, '2026-01-03T00:00:00.000Z');
  assert.equal(posts[0].sourceLabel, 'OpenAlex');
  assert.equal(posts[0].category, 'Research');
  const url = new URL(calls[0].url);
  assert.equal(url.origin, 'https://api.openalex.org');
  assert.equal(url.pathname, '/works');
  assert.equal(url.searchParams.get('search'), 'AI & learning');
  assert.equal(url.searchParams.get('per_page'), '20');
  assert.equal(url.searchParams.get('select'), 'id,title,authorships,publication_date,publication_year');
  assert.equal(calls[0].headers.Authorization, `Bearer ${env.OPENALEX_API_KEY}`);
  assert.doesNotMatch(calls[0].url, /api_key|fixture-api-only-key/);
  assert.doesNotMatch(JSON.stringify(posts), /Do not copy|paper\.pdf|figure\.png|publisher\.example|api_key|fixture-api-only-key/);
  env.SOURCE_OPENALEX_ENABLED = 'false';
  assert.deepEqual(await readers.openalex('AI & learning'), []);
  assert.equal(calls.length, 1);
});

test('OpenAlex coalesces requests, caches results, and shares five-minute pacing across topics', async () => {
  let clock = 0, calls = 0;
  const readers = createResearchFeedSources({ rssPost, env: { OPENALEX_API_KEY: 'fixture-key' }, now: () => clock,
    fetchJSON: async () => { calls++; return { results: [openalex] }; } });
  const [a, b] = await Promise.all([readers.openalex('science'), readers.openalex('science')]);
  assert.deepEqual(a, b); assert.equal(calls, 1);
  clock = 60000;
  await assert.rejects(readers.openalex('different topic'), { status: 429, retryAfter: 240 });
  assert.equal((await readers.openalex('science')).length, 1);
  assert.equal(calls, 1);
  clock = 300000;
  await readers.openalex('different topic'); assert.equal(calls, 2);
  clock = 6 * 3600000 + 1;
  await readers.openalex('science'); assert.equal(calls, 3);
});

test('OpenAlex bounds publication dates to the current UTC day', async () => {
  for (const [instant, cutoff] of [
    ['2026-10-24T23:59:59.999Z', '2026-10-24'],
    ['2026-10-24T20:00:00-07:00', '2026-10-25'],
  ]) {
    const readers = createResearchFeedSources({ rssPost, env: { OPENALEX_API_KEY: 'fixture-key' },
      now: () => Date.parse(instant), fetchJSON: async value => {
        const url = new URL(value);
        assert.equal(url.searchParams.get('filter'), `to_publication_date:${cutoff}`);
        assert.equal(url.searchParams.get('sort'), 'publication_date:desc');
        return { results: [openalex] };
      } });
    assert.equal((await readers.openalex('machine learning')).length, 1);
  }
});

test('OpenAlex sanitizes transport failures and never caches a rejected response', async () => {
  let clock = 0, calls = 0;
  const readers = createResearchFeedSources({ rssPost, env: { OPENALEX_API_KEY: 'fixture-secret' }, now: () => clock,
    fetchJSON: async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('https://api.openalex.org/works?api_key=fixture-secret private response'), { status: 403, request: { Authorization: 'fixture-secret' } });
      if (calls === 2) return { error: 'fixture-secret invalid response' };
      return { results: [openalex] };
    } });
  await assert.rejects(readers.openalex('science'), error => {
    assert.equal(error.code, 'source_authorization_required');
    assert.equal(error.status, 503);
    assert.doesNotMatch(String(error.stack) + JSON.stringify(error), /fixture-secret|api\.openalex|private response/);
    return true;
  });
  clock = 300000;
  await assert.rejects(readers.openalex('science'), { code: 'source_unavailable' });
  clock = 600000;
  assert.equal((await readers.openalex('science')).length, 1); assert.equal(calls, 3);
});

test('OpenAlex feed reads distinguish setup failure and retain provider Retry-After without exposing its URL', async () => {
  let calls = 0;
  const env = {};
  const readers = createResearchFeedSources({ rssPost, env, now: () => 0, fetchJSON: async () => {
    calls++;
    throw Object.assign(new Error('https://api.openalex.org/?api_key=fixture-secret'), { status: 429, headers: { 'retry-after': '900' } });
  } });
  await assert.rejects(readers.openalex('science'), { status: 503, code: 'source_not_configured' });
  assert.equal(calls, 0);
  env.OPENALEX_API_KEY = 'fixture-secret';
  for (let i = 0; i < 2; i++) {
    await assert.rejects(readers.openalex('science'), error => {
      assert.equal(error.status, 429); assert.equal(error.retryAfter, 900);
      assert.doesNotMatch(String(error.stack) + JSON.stringify(error), /api\.openalex|fixture-secret|api_key/);
      return true;
    });
  }
  assert.equal(calls, 1);
  env.SOURCE_ACCESS_ENABLED = 'false';
  assert.deepEqual(await readers.openalex('science'), []);
  assert.equal(calls, 1);
});
