const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');

test('map source topics reach the indexed query and keep full video posts', async t => {
  const reads = [];
  const app = await createAppHarness({ connected: true, query: async (sql, params) => {
    if (!sql.includes('WITH c(source, before_ts, before_id, topics)')) return { rows: [] };
    reads.push({ sql, params });
    return { rows: [{ id: 'youtube_map_demo', source: 'youtube', topic: 'Frontend Dev',
      title: 'A frontend workshop', content: 'A detailed frontend workshop about web development.',
      source_url: 'https://www.youtube.com/watch?v=MapDemo0001', media_url: 'https://www.youtube.com/watch?v=MapDemo0001',
      media_type: 'video', video_duration_seconds: 120, author_name: 'Workshop host', post_created_at: new Date().toISOString() }] };
  } });
  t.after(() => app.close());
  app.seedUser(member('map-reader', { preferences: { interests: ['Cooking'] } }));
  const filters = encodeURIComponent(JSON.stringify({ youtube: ['frontend dev'], reddit: [] }));
  const response = await app.request('/office/feed?surface=maps&sources=youtube,reddit&mapTopics=' + filters + '&passive=1&sort=newest&limit=20', { userId: 'map-reader' });
  assert.equal(response.status, 200);
  assert.equal(response.data.posts.length, 1);
  assert.equal(response.data.posts[0].mediaType, 'video');
  assert.ok(reads[0].sql.includes('LOWER(TRIM(fp.topic)) = ANY(c.topics)'));
  assert.ok(reads[0].params.some(value => Array.isArray(value) && value.includes('frontend dev')));
  assert.ok(reads[0].params.some(value => Array.isArray(value) && value.length === 0));
  assert.ok(!reads[0].sql.includes('FROM seen_posts'), 'Passive map browsing must not lose previously read posts');
  assert.deepEqual(app.errors, []);
});
test('map filters retain authentication and reject malformed scopes', async t => {
  const app = await createAppHarness(); t.after(() => app.close());
  app.seedUser(member('map-reader'));
  const url = '/office/feed?surface=maps&sources=reddit&mapTopics=broken';
  assert.equal((await app.request(url)).status, 401);
  assert.equal((await app.request(url, { userId: 'map-reader' })).status, 400);
});
