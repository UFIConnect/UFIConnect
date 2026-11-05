'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createStudioSpeech, DEFAULT_SPEECH_MODEL } = require('./office-ai-studio-speech');

const key = 'fixture-narration-key-never-print';
const format = { type: 'audio/pcm', rate: 24000 };
function fixture(script = () => {}) {
  const sockets = [];
  class Socket extends EventEmitter {
    constructor(url, options) {
      super(); this.url = url; this.options = options; this.sent = []; sockets.push(this);
      queueMicrotask(() => this.emit('open'));
    }
    send(raw, callback) {
      const event = JSON.parse(raw); this.sent.push(event); callback?.();
      queueMicrotask(() => {
        if (this.terminated) return;
        if (event.type === 'session.update') this.event({ type: 'session.updated', session: { audio: { output: { format } } } });
        else if (event.type === 'response.create') script(this, event);
      });
    }
    event(value) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
    close(code) { this.closed = code; }
    terminate() { this.terminated = true; }
  }
  const speech = createStudioSpeech({ env: { OPENAI_API_KEY: key }, WebSocketImpl: Socket });
  return { speech, sockets, Socket };
}
function begin(socket) { socket.event({ type: 'response.created', response: { id: 'resp_speech' } }); }
function audio(socket, bytes) { socket.event({ type: 'response.output_audio.delta', response_id: 'resp_speech', delta: bytes.toString('base64') }); }
function complete(socket, transcript = 'The little robot found a book.', status = 'completed') {
  socket.event({ type: 'response.done', response: { id: 'resp_speech', status,
    output: [{ type: 'message', content: [{ type: 'output_audio', transcript }] }] } });
}

test('narration returns verified PCM audio and uses one authenticated session without tools', async () => {
  const first = Buffer.from([1, 0, 2, 0]), second = Buffer.from([3, 0, 4, 0]);
  const { speech, sockets } = fixture(socket => { begin(socket); audio(socket, first); audio(socket, second); complete(socket); });
  const result = await speech.synthesize({ text: 'The little robot found a book.', instructions: 'Warm and curious.' });
  assert.deepEqual(result.buffer, Buffer.concat([first, second]));
  assert.deepEqual({ ...result, buffer: undefined }, { buffer: undefined, format: 'pcm', sampleRate: 24000, channels: 1, bitsPerSample: 16 });
  assert.equal(sockets.length, 1); const socket = sockets[0];
  assert.equal(new URL(socket.url).searchParams.get('model'), DEFAULT_SPEECH_MODEL);
  assert.ok(!socket.url.includes(key)); assert.equal(socket.options.headers.Authorization, 'Bearer ' + key);
  assert.equal(socket.options.perMessageDeflate, false); assert.equal(socket.closed, 1000);
  const [session, response] = socket.sent;
  assert.deepEqual(session.session.audio.output, { format, voice: 'marin' });
  assert.deepEqual(session.session.tools, []); assert.equal(session.session.tool_choice, 'none');
  assert.equal(session.session.audio.input.turn_detection, null);
  assert.equal(response.response.conversation, 'none'); assert.deepEqual(response.response.output_modalities, ['audio']);
  assert.deepEqual(response.response.tools, []); assert.equal(response.response.tool_choice, 'none');
  assert.deepEqual(JSON.parse(response.response.input[0].content[0].text), { narration: 'The little robot found a book.' });
  assert.match(response.response.instructions, /verbatim, exactly once/);
});

test('repeated session acknowledgments never create a second paid response', async () => {
  const { speech, sockets } = fixture(socket => {
    socket.event({ type: 'session.updated', session: { audio: { output: { format } } } });
    begin(socket); audio(socket, Buffer.alloc(8)); complete(socket);
  });
  await speech.synthesize({ text: 'The little robot found a book.' });
  assert.equal(sockets[0].sent.filter(event => event.type === 'response.create').length, 1);
});

test('incomplete audio and rewritten narration cannot be accepted as a finished scene', async () => {
  for (const [transcript, status] of [['The little robot found a book.', 'incomplete'], ['Sure, here is the narration. The little robot found a book.', 'completed']]) {
    const { speech, sockets } = fixture(socket => { begin(socket); audio(socket, Buffer.alloc(8)); complete(socket, transcript, status); });
    await assert.rejects(speech.synthesize({ text: 'The little robot found a book.' }), error => error.status === 502 && error.beforeDispatch === false);
    assert.equal(sockets.length, 1); assert.equal(sockets[0].terminated, true);
  }
});

test('provider errors and premature closure omit upstream credentials and never retry', async () => {
  for (const script of [
    socket => socket.event({ type: 'error', error: { message: 'private upstream ' + key } }),
    socket => { begin(socket); audio(socket, Buffer.alloc(8)); socket.emit('close', 1006, Buffer.from(key)); },
    socket => socket.emit('error', new Error('private transport ' + key)),
  ]) {
    const { speech, sockets } = fixture(script);
    await assert.rejects(speech.synthesize({ text: 'A tiny test.' }), error => error.status === 502 && !error.message.includes(key));
    assert.equal(sockets.length, 1); assert.equal(sockets[0].terminated, true);
  }
});

test('cancellation closes the session and a pre-aborted request opens no connection', async () => {
  const controller = new AbortController();
  const { speech, sockets } = fixture(() => controller.abort());
  await assert.rejects(speech.synthesize({ text: 'A tiny test.', signal: controller.signal }), error => error.status === 499);
  assert.equal(sockets[0].terminated, true);
  await assert.rejects(speech.synthesize({ text: 'A tiny test.', signal: controller.signal }), error => error.status === 499 && error.beforeDispatch);
  assert.equal(sockets.length, 1);
});

test('input, voice and model validation happens before any provider connection', async () => {
  const { speech, sockets, Socket } = fixture();
  for (const options of [{ text: '' }, { text: 'a'.repeat(4001) }, { text: 'A test.', voice: 'untrusted-voice' }, { text: 'A test.', instructions: 'a'.repeat(2001) }]) {
    await assert.rejects(speech.synthesize(options), error => error.status === 400 && error.beforeDispatch);
  }
  await assert.rejects(createStudioSpeech({ env: {}, WebSocketImpl: Socket }).synthesize({ text: 'A test.' }), error => error.status === 503 && error.beforeDispatch);
  await assert.rejects(createStudioSpeech({ env: { OPENAI_API_KEY: key, OFFICE_STUDIO_SPEECH_MODEL: 'https://attacker.invalid/' }, WebSocketImpl: Socket }).synthesize({ text: 'A test.' }), error => error.status === 503);
  assert.equal(sockets.length, 0);
});

test('malformed, unexpected and oversized audio streams fail within bounded memory', async () => {
  const oversized = Buffer.alloc(512 * 1024);
  for (const script of [
    socket => { begin(socket); socket.event({ type: 'response.output_audio.delta', response_id: 'resp_speech', delta: 'bad!data' }); },
    socket => { begin(socket); audio(socket, Buffer.from([1])); complete(socket, 'A test.'); },
    socket => { begin(socket); socket.event({ type: 'response.output_audio.delta', response_id: 'resp_different', delta: 'AAAA' }); },
    socket => { begin(socket); socket.event({ type: 'response.output_item.added', item: { type: 'function_call', name: 'never_execute' } }); },
    socket => { begin(socket); for (let index = 0; index < 17; index++) audio(socket, oversized); complete(socket, 'A test.'); },
  ]) {
    const { speech, sockets } = fixture(script);
    await assert.rejects(speech.synthesize({ text: 'A test.' }), error => error.status === 502);
    assert.equal(sockets.length, 1); assert.equal(sockets[0].terminated, true);
  }
});

test('a silent provider is closed after the ninety second deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  class SilentSocket extends EventEmitter { terminate() { this.terminated = true; } }
  const speech = createStudioSpeech({ env: { OPENAI_API_KEY: key }, WebSocketImpl: SilentSocket });
  const result = speech.synthesize({ text: 'A test.' });
  const rejection = assert.rejects(result, error => error.status === 502 && /too long/.test(error.message) && error.beforeDispatch);
  t.mock.timers.tick(90000); await rejection;
});
