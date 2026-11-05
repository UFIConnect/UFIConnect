'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPublishingHttp } = require('./publishing-http');

test('publishing transport pins HTTPS destinations before attaching credentials', async () => {
  let calls = 0;
  const service = createPublishingHttp({ fetcher: async () => { calls++; return new Response('{}'); } });
  for (const url of ['http://api.github.com/user', 'https://api.github.com.evil.test/user', 'https://user:secret@api.github.com/user', 'https://api.github.com:444/user', 'https://127.0.0.1/']) await assert.rejects(service.request(url, { headers: { Authorization: 'Bearer synthetic' } }), /not allowed/);
  assert.equal(calls, 0);
});

test('publishing transport returns provider denials and never follows redirects', async () => {
  let options;
  const service = createPublishingHttp({ fetcher: async (_url, request) => { options = request; return new Response('{"error":"denied"}', { status: 403, headers: { Location: 'https://other.test' } }); } });
  const result = await service.request('https://api.github.com/user');
  assert.equal(result.status, 403); assert.equal(options.redirect, 'manual'); assert.equal(result.headers.location, 'https://other.test');
});

test('publishing transport bounds responses and preserves uncertainty without exposing secrets', async () => {
  const service = createPublishingHttp({ fetcher: async () => { throw Error('secret-token in upstream URL'); } });
  await assert.rejects(service.request('https://discord.com/api/webhooks/example', { method: 'POST', json: { content: 'hello' } }), error => error.deliveryUncertain === true && !error.message.includes('secret-token'));
  const oversized = createPublishingHttp({ fetcher: async () => new Response('{}', { headers: { 'Content-Length': String(5 * 1024 * 1024) } }) });
  await assert.rejects(oversized.request('https://api.github.com/user'), /could not be reached/);
});

test('media downloads allow only bounded uploads belonging to the configured cloud', async () => {
  const calls = [];
  const service = createPublishingHttp({ cloudName: 'ufi-cloud', fetcher: async (url, options) => { calls.push({ url, options }); return new Response('video-bytes', { headers: { 'Content-Type': 'video/mp4' } }); } });
  for (const url of ['https://res.cloudinary.com/other/video/upload/a.mp4', 'https://res.cloudinary.com/ufi-cloud/video/fetch/https://elsewhere.test/a', 'https://elsewhere.test/video/upload/a.mp4']) await assert.rejects(service.downloadMedia(url, { kind: 'video' }));
  assert.equal(calls.length, 0);
  const result = await service.downloadMedia('https://res.cloudinary.com/ufi-cloud/video/upload/a.mp4', { kind: 'video', maxBytes: 100 });
  assert.equal(result.body.toString(), 'video-bytes'); assert.equal(result.contentType, 'video/mp4'); assert.equal(calls[0].options.redirect, 'manual');
  await assert.rejects(service.downloadMedia('https://res.cloudinary.com/ufi-cloud/video/upload/a.mp4', { kind: 'video', maxBytes: 2 }), /size limit/);
});
