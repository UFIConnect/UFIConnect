'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createOfficialAIUpdates, isAIUpdateQuestion, parseFeed, FEEDS } = require('./office-ai-updates');
const { createOfficeAI } = require('./office-ai');
const NOW = Date.parse('2026-11-03T20:00:00.000Z');
const article = (feed, slug = 'release') => `${new URL(feed.url).origin}${feed.publisher === 'OpenAI' ? '/index/' : feed.publisher === 'Google' ? '/innovation-and-ai/technology/ai/' : feed.publisher === 'Hugging Face' ? '/blog/' : '/'}${slug}`;
const item = ({ title = 'New AI release', url, published = '2026-11-03T12:00:00.000Z', description = 'Provider announcement.' } = {}) =>
  `<item><title>${title}</title><link>${url}</link><pubDate>${published}</pubDate><description>${description}</description></item>`;
const rss = items => `<rss version="2.0"><channel>${items.join('')}</channel></rss>`;
const response = body => new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
const fixtures = feed => rss(Array.from({ length: 5 }, (_, index) => item({ url: article(feed, `release-${index}`), published: new Date(NOW - (index + 1) * 3600000).toISOString() })));

test('fallback recognizes AI update questions and excludes unrelated research or generic AI discussion', () => {
  for (const question of ['What are the latest AI releases?', 'Recent updates from OpenAI and Claude', 'What is new in language models?', 'AI news today']) assert.equal(isAIUpdateQuestion(question), true);
  for (const question of ['Latest restaurant openings', 'Explain artificial intelligence', 'How do I deploy Office?', 'Hello', '', null]) assert.equal(isAIUpdateQuestion(question), false);
});

test('RSS parser decodes bounded plain text and retains dated first-party provenance', () => {
  const feed = FEEDS[0];
  const result = parseFeed(rss([item({ title: '<![CDATA[A &amp; B <b>release</b>]]>', url: article(feed),
    description: '&lt;img src="https://evil.example/pixel"&gt;Useful &quot;AI&quot; update &#x1f680;' })]), feed, NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'A & B release');
  assert.equal(result[0].description, 'Useful "AI" update 🚀');
  assert.equal(result[0].publisher, 'Cloudflare');
  assert.equal(result[0].publishedAt, '2026-11-03T12:00:00.000Z');
});

test('untrusted XML entities, off-origin URLs, credentials, community posts, stale and future dates are excluded', () => {
  const feed = FEEDS[3], valid = article(feed);
  const result = parseFeed(rss([
    item({ url: valid }), item({ url: valid }),
    item({ url: 'https://huggingface.co/blog/community/release' }),
    item({ url: 'https://huggingface.co.evil.example/blog/release' }),
    item({ url: 'https://secret:password@huggingface.co/blog/release' }),
    item({ url: 'javascript:alert(1)' }),
    item({ url: `${valid}?redirect=https://evil.example` }),
    item({ url: article(feed, 'old'), published: '2025-11-03T12:00:00Z' }),
    item({ url: article(feed, 'future'), published: '2026-11-04T12:00:00Z' }),
    item({ url: article(feed, 'undated'), published: 'not a date' }),
  ]), feed, NOW);
  assert.equal(result.length, 1);
  assert.deepEqual(parseFeed(`<!DOCTYPE rss [<!ENTITY steal SYSTEM "file:///etc/passwd">]>${rss([item({ title: '&steal;', url: valid })])}`, feed, NOW), []);
  assert.deepEqual(parseFeed(rss([item({ url: valid })]), { ...feed, url: 'https://attacker.example/feed' }, NOW), []);
  assert.deepEqual(parseFeed('<rss><item>incomplete', feed, NOW), []);
});

test('fetches exactly four fixed public feeds, sends no credentials or user query, and selects eight diverse recent results', async () => {
  const calls = [];
  const updates = createOfficialAIUpdates({ now: () => NOW, fetcher: async (url, options) => {
    calls.push({ url, options });
    return response(fixtures(FEEDS.find(feed => feed.url === url)));
  } });
  const result = await updates();
  assert.equal(calls.length, 4);
  assert.equal(result.sources.length, 8);
  assert.equal(result.providers.length, 4);
  assert.ok(result.sources.every((source, index, list) => !index || source.publishedAt <= list[index - 1].publishedAt));
  for (const publisher of result.providers) assert.ok(result.sources.filter(source => source.publisher === publisher).length <= 3);
  for (const call of calls) {
    assert.ok(FEEDS.some(feed => feed.url === call.url));
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'manual');
    assert.equal(call.options.headers.Authorization, undefined);
    assert.equal(call.options.body, undefined);
    assert.ok(call.options.signal);
  }
});

test('five-minute single-flight cache deduplicates concurrent lookups and callers cannot mutate cached results', async () => {
  let time = NOW, calls = 0, release;
  const wait = new Promise(resolve => { release = resolve; });
  const updates = createOfficialAIUpdates({ now: () => time, fetcher: async url => {
    calls++; await wait; return response(fixtures(FEEDS.find(feed => feed.url === url)));
  } });
  const first = updates(), second = updates();
  assert.equal(calls, 4);
  release();
  const [one, two] = await Promise.all([first, second]);
  one.sources[0].title = 'mutated';
  assert.notEqual(two.sources[0].title, 'mutated');
  assert.notEqual((await updates()).sources[0].title, 'mutated');
  assert.equal(calls, 4);
  time += 300001;
  await updates();
  assert.equal(calls, 8);
});

test('failed feeds and excessive bodies degrade independently without leaking network errors', async () => {
  const updates = createOfficialAIUpdates({ now: () => NOW, fetcher: async url => {
    const index = FEEDS.findIndex(feed => feed.url === url);
    if (index === 0) throw new Error('Secret network details');
    if (index === 1) return response('x'.repeat(1024 * 1024 + 1));
    if (index === 2) return new Response('<html>challenge</html>', { headers: { 'Content-Type': 'text/html' } });
    return response(fixtures(FEEDS[index]));
  } });
  const result = await updates();
  assert.equal(result.sources.length, 3);
  assert.deepEqual(result.providers, ['Hugging Face']);
  assert.equal(result.failedProviders.length, 3);
  assert.ok(!JSON.stringify(result).includes('Secret network details'));
});

test('feed redirects cannot escape the original provider origin and same-origin redirects are bounded', async () => {
  const destinations = [], updates = createOfficialAIUpdates({ now: () => NOW, fetcher: async url => {
    destinations.push(url);
    return new Response(null, { status: 302, headers: { Location: 'https://attacker.example/rss' } });
  } });
  assert.equal((await updates()).sources.length, 0);
  assert.equal(destinations.length, 4);
  assert.ok(destinations.every(url => FEEDS.some(feed => feed.url === url)));
  let calls = 0;
  const looping = createOfficialAIUpdates({ now: () => NOW, fetcher: async url => {
    calls++; return new Response(null, { status: 301, headers: { Location: new URL('/loop', url).href } });
  } });
  assert.equal((await looping()).sources.length, 0);
  assert.equal(calls, 12);
});

async function chat(handler, message, extra = {}) {
  const res = new EventEmitter(); res.statusCode = 200;
  res.set = () => res; res.status = value => { res.statusCode = value; return res; };
  res.json = value => { res.body = value; res.writableEnded = true; return res; };
  await handler({ body: { message, ...extra } }, res);
  return { status: res.statusCode, body: res.body };
}

test('chat fallback returns dated official announcements after search fails, with explicit scope in model context', async () => {
  const calls = [];
  const service = createOfficeAI({ env: { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'private-key' }, now: () => NOW,
    fetcher: async (url, options) => {
      calls.push({ url, options });
      const feed = FEEDS.find(feed => feed.url === url);
      if (feed) return response(fixtures(feed));
      if (url.endsWith('websearch/')) return new Response('{}', { status: 402 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Official announcements are available [1].' } }] }));
    } });
  const result = await chat(service.chat, 'Latest AI releases and news');
  assert.equal(result.status, 200);
  assert.equal(result.body.research.status, 'official-updates');
  assert.match(result.body.research.note, /broader web search unavailable/);
  assert.equal(result.body.sources.length, 8);
  assert.ok(result.body.sources.every(source => source.publisher && source.publishedAt));
  const inference = JSON.parse(calls.at(-1).options.body);
  assert.match(inference.messages[0].content, /first-party claims/);
  assert.match(inference.messages[0].content, /comprehensive coverage/);
  assert.match(inference.messages[1].content, /publishedAt/);
  assert.equal(calls.length, 6);
  for (const call of calls.filter(call => FEEDS.some(feed => feed.url === call.url))) assert.equal(call.options.headers.Authorization, undefined);
});

test('general research, disabled research, explicit fallback opt-out and successful search never fetch announcement feeds', async () => {
  for (const scenario of [
    { message: 'Latest flight prices', research: true },
    { message: 'Latest AI releases', research: false },
    { message: 'Latest AI releases', research: true, disabled: true },
    { message: 'Latest AI releases', research: true, searchWorks: true },
  ]) {
    let feeds = 0;
    const service = createOfficeAI({ env: { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'private-key',
      ...(scenario.disabled ? { OFFICE_AI_OFFICIAL_UPDATES_ENABLED: 'false' } : {}) }, now: () => NOW,
      fetcher: async url => {
        if (FEEDS.some(feed => feed.url === url)) { feeds++; return response(''); }
        if (url.endsWith('websearch/')) return scenario.searchWorks ? new Response(JSON.stringify({ items: [{ title: 'Result', url: 'https://example.com/ai' }] })) : new Response('{}', { status: 402 });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'Answer.' } }] }));
      } });
    const result = await chat(service.chat, scenario.message, { research: scenario.research });
    assert.equal(result.status, 200);
    assert.notEqual(result.body.research.status, 'official-updates');
    assert.equal(feeds, 0);
  }
});
