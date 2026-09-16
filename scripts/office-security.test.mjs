import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficeClient, createOfficeEventSource, createTrustedOfficeFetch } from '../office/src/office-runtime.mjs';

test('Office discards persistent credentials and shares one masked sign-in request', async () => {
  let deleted = false, prompts = 0;
  const calls = [];
  const client = createOfficeClient({
    storage: { removeItem(key) { assert.equal(key, 'ufi_office_token'); deleted = true; },
      getItem() { throw new Error('Persistent credentials must never be read'); },
      setItem() { throw new Error('Credentials must never be persisted'); } },
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return { status: options.headers['x-office-token'] === 'fixture-office-token' ? 200 : 401 };
    },
    prompt: async () => { prompts++; await new Promise(resolve => setTimeout(resolve, 5)); return 'fixture-office-token'; },
    onTokenChange() {},
  });
  assert.equal(deleted, true);
  assert.equal(client.getToken(), '');
  assert.deepEqual((await Promise.all([client.request('/office/status'), client.request('/office/agents')])).map(r => r.status), [200, 200]);
  assert.equal(prompts, 1);
  assert.equal(client.getToken(), 'fixture-office-token');
  assert.ok(calls.every(call => !call.url.includes('token')));
});

test('Office stream authenticates using a header, parses chunk boundaries and can abort', async () => {
  let captured, stream, resolved;
  const received = new Promise(resolve => { resolved = resolve; });
  const OfficeStream = createOfficeEventSource({
    getToken: () => 'fixture-private-value',
    fetcher: async (url, options) => {
      captured = { url, options };
      return new Response(new ReadableStream({ start(controller) {
        const encode = value => new TextEncoder().encode(value);
        controller.enqueue(encode('data: {"ok":'));
        controller.enqueue(encode('true}\r\n\r'));
        controller.enqueue(encode('\n'));
      } }), { headers: { 'content-type': 'text/event-stream' } });
    },
  });
  stream = new OfficeStream('https://api.example.invalid/office/agents/stream');
  stream.onmessage = event => { resolved(event.data); stream.close(); };
  assert.equal(await received, '{"ok":true}');
  assert.equal(new URL(captured.url).search, '');
  assert.equal(captured.options.headers['x-office-token'], 'fixture-private-value');
  assert.equal(captured.options.credentials, 'omit');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.options.cache, 'no-store');
  assert.equal(captured.options.signal.aborted, true);
});

test('Office stream does not treat a login HTML page as an authenticated connection', async () => {
  let opened = false;
  const OfficeStream = createOfficeEventSource({ getToken: () => '', fetcher: async () => new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }) });
  const stream = new OfficeStream('/office/agents/stream');
  stream.onopen = () => { opened = true; };
  await new Promise(resolve => { stream.onerror = () => { stream.close(); resolve(); }; });
  assert.equal(opened, false);
});

test('Office refuses cleartext APIs and never forwards credentials to another origin', async () => {
  const captured = [];
  const config = { pageUrl: 'https://office.example.invalid', fetcher: (...args) => captured.push(args) };
  assert.throws(() => createTrustedOfficeFetch({ ...config, baseUrls: ['http://api.example.invalid'] }), /HTTPS/);
  assert.throws(() => createTrustedOfficeFetch({ ...config, baseUrls: ['https://user:pass@api.example.invalid'] }), /HTTPS/);
  const request = createTrustedOfficeFetch({ ...config, baseUrls: ['https://api.example.invalid'] });
  assert.throws(() => request('https://untrusted.example.invalid/collect', { headers: { 'x-office-token': 'fixture' } }), /not trusted/);
  assert.equal(captured.length, 0);
  request('https://api.example.invalid/office/status', { redirect: 'follow' });
  assert.equal(captured[0][1].redirect, 'error');
});
