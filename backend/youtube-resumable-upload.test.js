'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { uploadYouTubeVideo } = require('./youtube-resumable-upload');
const URL = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=private-session';
const receipt = { status: 201, data: { id: 'video123456' }, headers: {} };
function fixture(responses, options = {}) {
  const calls = [];
  let clock = 0;
  return { calls, upload: () => uploadYouTubeVideo({ url: URL, body: Buffer.from('video'), contentType: 'video/mp4',
    headers: { Authorization: 'Bearer private-token' }, now: () => clock, sleep: async ms => { clock += ms; },
    request: async (url, input) => {
      calls.push({ url, ...input });
      const response = responses.shift();
      assert.ok(response, 'Unexpected upload request');
      return typeof response === 'function' ? response(input, ms => { clock += ms; }) : response;
    }, ...options }) };
}

test('a lost final upload response is recovered by probing the same session without sending the video twice', async () => {
  const f = fixture([() => { throw Object.assign(Error('private-token transport reset'), { deliveryUncertain: true }); }, receipt]);
  assert.deepEqual(await f.upload(), receipt);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body.toString(), 'video');
  assert.equal(f.calls[1].body.length, 0);
  assert.equal(f.calls[1].headers['Content-Range'], 'bytes */5');
  assert.ok(f.calls.every(call => call.url === URL && call.method === 'PUT'));
});

test('308 and interrupted transfers resume only the provider-confirmed remaining bytes', async () => {
  for (const interrupted of [false, true]) {
    const f = fixture([...(interrupted ? [() => { throw Object.assign(Error('reset'), { status: 502, deliveryUncertain: true }); }] : []),
      { status: 308, headers: { range: 'bytes=0-1' }, data: {} }, receipt]);
    await f.upload();
    const resumed = f.calls.at(-1);
    assert.equal(resumed.body.toString(), 'deo');
    assert.equal(resumed.headers['Content-Length'], '3');
    assert.equal(resumed.headers['Content-Range'], 'bytes 2-4/5');
    assert.ok(f.calls.every(call => call.method === 'PUT' && call.url === URL));
  }
});

test('no bytes stored resumes from zero; missing final receipt never causes a new session', async () => {
  const f = fixture([{ status: 308, headers: {}, data: {} }, receipt]);
  await f.upload();
  assert.equal(f.calls[1].headers['Content-Range'], 'bytes 0-4/5');
  assert.equal(f.calls[1].body.toString(), 'video');
  const pending = fixture(Array.from({ length: 5 }, () => ({ status: 308, headers: { range: 'bytes=0-4' } })));
  await assert.rejects(pending.upload(), error => error.deliveryUncertain === true && !error.message.includes('private-session'));
  assert.ok(pending.calls.slice(1).every(call => call.body.length === 0));
});

test('recovery honors Retry-After but cannot exceed the shared upload budget', async () => {
  const f = fixture([{ status: 503, headers: { 'retry-after': '2' } }, (_request, advance) => { advance(177000); return { status: 503, headers: {} }; }]);
  await assert.rejects(f.upload(), error => error.deliveryUncertain === true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].headers['Content-Range'], 'bytes */5');
  assert.ok(f.calls[1].timeoutMs <= 178000);
  const nearDeadline = fixture([(_request, advance) => { advance(179500); return { status: 308, headers: { range: 'bytes=0-1' } }; }]);
  await assert.rejects(nearDeadline.upload(), error => error.deliveryUncertain === true);
  assert.equal(nearDeadline.calls.length, 1);
  const futureDeadline = fixture([(_request, advance) => { advance(180001); return { status: 503, headers: {} }; }], { deadline: 360000 });
  await assert.rejects(futureDeadline.upload(), error => error.deliveryUncertain === true);
  assert.equal(futureDeadline.calls.length, 1, 'A caller cannot extend the hard three-minute recovery budget');
});

test('invalid resumable ranges and stalled transient failures are bounded and expose no session secrets', async () => {
  for (const range of ['bytes=1-2', 'bytes=0-99', 'bytes=0-secret', 'https://private-session']) {
    const f = fixture([{ status: 308, headers: { range } }]);
    await assert.rejects(f.upload(), error => error.deliveryUncertain === true && !error.message.includes('private-session'));
    assert.equal(f.calls.length, 1);
  }
  const stalled = fixture(Array.from({ length: 5 }, () => ({ status: 503, headers: {} })));
  await assert.rejects(stalled.upload(), error => error.deliveryUncertain === true);
  assert.equal(stalled.calls.length, 4);
});

test('authorization denial is not retried and untrusted session URLs never receive credentials', async () => {
  const denied = Object.assign(Error('Denied'), { status: 401, reconnectRequired: true });
  const f = fixture([() => { throw denied; }]);
  await assert.rejects(f.upload(), error => error === denied);
  assert.equal(f.calls.length, 1);
  for (const url of ['http://www.googleapis.com/upload/youtube/v3/videos', 'https://evil.example/upload/youtube/v3/videos',
    'https://www.googleapis.com:444/upload/youtube/v3/videos', 'https://www.googleapis.com/upload/youtube/v3/videos/other']) {
    const unsafe = fixture([], { url });
    await assert.rejects(unsafe.upload(), /invalid upload session/);
    assert.equal(unsafe.calls.length, 0);
  }
});

test('terminal recovery probe errors preserve ambiguous delivery and never authorize a new video upload', async () => {
  for (const status of [401, 404]) {
    const terminal = Object.assign(Error('private-token recovery detail'), { status, ...(status === 401 ? { reconnectRequired: true } : {}) });
    const f = fixture([() => { throw Object.assign(Error('Lost final acknowledgement'), { deliveryUncertain: true }); }, () => { throw terminal; }]);
    await assert.rejects(f.upload(), error => error.deliveryUncertain === true && error.status === status
      && (status !== 401 || error.reconnectRequired === true) && !error.message.includes('private-token'));
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].body.length, 0);
    assert.ok(f.calls.every(call => call.method === 'PUT' && call.url === URL));
  }
  const allBytes = fixture([{ status: 308, headers: { range: 'bytes=0-4' } },
    () => { throw Object.assign(Error('private recovery denial'), { status: 403, reconnectRequired: true }); }]);
  await assert.rejects(allBytes.upload(), error => error.deliveryUncertain === true && error.reconnectRequired === true && error.status === 403);
  assert.equal(allBytes.calls.length, 2);
  assert.equal(allBytes.calls[1].headers['Content-Range'], 'bytes */5');
});
