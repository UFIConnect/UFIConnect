'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const proxyaddr = require('proxy-addr');
const { trustedFeedNetworkLocation, memberFeedSnapshotKey } = require('./feed-location');
const { createAppHarness, member } = require('./test-support/app-harness');

function request(remoteAddress, headers, trusted = ['loopback']) {
  return { socket: { remoteAddress }, headers, app: { get: () => proxyaddr.compile(trusted) } };
}
const headers = country => ({ 'x-forwarded-for': '203.0.113.45, 173.245.48.20', 'cf-ipcountry': country });

test('country headers require a verified Cloudflare hop; forged or incomplete chains are ignored', () => {
  assert.equal(trustedFeedNetworkLocation(request('127.0.0.1', headers('CA'))).country, 'CA');
  assert.equal(trustedFeedNetworkLocation(request('2606:4700::1234', { 'cf-ipcountry': 'JP' })).country, 'JP');
  assert.equal(trustedFeedNetworkLocation(request('10.0.0.2', headers('CA'), ['loopback', 'uniquelocal', '173.245.48.0/20'])).country, 'CA');
  assert.deepEqual(trustedFeedNetworkLocation(request('203.0.113.9', headers('CA'))), {});
  assert.deepEqual(trustedFeedNetworkLocation(request('127.0.0.1', { ...headers('CA'), 'x-forwarded-for': '173.245.48.20, 203.0.113.9' })), {});
  assert.deepEqual(trustedFeedNetworkLocation(request('127.0.0.1', { 'cf-ipcountry': 'CA', 'x-country-code': 'CA' })), {});
  assert.deepEqual(trustedFeedNetworkLocation({ headers: headers('CA') }), {});
  assert.deepEqual(trustedFeedNetworkLocation(request('10.0.0.2', { ...headers('CA'), 'x-forwarded-for': '173.245.48.20, 203.0.113.9' }, ['uniquelocal', '173.245.48.0/20'])), {});
  for (const country of ['XX', 'T1', 'CA,US', '<US>']) assert.deepEqual(trustedFeedNetworkLocation(request('127.0.0.1', headers(country))), {});
});

test('city headers require explicit edge-transform configuration and keys retain member identity without IPs', () => {
  const req = request('127.0.0.1', { ...headers('CA'), 'cf-ipcity': 'Vancouver', 'cf-region': 'British+Columbia' });
  assert.equal(trustedFeedNetworkLocation(req).city, null);
  const location = trustedFeedNetworkLocation(req, { visitorLocationHeaders: true });
  assert.equal(location.city, 'Vancouver'); assert.equal(location.region, 'British Columbia');
  const key = memberFeedSnapshotKey('alice', 'ranked', 'all', location);
  assert.notEqual(key, memberFeedSnapshotKey('bob', 'ranked', 'all', location));
  assert.notEqual(key, memberFeedSnapshotKey('alice', 'ranked', 'all', { country: 'US' }));
  assert.equal(key.includes('203.0.113'), false);
});

async function fixture(t, { music = false, leadingMusic = false } = {}) {
  const createdAt = new Date().toISOString();
  const inventory = ['United States', 'Canada'].flatMap((country, c) => ['reddit', 'github'].flatMap(source => [120, 1200].map(duration => ({
    id: `${source}_geo_${c}_${duration}`, source, topic: music ? 'Music' : 'Science', title: `${country} ${music ? 'song live performance' : 'science research'}`,
    content: `${country} researchers report their latest science findings in a ${duration}-second presentation.`, location: country,
    source_url: `https://example.com/${source}/${c}/${duration}`, post_created_at: createdAt,
    media_type: 'video', media_url: `https://example.com/${source}/${c}/${duration}.mp4`, video_duration_seconds: duration,
    author_name: 'Public publisher',
  })))).sort((left, right) => left.video_duration_seconds - right.video_duration_seconds);
  if (leadingMusic) inventory.unshift(...['reddit', 'github'].flatMap(source => [2, 1].map(index => ({
    ...inventory.find(row => row.source === source && row.video_duration_seconds === 1200),
    id: `${source}_zzz_music_${index}`, title: `Acoustic song live performance ${index}`, topic: 'Music',
  }))));
  const app = await createAppHarness({ env: { TRUST_PROXY: 'loopback' }, connected: true, query: async (sql, params) => {
    if (!sql.includes('FROM feed_posts_cache')) return { rows: [], rowCount: 0 };
    let rows = inventory;
    if (sql.includes('WITH c(source, before_ts, before_id)')) {
      const values = sql.match(/AS \(VALUES (.*?)\)\s+SELECT/s)[1];
      const slots = [...values.matchAll(/\(\$(\d+), \$(\d+)::timestamptz, \$(\d+)::text\)/g)];
      rows = slots.flatMap(slot => {
        const [source, before, id] = slot.slice(1).map(index => params[Number(index) - 1]);
        return inventory.filter(row => row.source === source && (!before || row.post_created_at < before || (row.post_created_at === before && row.id < id)));
      });
    } else {
      const sourceArg = sql.match(/source = (?:ANY\(\$(\d+)::text\[\]\)|\$(\d+))/);
      if (sourceArg) {
        const value = params[Number(sourceArg[1] || sourceArg[2]) - 1];
        rows = rows.filter(row => (Array.isArray(value) ? value : [value]).includes(row.source));
      }
    }
    for (const [pattern, compare] of [
      [/video_duration_seconds > \$(\d+)/, (value, limit) => value > limit],
      [/video_duration_seconds >= \$(\d+)/, (value, limit) => value >= limit],
      [/video_duration_seconds <= \$(\d+)/, (value, limit) => value <= limit],
    ]) {
      const argument = sql.match(pattern);
      if (argument) rows = rows.filter(row => compare(row.video_duration_seconds, params[Number(argument[1]) - 1]));
    }
    return { rows, rowCount: rows.length };
  } });
  t.after(() => app.close());
  for (const id of ['alice', 'bob']) app.seedUser(member(id, { preferences: { interests: [] }, skills: [], title: '', location: '' }));
  assert.equal(app.addAndBroadcast(inventory.map(app.dbRowToFeedPost)), inventory.length, 'regional fixtures pass ingestion screening');
  return app;
}

for (const route of ['/office/feed?mode=feed&sort=newest&passive=1', '/office/feed?mode=feed&sort=ranked&passive=1', '/office/feed/videos?sort=balanced', '/office/feed/videos?sort=newest']) {
  test(`new members receive public regional candidates without saved topics: ${route}`, async t => {
    const app = await fixture(t);
    const result = await app.request(route + '&limit=10', { userId: 'alice', headers: headers('CA') });
    assert.equal(result.status, 200);
    assert.ok(result.data.posts.length > 0, JSON.stringify({ data: result.data, errors: app.errors }));
    assert.ok(result.data.posts.some(post => post.matchedByLocation));
    assert.ok(result.data.posts.filter(post => post.matchedByLocation).every(post => post.location === 'Canada'));
    assert.match(result.headers.get('cache-control'), /private.*no-store/);
  });
}

test('Global excludes short videos before the cursor cap and ranks a shared candidate page separately for each country', async t => {
  const app = await fixture(t);
  for (const [code, country] of [['CA', 'Canada'], ['US', 'United States']]) {
    const result = await app.request('/feed/guest?limit=10', { headers: headers(code) });
    assert.equal(result.status, 200);
    assert.ok(result.data.posts.length > 0, 'two short videos cannot hide each source’s older regular posts');
    assert.ok(result.data.posts.some(post => post.matchedByLocation && post.location === country));
    assert.ok(result.data.posts.filter(post => post.matchedByLocation).every(post => post.location === country));
    assert.ok(result.data.posts.every(post => post.videoDurationSeconds > 900));
  }
  assert.ok(app.queries.some(entry => entry.sql.includes('fp.media_type IS DISTINCT FROM')));
});

test('Music retains each member’s own seen state and applies current regional context without cacheable responses', async t => {
  const app = await fixture(t, { music: true });
  assert.equal((await app.request('/office/feed/music')).status, 401);
  for (const [userId, code, country] of [['alice', 'CA', 'Canada'], ['bob', 'US', 'United States']]) {
    const result = await app.request('/office/feed/music?limit=10', { userId, headers: headers(code) });
    assert.equal(result.status, 200);
    assert.ok(result.data.posts.some(post => post.matchedByLocation && post.location === country));
    assert.ok(result.data.posts.filter(post => post.matchedByLocation).every(post => post.location === country));
    assert.match(result.headers.get('cache-control'), /private.*no-store/);
  }
});

test('Global advances past a full page of long music videos to regular posts', async t => {
  const app = await fixture(t, { leadingMusic: true });
  const result = await app.request('/feed/guest?limit=10', { headers: headers('CA') });
  assert.equal(result.status, 200);
  assert.ok(result.data.posts.length > 0);
  assert.ok(result.data.posts.every(post => post.topic === 'Science'));
  assert.ok(result.data.posts.some(post => post.matchedByLocation));
  assert.ok(app.queries.filter(entry => entry.sql.includes('WITH c(source, before_ts, before_id)')).length > 1);
});

test('network changes re-rank a member snapshot; saved travel choices and other accounts remain independent', async t => {
  const app = await fixture(t);
  const alice = app.users.find(user => user.id === 'alice');
  alice.roleSettings = { feedLocation: { country: 'Japan', city: 'Tokyo' } };
  const req = request('127.0.0.1', headers('CA')); req.query = { mode: 'feed' };
  assert.equal(app.getFeedLocationContext(req, alice).country, 'CA');
  req.query.mode = 'countries';
  assert.equal(app.getFeedLocationContext(req, alice).country, 'JP');
  const url = '/office/feed?mode=feed&sort=ranked&passive=1&limit=10';
  const ca = await app.request(url, { userId: 'alice', headers: headers('CA') });
  const us = await app.request(url, { userId: 'alice', headers: headers('US') });
  const other = await app.request(url, { userId: 'bob', headers: headers('CA') });
  for (const [result, country] of [[ca, 'Canada'], [us, 'United States'], [other, 'Canada']]) {
    assert.equal(result.status, 200);
    assert.ok(result.data.posts.some(post => post.matchedByLocation && post.location === country));
    assert.ok(result.data.posts.filter(post => post.matchedByLocation).every(post => post.location === country));
  }
  assert.ok([...app.mainFeedSnapshots.keys()].some(key => key.startsWith('alice::')));
  assert.ok([...app.mainFeedSnapshots.keys()].some(key => key.startsWith('bob::')));
  assert.equal([...app.mainFeedSnapshots.keys()].filter(key => key.startsWith('alice::')).length, 2);
});
