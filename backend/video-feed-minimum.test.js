'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('./generated-media');
const { createAppHarness, member } = require('./test-support/app-harness');

for (const surface of ['videos', 'music']) test(`${surface} removes short clips without losing the five-second boundary or unknown metadata`, async t => {
  const rows = [1, 4, 5, 60, null].map((duration, index) => ({
    id: `reddit_duration_${index}`, source: 'reddit', title: surface === 'music' ? 'Acoustic song live performance' : 'A useful community project update',
    content: 'A detailed community video with helpful information about this performance and project.',
    author_name: 'Community creator', source_url: `https://www.reddit.com/r/videos/comments/test${index}`,
    media_type: 'video', media_url: `https://media.example.org/video${index}.mp4`, video_duration_seconds: duration,
    topic: surface === 'music' ? 'Music' : 'Open Source',
    post_created_at: new Date(Date.now() - index * 60000).toISOString(),
  }));
  const app = await createAppHarness({ connected: true, query(sql, params) {
    if (!sql.includes('WITH c(source, before_ts, before_id)')) return { rows: [] };
    const before = params[1], beforeId = params[2];
    return { rows: rows.filter(row => !before || row.post_created_at < before || (row.post_created_at === before && row.id < beforeId)).slice(0, params.at(-1)) };
  } });
  t.after(() => app.close());
  const viewer = member(`minimum-${surface}`, { preferences: { interests: ['Open Source', 'Music'] }, socialTokens: { reddit: 'test-only' } });
  app.seedUser(viewer);
  const result = await app.request(`/office/feed/${surface}?source=reddit&sort=newest&passive=1&limit=20`, { userId: viewer.id });
  assert.equal(result.status, 200);
  assert.deepEqual(new Set(result.data.posts.map(post => post.id)), new Set(rows.slice(2).map(row => row.id)));
  if (surface === 'videos') {
    app.followingSourceCache.set(`${viewer.id}::reddit`, { fetchedAt: Date.now(), posts: rows.map(row => app.dbRowToFeedPost(row)) });
    const following = await app.request('/office/feed/videos/following?source=reddit&limit=20', { userId: viewer.id });
    assert.equal(following.status, 200);
    assert.deepEqual(new Set(following.data.posts.map(post => post.id)), new Set(rows.slice(2).map(row => row.id)));
  }
});
