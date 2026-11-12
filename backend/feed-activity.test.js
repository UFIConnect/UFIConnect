'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createAppHarness, member } = require('./test-support/app-harness');

test('saved activity changes the feed across API workers without crossing accounts or topic filters', async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`CREATE TABLE user_engagement_affinity (
    user_id TEXT NOT NULL, affinity_key TEXT NOT NULL, weight INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL, PRIMARY KEY (user_id, affinity_key)
  )`);
  let now = Date.now();
  const cohortMs = 6 * 60 * 60 * 1000;
  const start = Math.floor((now - 120000) / cohortMs) * cohortMs;
  const ai = 'AI & Machine Learning', security = 'Cybersecurity';
  const inventory = [
    { id: 'github_ai', topic: ai, age: 60000, content: 'A public research project documents how it evaluates new machine learning models.' },
    { id: 'github_security', topic: security, age: 30000, content: 'Researchers publish practical guidance on protecting accounts with passkeys.' },
  ].map(post => ({
    ...post, source: 'github', source_url: `https://github.com/example/${post.id}`,
    post_created_at: new Date(start + post.age).toISOString(), author_name: 'Research team',
  }));
  const startWorker = async () => {
    const app = await createAppHarness({ connected: true, clock: () => now, query: (sql, params) => {
      if (sql.includes('user_engagement_affinity')) return pg.query(sql, params);
      if (sql.includes('FROM feed_posts_cache') && sql.includes('LOWER(fp.topic)')) {
        const index = Number(sql.match(/LOWER\(fp\.topic\) = ANY\(\$(\d+)/)[1]) - 1;
        return { rows: inventory.filter(post => params[index].includes(post.topic.toLowerCase())) };
      }
      return { rows: [] };
    } });
    t.after(() => app.close());
    for (const id of ['alice', 'bob']) app.seedUser(member(id, { preferences: { interests: [ai] } }));
    return app;
  };
  const writer = await startWorker();
  const reader = await startWorker();
  const feed = '/office/feed?mode=feed&sort=newest&personalize=1';
  const readFeed = async (app, userId, route = feed) => {
    const result = await app.request(route, { userId });
    assert.equal(result.status, 200, JSON.stringify({ response: result.data, errors: app.errors }));
    assert.match(result.headers.get('cache-control'), /private.*no-store/);
    return result.data.posts.map(post => post.id);
  };
  const record = async (userId, signal) => {
    const response = await writer.request('/posts/engagement-signal', {
      userId, method: 'POST', body: { source: 'github', ...signal },
    });
    assert.equal(response.status, 204);
  };
  assert.deepEqual(await readFeed(reader, 'bob'), ['github_ai']);
  await record('alice', { topic: ai, watchMs: 12000 });
  await record('bob', { topic: security, readMs: 500 });
  assert.deepEqual(await readFeed(writer, 'bob'), ['github_ai']);
  await record('bob', { topic: security, readMs: 2000 });
  await record('bob', { topic: security, readMs: 2000 });
  assert.deepEqual(await readFeed(writer, 'bob'), ['github_security', 'github_ai']);
  assert.deepEqual(await readFeed(writer, 'alice'), ['github_ai']);
  assert.deepEqual((await pg.query(
    "SELECT user_id, affinity_key, weight FROM user_engagement_affinity WHERE affinity_key LIKE 'topic:%' ORDER BY user_id"
  )).rows, [
    { user_id: 'alice', affinity_key: `topic:${ai}`, weight: 12 },
    { user_id: 'bob', affinity_key: `topic:${security}`, weight: 6 },
  ]);
  now += 31000;
  assert.deepEqual(await readFeed(reader, 'bob'), ['github_security', 'github_ai']);
  assert.deepEqual(await readFeed(reader, 'alice'), ['github_ai']);
  assert.deepEqual(await readFeed(reader, 'bob', `${feed}&topics=${encodeURIComponent(ai)}`), ['github_ai']);
});
