import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficeVoice } from './office-voice.mjs';

function fixture() {
  let time = 0, sequence = 0;
  const timers = new Map(), listeners = [], spoken = [], states = [], errors = [], received = [];
  const environment = {
    Date: { now: () => time }, navigator: { language: 'en-US' },
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    SpeechRecognition: class { constructor() { listeners.push(this); } start() {} abort() { this.aborted = true; } stop() { this.onend?.(); } },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { cancel() {}, speak(value) { spoken.push(value); } },
  };
  const voice = createOfficeVoice({ environment, onState: state => states.push(state), onError: error => errors.push(error), onTranscript: async text => { received.push(text); return 'Completed your request.'; } });
  function advance(ms) {
    const until = time + ms;
    while (true) { const next = [...timers].filter(([,value]) => value.at <= until).sort((a,b) => a[1].at - b[1].at)[0]; if (!next) break; time = next[1].at; timers.delete(next[0]); next[1].fn(); }
    time = until;
  }
  return { voice, environment, listeners, spoken, states, errors, received, advance, timers };
}

test('welcome speaks before microphone starts, then closes after five seconds of silence', () => {
  const f = fixture(); f.voice.start('Office updates. Do you need anything?');
  assert.equal(f.listeners.length, 0); f.spoken[0].onstart(); f.spoken[0].onend();
  assert.equal(f.listeners.length, 1); f.advance(4000); assert.equal(f.voice.active, true);
  f.listeners[0].onstart(); f.advance(4999); assert.equal(f.voice.active, true);
  f.advance(1); assert.equal(f.voice.active, false); assert.equal(f.listeners[0].aborted, true); assert.equal(f.received.length, 0);
});

test('native recognition ending early preserves the cumulative five-second reply window', () => {
  const f = fixture(); f.voice.start(); f.listeners[0].onstart(); f.advance(1000); f.listeners[0].onend();
  assert.equal(f.voice.active, true); f.advance(300); f.listeners[1].onstart(); f.advance(3699); assert.equal(f.voice.active, true);
  f.advance(1); assert.equal(f.voice.active, false);
});

test('speech beginning within five seconds can finish later and continues the conversation', async () => {
  const f = fixture(); f.voice.start(); const listener = f.listeners[0]; listener.onstart(); f.advance(4500); listener.onspeechstart(); f.advance(3000);
  assert.equal(f.voice.active, true);
  listener.onresult({ results: [{ isFinal: true, 0: { transcript: 'Show me the latest task results' } }] });
  await listener.onend(); assert.deepEqual(f.received, ['Show me the latest task results']);
  assert.equal(f.listeners.length, 1, 'recognition stays paused while speaking');
  f.spoken[0].onstart(); f.spoken[0].onend(); f.listeners[1].onstart(); f.advance(10000);
  assert.equal(f.voice.active, true, 'follow-up listening remains open'); f.voice.stop(); assert.equal(f.timers.size, 0);
});

test('permission denial and blocked autoplay stop without dispatching work', () => {
  const f = fixture(); f.voice.start(); f.listeners[0].onerror({ error: 'not-allowed' });
  assert.equal(f.voice.active, false); assert.match(f.errors.at(-1), /denied/); assert.equal(f.received.length, 0);
  f.voice.start('Welcome'); f.advance(5000); assert.equal(f.voice.active, false); assert.match(f.errors.at(-1), /tap/);
});

test('recognition waiting for a permission result has a watchdog', () => {
  const f = fixture(); f.voice.start(); f.advance(20000); assert.equal(f.voice.active, false); assert.match(f.errors.at(-1), /permission/);
});

test('stop cancels stale speech callbacks and spoken stop never starts work', async () => {
  const f = fixture(); f.voice.start('Welcome'); const utterance = f.spoken[0]; f.voice.stop(); utterance.onend(); assert.equal(f.listeners.length, 0);
  f.voice.start(); const listener = f.listeners[0]; listener.onstart(); listener.onresult({ results: [{ isFinal:true, 0:{ transcript:'Stop listening' } }] }); await listener.onend();
  assert.equal(f.voice.active, false); assert.equal(f.received.length, 0);
});
