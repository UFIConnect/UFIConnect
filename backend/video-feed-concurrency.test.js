const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
require('./generated-media');
const { createAppHarness, member } = require('./test-support/app-harness');

test('video source discovery coalesces concurrent misses and retains the TTL cache', async t => {
  let queries = 0, release;
  const held = new Promise(resolve => { release = resolve; });
  const app = await createAppHarness({ connected: true, async query(sql) {
    if (!sql.includes('SELECT DISTINCT source')) return { rows: [] };
    queries++; await held;
    return { rows: [{ source: 'youtube' }, { source: 'reddit' }] };
  } });
  t.after(() => app.close());
  const requests = Array.from({ length: 200 }, () => app.getVideoCapableSources());
  assert.equal(queries, 1, 'one SQL discovery serves the entire cold burst');
  release();
  const sources = await Promise.all(requests);
  assert.ok(sources.every(value => value.includes('youtube') && value.includes('reddit')));
  await app.getVideoCapableSources();
  assert.equal(queries, 1, 'warm discovery does not query again');
});

test('failed video source discovery can retry instead of retaining a failed in-flight request', async t => {
  let attempts = 0;
  const app = await createAppHarness({ connected: true, async query(sql) {
    if (!sql.includes('SELECT DISTINCT source')) return { rows: [] };
    if (++attempts === 1) throw new Error('Fixture database failure');
    return { rows: [{ source: 'youtube' }] };
  } });
  t.after(() => app.close());
  assert.equal(await app.getVideoCapableSources(), null);
  assert.ok((await app.getVideoCapableSources()).includes('youtube'));
  assert.equal(attempts, 2);
});

test('real HTTP Videos and Music routes share bounded admission and recover after overload', async t => {
  let release, discoveryQueries = 0;
  const held = new Promise(resolve => { release = resolve; });
  const app = await createAppHarness({ connected: true,
    env: { VIDEO_READ_MAX_ACTIVE: '2', VIDEO_READ_MAX_QUEUED: '2', VIDEO_READ_QUEUE_TIMEOUT_MS: '2000' },
    async query(sql) {
      if (sql.includes('SELECT DISTINCT source')) { discoveryQueries++; await held; }
      return { rows: [] };
    },
  });
  t.after(() => app.close());
  app.seedUser(member('concurrent-viewer', { preferences: { interests: ['Music', 'Open Source'] } }));
  const requests = Array.from({ length: 12 }, (_, index) => app.request(`/office/feed/${index % 2 ? 'music' : 'videos'}?limit=2`, { userId: 'concurrent-viewer' }));
  try {
    for (let attempt = 0; attempt < 100 && app.videoReadAdmission.snapshot().rejected < 8; attempt++) await delay(10);
    assert.equal(app.videoReadAdmission.snapshot().active, 2);
    assert.equal(app.videoReadAdmission.snapshot().queued, 2);
    assert.equal(app.videoReadAdmission.snapshot().rejected, 8);
    assert.equal(discoveryQueries, 1);
  } finally { release(); }
  const results = await Promise.all(requests);
  assert.equal(results.filter(result => result.status === 200).length, 4);
  const overloaded = results.filter(result => result.status === 503);
  assert.equal(overloaded.length, 8);
  assert.ok(overloaded.every(result => result.headers.get('retry-after') === '2' && result.data.code === 'FEED_BUSY'));
  assert.equal(app.videoReadAdmission.snapshot().active, 0);
  assert.equal(app.videoReadAdmission.snapshot().queued, 0);
  assert.equal((await app.request('/office/feed/videos?limit=2', { userId: 'concurrent-viewer' })).status, 200);
});
