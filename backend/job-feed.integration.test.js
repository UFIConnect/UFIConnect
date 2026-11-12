'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./test-support/app-harness');
const actualJobs = require('./job-posts');
const { PGlite } = require('@electric-sql/pglite');
const { JOB_READ_SCHEMA } = require('./job-reads');

test('real opportunities route merges native jobs before source/search/work/date filters and pagination', async t => {
  const now = new Date().toISOString();
  const native = Array.from({ length: 23 }, (_, i) => ({
    id: `bp_integrated_${i}`, type: 'job', title: `Accessibility engineer ${i}`,
    org: 'Native employer', content: 'Build inclusive interfaces and review keyboard support.',
    source: 'UFIConnect', sourceUrl: `https://uficonnect.org/opportunities/bp_integrated_${i}`,
    nativeJob: true, isLive: true, remote: i % 2 === 0, posted: now,
    location: i % 2 === 0 ? 'Remote' : 'London, UK', tags: [],
  }));
  const external = { id: 'external_integrated', type: 'job', title: 'External accountant', org: 'External employer', content: 'Financial reporting', source: 'We Work Remotely', sourceUrl: 'https://example.invalid/job/accountant', isLive: true, remote: true, posted: now, tags: [] };
  const readers = []; let unavailable = false;
  const app = await createAppHarness({ modules: {
    './job-posts': { ...actualJobs, createJobPosts: () => ({ list: async id => { readers.push(id); if (unavailable) throw Error('Synthetic database outage'); return native; }, get: async (_id, id) => native.find(job => job.id === id) }) },
  } });
  t.after(() => app.close()); app.seedUser(member('job-reader'));
  // External jobs now come from the shared pipeline catalog, not a live
  // provider request. Keep this route test focused on merging and filtering.
  app.seedJobCatalog([external]);
  const request = query => app.request('/opportunities?type=job&sort=title&' + query, { userId: 'job-reader' });
  assert.equal((await app.request('/opportunities?type=job')).status, 401);
  const first = await request('limit=20'); assert.equal(first.status, 200);
  assert.equal(first.data.totalCount, 24); assert.equal(first.data.opportunities.length, 20); assert.equal(first.data.hasMore, true);
  assert.ok(first.data.availableSources.includes('UFIConnect')); assert.match(first.headers.get('cache-control'), /private, no-store/);
  const last = await request('offset=20&limit=20'); assert.equal(last.data.opportunities.length, 4); assert.equal(last.data.hasMore, false);
  const all = [...first.data.opportunities, ...last.data.opportunities]; assert.equal(new Set(all.map(v => v.id)).size, 24);
  assert.ok(all.some(v => v.id === external.id)); assert.ok(all.some(v => v.id === native[0].id));
  const nativeOnly = await request('sources=UFIConnect'); assert.equal(nativeOnly.data.totalCount, 23); assert.ok(nativeOnly.data.opportunities.every(v => v.nativeJob));
  const readsBeforeExternal = readers.length;
  const externalOnly = await request('sources=We%20Work%20Remotely'); assert.deepEqual(externalOnly.data.opportunities.map(v => v.id), [external.id]); assert.equal(readers.length, readsBeforeExternal);
  const search = await request('search=keyboard'); assert.equal(search.data.totalCount, 23); assert.ok(search.data.opportunities.every(v => v.nativeJob));
  const onsite = await request('remote=false'); assert.equal(onsite.data.totalCount, 11); assert.ok(onsite.data.opportunities.every(v => v.remote === false));
  const recent = await request('postedWithin=1'); assert.equal(recent.data.totalCount, 24);
  const detail = await app.request('/opportunities/' + native[0].id, { userId: 'job-reader' }); assert.equal(detail.data.job.id, native[0].id);
  assert.ok(readers.every(id => id === 'job-reader'));
  unavailable = true;
  const degraded = await request('limit=20'); assert.equal(degraded.status, 200); assert.equal(degraded.data.totalCount, 1); assert.match(degraded.data.nativeJobsWarning, /temporarily unavailable/);
  const externalHealthy = await request('sources=We%20Work%20Remotely'); assert.equal(externalHealthy.data.nativeJobsWarning, null);
});

test('job read receipts survive retries and distinguish accounts, sources and listings', async t => {
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec('CREATE TABLE users(id UUID PRIMARY KEY)');
  await pg.exec(JOB_READ_SCHEMA);
  await pg.query('INSERT INTO users(id) VALUES ($1), ($2)', [alice, bob]);
  const saved = { job_id: 'shared', source: 'The Muse', status: 'saved' };
  const app = await createAppHarness({ connected: true, query: async (sql, params) => {
    if (sql.includes('job_read_receipts')) return pg.query(sql, params);
    if (sql.startsWith('SELECT * FROM users WHERE id=$1')) return { rows: [{ id: params[0], email: 'reader@example.invalid' }] };
    if (sql.startsWith('SELECT id FROM auth_sessions')) return { rows: [{ id: params[0] }] };
    if (sql.includes('FROM job_tracking') && params[0] === alice) return { rows: [saved] };
    return { rows: [] };
  } });
  t.after(() => app.close());
  const job = { type: 'job', org: 'Employer', isLive: true, posted: new Date().toISOString() };
  app.seedJobCatalog([
    { ...job, id: 'shared', source: 'The Muse', title: 'Designer', sourceUrl: 'https://example.invalid/muse/1' },
    { ...job, id: 'shared', source: 'Remotive', title: 'Engineer', sourceUrl: 'https://example.invalid/remotive/1' },
    { ...job, id: 'other', source: 'The Muse', title: 'Producer', sourceUrl: 'https://example.invalid/muse/2' },
  ]);
  const list = userId => app.request('/opportunities?type=job&includeRead=1', { userId });
  const mark = (userId, body) => app.request('/jobs/read', { userId, body, method: 'POST' });
  assert.equal((await mark(null, { id: 'shared', source: 'muse' })).status, 401);
  assert.equal((await mark(alice, { id: 'shared' })).status, 400);
  const before = await list(alice);
  assert.equal(before.status, 200);
  assert.equal(before.data.opportunities.length, 3);
  assert.equal(before.data.opportunities.some(item => item.read), false);
  const writes = await Promise.all(['muse', 'The Muse'].map(source => mark(alice, { id: 'shared', source, userId: bob })));
  assert.ok(writes.every(response => response.status === 204));
  assert.match(writes[0].headers.get('cache-control'), /private, no-store/);
  const after = await list(alice);
  assert.deepEqual(after.data.opportunities.filter(item => item.read).map(item => [item.source, item.id]), [['The Muse', 'shared']]);
  assert.equal((await list(bob)).data.opportunities.some(item => item.read), false);
  const tracked = await app.request('/jobs/tracking?includeRead=1', { userId: alice });
  assert.deepEqual(tracked.data.jobs.map(({ source, status, read }) => [source, status, read]), [['The Muse', 'saved', true]]);
  assert.deepEqual((await pg.query('SELECT user_id, source, job_id FROM job_read_receipts')).rows, [
    { user_id: alice, source: 'themuse', job_id: 'shared' },
  ]);
});
