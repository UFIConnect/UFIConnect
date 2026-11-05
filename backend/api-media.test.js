'use strict';

const { before, after, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { registerAPIMediaRoutes, API_MEDIA_SCHEMA } = require('./api-media');

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
let pg;
before(async () => {
  pg = new PGlite();
  await pg.exec('CREATE TABLE ufi_api_keys(id UUID PRIMARY KEY)');
  await pg.exec(API_MEDIA_SCHEMA);
  await pg.query('INSERT INTO ufi_api_keys(id) VALUES($1),($2)', [A, B]);
});
after(async () => { await pg.close(); });
beforeEach(async () => { await pg.exec('DELETE FROM ufi_api_media_jobs'); });

async function fixture(t, overrides = {}) {
  const app = express();
  const state = { connected: true, failStorage: false, counts: {}, imageCalls: 0, videoCalls: 0, statusCalls: 0, streamCalls: 0,
    job: { id: 'video_private_provider_job', status: 'queued', progress: 0 }, dispatchStates: [] };
  const db = { isConnected: () => state.connected, query(sql, args) {
    if (state.failStorage) throw Error('private database connection string');
    return pg.query(sql, args);
  } };
  const apiKeys = {
    privateResponse(_req, res, next) { res.set('Cache-Control', 'private, no-store'); next(); },
    requestLimit(_req, _res, next) { next(); },
    authenticate(scope) { return (req, res, next) => {
      const token = req.get('authorization');
      if (!['Bearer alpha', 'Bearer beta', 'Bearer data'].includes(token)) return res.status(401).json({ error: 'Invalid key.' });
      if (token === 'Bearer data') return res.status(403).json({ error: 'Missing ' + scope });
      req.ufiApiKey = { id: token === 'Bearer alpha' ? A : B, type: 'media', scopes: ['images:generate', 'videos:generate'] };
      next();
    }; },
    async consumeGeneration(id, scope) {
      const key = id + ':' + scope, used = state.counts[key] || 0;
      if (used >= 2) throw Object.assign(Error('Daily generation limit reached.'), { status: 429 });
      state.counts[key] = used + 1;
      return { scope, limit: 2, used: used + 1, remaining: 1 - used, resetsAt: '2026-11-05T00:00:00Z' };
    },
  };
  const adapters = {
    db, apiKeys,
    async screenPrompt() { return { allowed: true }; },
    async generateImage() { state.imageCalls++; return 'data:image/png;base64,aW1hZ2U='; },
    async createVideo() {
      state.videoCalls++;
      state.dispatchStates.push((await pg.query('SELECT state FROM ufi_api_media_jobs ORDER BY created_at DESC')).rows[0]?.state);
      return state.job;
    },
    async getVideo() { state.statusCalls++; return state.job; },
    async streamVideo(_providerId, res) { state.streamCalls++; res.end('fixture video bytes'); },
    ...overrides,
  };
  registerAPIMediaRoutes(app, adapters);
  const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { key = 'alpha', method = 'GET', body } = {}) {
    const response = await fetch(origin + path, { method, headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, headers: response.headers, data };
  }
  return { app, request, state, adapters };
}
const image = (f, body = { prompt: 'A coastal garden' }, options = {}) => f.request('/api/v1/images/generations', { method: 'POST', body, ...options });
const video = (f, body = { prompt: 'A coastal garden', seconds: 4 }, options = {}) => f.request('/api/v1/videos/generations', { method: 'POST', body, ...options });

test('media routes require a key and their own permission before calling a provider', async t => {
  const f = await fixture(t);
  assert.equal((await image(f, undefined, { key: null })).status, 401);
  assert.equal((await image(f, undefined, { key: 'data' })).status, 403);
  assert.equal((await video(f, undefined, { key: 'data' })).status, 403);
  assert.equal(f.state.imageCalls, 0);
  assert.equal(f.state.videoCalls, 0);
  assert.deepEqual(f.state.counts, {});
});

test('invalid input, unavailable providers and rejected screening consume no generation allowance', async t => {
  const f = await fixture(t);
  for (const body of [{ prompt: '' }, { prompt: 'x'.repeat(1001) }, { prompt: 'test', userId: B }, [], { prompt: 42 }]) assert.equal((await image(f, body)).status, 400);
  for (const seconds of [3, 13, '4', 4.5]) assert.equal((await video(f, { prompt: 'test', seconds })).status, 400);
  const missing = await fixture(t, { generateImage: undefined, createVideo: undefined });
  assert.equal((await image(missing)).status, 503);
  assert.equal((await video(missing)).status, 503);
  assert.deepEqual(missing.state.counts, {});
  const blocked = await fixture(t, { screenPrompt: async () => ({ allowed: false, reason: 'policy' }) });
  assert.equal((await image(blocked)).status, 422);
  const down = await fixture(t, { screenPrompt: async () => { throw Error('screening provider secret'); } });
  const response = await video(down);
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(response.data), /provider secret/);
  assert.deepEqual(blocked.state.counts, {});
  assert.deepEqual(down.state.counts, {});
  assert.deepEqual(f.state.counts, {});
});

test('photo generation returns only the image result and daily usage, and enforces its cap', async t => {
  const f = await fixture(t);
  const response = await image(f);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(response.data.data, [{ b64_json: 'aW1hZ2U=' }]);
  assert.equal(response.data.usage.used, 1);
  assert.equal((await image(f)).status, 200);
  const capped = await image(f);
  assert.equal(capped.status, 429);
  assert.equal(f.state.imageCalls, 2);
});

test('photo provider failures retain usage and never leak provider details', async t => {
  const f = await fixture(t, { generateImage: async () => { throw Error('provider key and upstream response'); } });
  const response = await image(f);
  assert.equal(response.status, 502);
  assert.match(response.data.error, /do not automatically retry/);
  assert.doesNotMatch(JSON.stringify(response.data), /provider key|upstream response/);
  assert.equal(f.state.counts[A + ':images:generate'], 1);
  const invalid = await fixture(t, { generateImage: async () => 'https://untrusted.example/image.png' });
  assert.equal((await image(invalid)).status, 502);
});

test('video jobs persist before submission and status and downloads remain bound to their creating key', async t => {
  const f = await fixture(t);
  const created = await video(f);
  assert.equal(created.status, 202);
  assert.match(created.data.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(f.state.dispatchStates, ['dispatching']);
  assert.equal(created.data.status, 'queued');
  assert.doesNotMatch(JSON.stringify(created.data), /private_provider|provider_id/);
  const path = '/api/v1/videos/' + created.data.id;
  assert.equal((await f.request(path, { key: 'beta' })).status, 404);
  assert.equal((await f.request(path + '/content', { key: 'beta' })).status, 404);
  assert.equal((await f.request(path + '/content')).status, 409);
  f.state.job = { ...f.state.job, status: 'completed', progress: 100, privateSecret: 'never return' };
  const done = await f.request(path);
  assert.equal(done.data.status, 'completed');
  assert.doesNotMatch(JSON.stringify(done.data), /never return|private_provider/);
  const download = await f.request(path + '/content');
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'video/mp4');
  assert.equal(download.data, 'fixture video bytes');
  assert.equal(f.state.streamCalls, 1);
  assert.equal(f.state.counts[A + ':videos:generate'], 1);
  assert.equal(f.state.videoCalls, 1);
  await f.request(path);
  assert.equal(f.state.statusCalls, 1);
  const stored = (await pg.query('SELECT key_id,provider_id,state FROM ufi_api_media_jobs WHERE id=$1', [created.data.id])).rows[0];
  assert.deepEqual(stored, { key_id: A, provider_id: 'video_private_provider_job', state: 'completed' });
});

test('unknown video dispatch survives a new router instance and polling never resubmits it', async t => {
  let submits = 0;
  const f = await fixture(t, { createVideo: async () => { submits++; throw Error('private timeout with provider secret'); } });
  const response = await video(f);
  assert.equal(response.status, 502);
  assert.equal(response.data.status, 'unknown');
  assert.doesNotMatch(JSON.stringify(response.data), /private timeout|provider secret/);
  assert.equal(f.state.counts[A + ':videos:generate'], 1);
  const restarted = await fixture(t);
  const poll = await restarted.request('/api/v1/videos/' + response.data.id);
  assert.equal(poll.status, 200);
  assert.equal(poll.data.status, 'unknown');
  assert.equal(submits, 1);
  assert.equal(restarted.state.videoCalls, 0);
  assert.equal(restarted.state.statusCalls, 0);
});

test('failed videos hide provider diagnostics, cannot download, and status failures do not resubmit', async t => {
  const f = await fixture(t);
  const created = await video(f);
  f.state.job = { ...f.state.job, status: 'failed', error: { message: 'private provider billing details' } };
  const path = '/api/v1/videos/' + created.data.id;
  const failed = await f.request(path);
  assert.equal(failed.data.status, 'failed');
  assert.doesNotMatch(JSON.stringify(failed.data), /billing|private provider/);
  assert.equal((await f.request(path + '/content')).status, 409);
  assert.equal(f.state.videoCalls, 1);
});

test('database unavailability fails closed before any provider call or daily charge', async t => {
  const f = await fixture(t);
  f.state.connected = false;
  assert.equal((await image(f)).status, 503);
  assert.equal((await video(f)).status, 503);
  assert.equal((await f.request('/api/v1/videos/' + A)).status, 503);
  assert.equal(f.state.imageCalls, 0);
  assert.equal(f.state.videoCalls, 0);
  assert.deepEqual(f.state.counts, {});
  f.state.connected = true; f.state.failStorage = true;
  const down = await video(f);
  assert.equal(down.status, 503);
  assert.doesNotMatch(JSON.stringify(down.data), /connection string/);
});
