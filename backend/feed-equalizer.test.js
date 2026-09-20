'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./generated-media');
const { createAppHarness, member } = require('./test-support/app-harness');

const topics = ['Open Source', 'AI & Machine Learning'];
function fixture() {
  // Every Reddit item is newer than every Hacker News item. A global date
  // sort would hide the equalizer even though both sources have supply.
  return ['reddit', 'hackernews', 'devto'].flatMap((source, lane) =>
    Array.from({ length: 8 }, (_, index) => ({
      id: `${source}_equalizer_${index}`, source,
      title: `Building community tools ${lane}-${index}`,
      content: 'A detailed discussion of useful open source software and community projects.',
      topic: topics[index < 4 ? 0 : 1], author_name: 'Community developer',
      source_url: `https://example.org/articles/${source}/${index}`,
      post_created_at: new Date(Date.now() - (lane * 60 + index + 1) * 60000).toISOString(),
    })));
}

async function feedHarness({ videos = false } = {}) {
  const rows = fixture().map(row => videos ? { ...row, media_type: 'video', media_url: `https://example.org/${row.id}.mp4`, video_duration_seconds: 60 } : row);
  const app = await createAppHarness({ connected: true, query(sql, params) {
    if (!sql.includes('WITH c(source, before_ts, before_id)')) return { rows: [] };
    const laneCount = [...sql.matchAll(/\(\$\d+, \$\d+::timestamptz, \$\d+::text\)/g)].length;
    const limit = params.at(-1);
    return { rows: Array.from({ length: laneCount }, (_, i) => {
      const [source, before, id] = params.slice(i * 3, i * 3 + 3);
      return rows.filter(row => row.source === source && (!before || row.post_created_at < before
        || (row.post_created_at === before && row.id < id))).slice(0, limit);
    }).flat() };
  } });
  app.seedUser(member('equalizer-viewer', { preferences: { interests: topics } }));
  return { app, rows, request: query => app.request(`/office/feed${videos ? '/videos' : ''}?mode=feed&sort=newest&passive=1&${query}`, { userId: 'equalizer-viewer' }) };
}

test('selected sources stay equalized across different timestamps and cursor pages', async () => {
  const { app, rows, request } = await feedHarness();
  try {
    const received = [];
    let cursor = '';
    for (let page = 0; page < 4; page++) {
      const result = await request(`sources=reddit,hackernews&limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      assert.equal(result.status, 200);
      assert.deepEqual(result.data.posts.map(post => post.source), ['reddit', 'hackernews', 'reddit', 'hackernews']);
      received.push(...result.data.posts.map(post => post.id));
      cursor = result.data.cursor;
      assert.ok(cursor);
    }
    assert.equal(new Set(received).size, 16, 'pagination never repeats or skips selected-source posts');
    assert.deepEqual([...received].sort(), rows.filter(row => row.source !== 'devto').map(row => row.id).sort());
  } finally { await app.close(); }
});

test('one selected source still equalizes its topics, including manual refresh', async () => {
  const { app, request } = await feedHarness();
  try {
    for (const extra of ['', '&bust=1']) {
      const result = await request(`source=reddit&limit=20${extra}`);
      assert.equal(result.status, 200);
      const posts = result.data.posts;
      assert.equal(posts.length, 8);
      assert.ok(posts.every(post => post.source === 'reddit'));
      assert.ok(posts.slice(0, 3).some(post => post.topic === topics[1]), 'a quieter topic appears before the dominant topic is exhausted');
      assert.equal(new Set(posts.map(post => post.id)).size, 8);
    }
  } finally { await app.close(); }
});

test('disabled and unselected sources do not return through the equalizer', async () => {
  const { app, request } = await feedHarness();
  app.users.find(user => user.id === 'equalizer-viewer').roleSettings.disabledSources = ['hackernews'];
  try {
    const result = await request('sources=reddit,hackernews&limit=4');
    assert.equal(result.status, 200);
    assert.ok(result.data.posts.length > 0);
    assert.ok(result.data.posts.every(post => post.source === 'reddit'));
  } finally { await app.close(); }
});

test('Following keeps selected connected sources balanced in newest and popular feeds', async () => {
  const app = await createAppHarness();
  const viewer = member('following-equalizer', {
    preferences: { interests: topics },
    socialTokens: { reddit: 'test-only', github: 'test-only', devto: 'test-only' },
  });
  app.seedUser(viewer);
  for (const [source, original] of [['reddit', 'reddit'], ['github', 'hackernews'], ['devto', 'devto']]) {
    const posts = fixture().filter(row => row.source === original).map(row => app.dbRowToFeedPost({ ...row, source }));
    app.followingSourceCache.set(`${viewer.id}::${source}`, { posts, fetchedAt: Date.now() });
  }
  try {
    for (const sort of ['newest', 'popular']) {
      const request = query => app.request(`/office/feed?mode=following&passive=1&sort=${sort}&${query}`, { userId: viewer.id });
      const first = await request('sources=reddit,github&limit=4');
      assert.equal(first.status, 200);
      assert.deepEqual(first.data.posts.map(post => post.source), ['reddit', 'github', 'reddit', 'github']);
      const second = await request(`sources=reddit,github&limit=4&cursor=${encodeURIComponent(first.data.cursor)}`);
      assert.equal(second.status, 200);
      assert.equal(new Set([...first.data.posts, ...second.data.posts].map(post => post.id)).size, 8);
      assert.ok(second.data.posts.every(post => ['reddit', 'github'].includes(post.source)));
      const single = await request('source=reddit&limit=20');
      assert.ok(single.data.posts.every(post => post.source === 'reddit'));
      assert.ok(single.data.posts.slice(0, 3).some(post => post.topic === topics[1]));
    }
  } finally { await app.close(); }
});

test('Videos keeps selected sources and single-source topics equalized', async () => {
  const { app, request } = await feedHarness({ videos: true });
  try {
    const first = await request('sources=reddit,hackernews&limit=4');
    assert.equal(first.status, 200);
    assert.deepEqual(first.data.posts.map(post => post.source), ['reddit', 'hackernews', 'reddit', 'hackernews']);
    const second = await request(`sources=reddit,hackernews&limit=4&cursor=${encodeURIComponent(first.data.cursor)}`);
    assert.equal(second.status, 200);
    assert.deepEqual(second.data.posts.map(post => post.source), ['reddit', 'hackernews', 'reddit', 'hackernews']);
    assert.equal(new Set([...first.data.posts, ...second.data.posts].map(post => post.id)).size, 8);
    const single = await request('source=reddit&limit=20');
    assert.ok(single.data.posts.length > 0);
    assert.ok(single.data.posts.every(post => post.source === 'reddit'));
    assert.ok(single.data.posts.slice(0, 3).some(post => post.topic === topics[1]));
  } finally { await app.close(); }
});

test('Following videos preserves the mix for selected connected sources', async () => {
  const app = await createAppHarness();
  const viewer = member('following-video-equalizer', { preferences: { interests: topics }, socialTokens: { reddit: 'test-only', github: 'test-only' } });
  app.seedUser(viewer);
  for (const [source, original] of [['reddit', 'reddit'], ['github', 'hackernews']]) {
    app.followingSourceCache.set(`${viewer.id}::${source}`, { fetchedAt: Date.now(),
      posts: fixture().filter(row => row.source === original).map(row => app.dbRowToFeedPost({ ...row, source, media_type: 'video', media_url: `https://example.org/${row.id}.mp4`, video_duration_seconds: 60 })) });
  }
  try {
    const result = await app.request('/office/feed/videos/following?sources=reddit,github&limit=4', { userId: viewer.id });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.posts.map(post => post.source), ['reddit', 'github', 'reddit', 'github']);
  } finally { await app.close(); }
});
