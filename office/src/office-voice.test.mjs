import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfficeVoice } from './office-voice.mjs';

function fixture(options = {}) {
  let time = 0, sequence = 0, cancellations = 0;
  const timers = new Map(), listeners = [], spoken = [], states = [], errors = [], received = [], signals = [];
  const environment = {
    navigator: { language: 'en-US' }, AbortController,
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    SpeechRecognition: class {
      constructor() { listeners.push(this); this.stops = 0; }
      start() {}
      abort() { this.aborted = true; }
      stop() { this.stops++; this.onend?.(); }
    },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: { cancel() { cancellations++; }, getVoices() { return [{ name: 'English', lang: 'en-US', default: true }]; }, speak(value) { spoken.push(value); } },
  };
  const voice = createOfficeVoice({ environment, onState: state => states.push(state), onError: error => errors.push(error),
    onTranscript: async (text, { signal }) => { received.push(text); signals.push(signal); return 'Completed your request.'; }, ...options });
  function advance(ms) {
    const until = time + ms;
    while (true) {
      const next = [...timers].filter(([,value]) => value.at <= until).sort((a,b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = until;
  }
  const startListening = () => { assert.equal(voice.start(), true); listeners.at(-1).onstart(); return listeners.at(-1); };
  return { voice, environment, listeners, spoken, states, errors, received, signals, advance, timers, startListening,
    get cancellations() { return cancellations; } };
}
const result = (text, isFinal = true) => ({ results: [{ isFinal, 0: { transcript: text } }] });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

test('live listening stays open through initial silence and browser no-speech restarts', () => {
  const f = fixture(), listener = f.startListening();
  f.advance(15000); assert.equal(f.voice.active, true); assert.equal(f.received.length, 0);
  const staleEnd = listener.onend; listener.onerror({ error: 'no-speech' }); staleEnd();
  f.advance(349); assert.equal(f.listeners.length, 1);
  f.advance(1); assert.equal(f.listeners.length, 2); f.listeners[1].onstart();
  f.advance(10000); assert.equal(f.voice.active, true);
  f.voice.stop(); assert.equal(f.timers.size, 0);
});

test('welcome playback begins before recognition and returns to a continuous live session', () => {
  const f = fixture(); f.voice.start('Office updates. How can I help?');
  assert.equal(f.listeners.length, 0); assert.equal(f.states.at(-1).phase, 'starting');
  f.spoken[0].onstart(); assert.equal(f.states.at(-1).phase, 'speaking');
  f.spoken[0].onend(); assert.equal(f.listeners.length, 1); f.listeners[0].onstart();
  f.advance(10000); assert.equal(f.voice.active, true); f.voice.stop(); assert.equal(f.timers.size, 0);
});

test('a final transcript starts one request immediately, pauses recognition, speaks, and listens again', async () => {
  const f = fixture(), listener = f.startListening(), staleEnd = listener.onend;
  listener.onresult(result('Show me the latest task results')); staleEnd(); await settle();
  assert.deepEqual(f.received, ['Show me the latest task results']);
  assert.equal(listener.stops, 1); assert.equal(listener.aborted, true);
  assert.equal(f.listeners.length, 1, 'recognition is paused during inference and playback');
  assert.equal(f.spoken.length, 1); f.spoken[0].onstart(); f.spoken[0].onend();
  f.listeners[1].onstart(); assert.equal(f.states.at(-1).phase, 'listening');
  f.voice.stop(); assert.equal(f.timers.size, 0);
});

test('permission denial and blocked autoplay fail without dispatching work', () => {
  const f = fixture(); f.voice.start(); f.listeners[0].onerror({ error: 'not-allowed' });
  assert.equal(f.voice.active, false); assert.match(f.errors.at(-1), /denied/);
  f.voice.start('Welcome'); f.advance(5000);
  assert.equal(f.voice.active, false); assert.match(f.errors.at(-1), /tap/);
  assert.equal(f.received.length, 0); assert.equal(f.timers.size, 0);
});

test('pending microphone permission has a watchdog and stale permission callbacks cannot reactivate it', () => {
  const f = fixture(); f.voice.start(); const staleStart = f.listeners[0].onstart;
  f.advance(20000); assert.equal(f.voice.active, false); assert.match(f.errors.at(-1), /permission/);
  const count = f.states.length; staleStart(); assert.equal(f.states.length, count); assert.equal(f.timers.size, 0);
});

test('each listening lease is bounded while the live session can continue', () => {
  const f = fixture(), listener = f.startListening();
  f.advance(60000); assert.equal(listener.stops, 1); assert.equal(f.voice.active, true);
  f.advance(350); assert.equal(f.listeners.length, 2); f.listeners[1].onstart();
  f.voice.stop(); assert.equal(f.timers.size, 0);
});

test('interim updates cannot extend the 45-second speech lease and are never submitted as final', () => {
  const f = fixture(), listener = f.startListening();
  listener.onspeechstart();
  for (let index = 0; index < 4; index++) { f.advance(10000); listener.onresult(result('Still talking', false)); }
  f.advance(5000); assert.equal(listener.stops, 1); assert.equal(f.voice.active, true);
  assert.equal(f.received.length, 0); assert.match(f.errors.at(-1), /say it again/);
  f.advance(350); assert.equal(f.listeners.length, 2); f.voice.stop();
});

test('final speech is dispatched even if a browser omits the recognition end event after stop', async () => {
  const f = fixture(), listener = f.startListening();
  listener.stop = () => { listener.stops++; };
  listener.onresult(result('Please explain this idea')); f.advance(1799); assert.equal(f.received.length, 0);
  f.advance(1); await settle(); assert.deepEqual(f.received, ['Please explain this idea']);
  f.voice.stop(); assert.equal(f.timers.size, 0);
});

test('End voice aborts in-flight work and ignores its eventual response', async () => {
  let resolve, signal;
  const f = fixture({ onTranscript: (_text, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); } });
  f.startListening().onresult(result('Explain this report')); assert.equal(signal.aborted, false);
  f.voice.stop(); assert.equal(signal.aborted, true); resolve('A stale reply'); await settle();
  assert.equal(f.spoken.length, 0); assert.equal(f.states.at(-1).phase, 'idle'); assert.equal(f.timers.size, 0);
});

test('interrupt cancels the old request and starts a new listening turn without letting old callbacks mutate it', async () => {
  let resolve, signal;
  const f = fixture({ onTranscript: (_text, options) => { signal = options.signal; return new Promise(done => { resolve = done; }); } });
  const listener = f.startListening(), staleResult = listener.onresult;
  listener.onresult(result('The first question')); f.voice.interrupt();
  assert.equal(signal.aborted, true); assert.equal(f.voice.active, true); assert.equal(f.listeners.length, 2);
  const replacement = f.listeners[1]; replacement.onstart(); staleResult(result('Stale words'));
  resolve('Old answer'); await settle(); assert.equal(f.spoken.length, 0); assert.equal(f.states.at(-1).phase, 'listening');
  f.voice.stop(); assert.equal(f.timers.size, 0);
});

test('interrupt cancels spoken audio; saved speech callbacks never revive the previous session', () => {
  const f = fixture(); f.voice.start('A spoken answer');
  const speech = f.spoken[0], oldStart = speech.onstart, oldEnd = speech.onend, oldBoundary = speech.onboundary;
  speech.onstart(); const cancellations = f.cancellations; f.voice.interrupt();
  assert.ok(f.cancellations > cancellations); assert.equal(f.listeners.length, 1); f.listeners[0].onstart();
  const count = f.states.length; oldStart(); oldBoundary({ name: 'word', charIndex: 2 }); oldEnd();
  assert.equal(f.states.length, count); assert.equal(f.listeners.length, 1);
  f.voice.stop(); assert.equal(f.timers.size, 0);
});

test('mute releases recognition, keeps the call active, and unmute resumes it', () => {
  const f = fixture(), listener = f.startListening(); f.voice.setMuted(true);
  assert.equal(f.voice.muted, true); assert.equal(f.voice.active, true); assert.equal(listener.aborted, true);
  assert.equal(f.states.at(-1).phase, 'muted'); assert.equal(f.states.at(-1).micMuted, true);
  f.advance(120000); assert.equal(f.listeners.length, 1); assert.equal(f.timers.size, 0);
  f.voice.setMuted(false); assert.equal(f.listeners.length, 2); f.listeners[1].onstart();
  assert.equal(f.states.at(-1).phase, 'listening'); f.voice.stop();
});

test('microphone mute preserves an ongoing answer then stays muted after speech ends', () => {
  const f = fixture(); f.voice.start('A useful answer'); f.spoken[0].onstart();
  f.voice.setMuted(true); assert.equal(f.states.at(-1).phase, 'speaking'); assert.equal(f.voice.active, true);
  f.spoken[0].onend(); assert.equal(f.listeners.length, 0); assert.equal(f.states.at(-1).phase, 'muted');
  f.voice.setMuted(false); assert.equal(f.listeners.length, 1); f.voice.stop();
});

test('actual speech word boundaries override estimated animation and old chunks cannot emit more words', () => {
  const f = fixture(); f.voice.start('Hello there, friend.'); const speech = f.spoken[0];
  speech.onstart(); assert.equal(f.states.at(-1).word, 'Hello'); assert.equal(f.states.at(-1).speechTiming, 'estimated');
  speech.onboundary({ name: 'word', charIndex: 6 });
  assert.equal(f.states.at(-1).word, 'there,'); assert.equal(f.states.at(-1).charIndex, 6);
  assert.equal(f.states.at(-1).speechTiming, 'boundary'); assert.equal(f.states.at(-1).speechProgress, 6 / speech.text.length);
  const count = f.states.length; f.advance(1000); assert.equal(f.states.length, count, 'estimated words stop when real boundaries arrive');
  speech.onend(); assert.equal(f.states.at(-1).word, ''); f.voice.stop(); assert.equal(f.timers.size, 0);
});

test('long speech uses bounded chunks, global character offsets, current tone, and a matching browser voice', () => {
  let tone = 'calm';
  const f = fixture({ getTone: () => tone }), text = 'A clear update with useful details. '.repeat(12);
  f.voice.start(text); const first = f.spoken[0];
  assert.ok(first.text.length <= 241); assert.equal(first.rate, .9); assert.equal(first.pitch, .96); assert.equal(first.voice.lang, 'en-US');
  first.onstart(); tone = 'playful'; first.onend(); const second = f.spoken[1];
  assert.equal(second.rate, 1.04); assert.equal(second.pitch, 1.16); second.onstart(); second.onboundary({ name: 'word', charIndex: 0 });
  assert.equal(f.states.at(-1).charIndex, first.text.length); assert.equal(f.states.at(-1).tone, 'playful');
  f.voice.stop(); assert.equal(f.timers.size, 0);
});

test('voice preserves explicit tone options, canonical fallbacks, and inert preference changes', () => {
  const f = fixture({ tone: 'professional' }); assert.equal(f.spoken.length, 0); assert.equal(f.listeners.length, 0);
  f.voice.start('A direct answer'); assert.equal(f.spoken[0].rate, 1); assert.equal(f.spoken[0].pitch, 1); f.voice.stop();
  const unknown = fixture({ getTone: () => 'invalid' }); unknown.voice.start('A friendly answer');
  assert.equal(unknown.spoken[0].pitch, 1.08); unknown.voice.stop();
});

test('playback completion and inference watchdogs release resources instead of leaving a stuck call', () => {
  const f = fixture(); f.voice.start('Welcome'); f.spoken[0].onstart(); f.advance(20000);
  assert.equal(f.voice.active, false); assert.match(f.errors.at(-1), /playback stopped/); assert.equal(f.timers.size, 0);
  let signal;
  const waiting = fixture({ requestTimeoutMs: 1250, onTranscript: (_text, options) => { signal = options.signal; return new Promise(() => {}); } });
  waiting.startListening().onresult(result('Wait for this answer')); waiting.advance(1250);
  assert.equal(waiting.voice.active, false); assert.equal(signal.aborted, true); assert.match(waiting.errors.at(-1), /timed out/);
  assert.equal(waiting.timers.size, 0);
});

test('spoken stop ends the live session without starting work', () => {
  const f = fixture(); f.startListening().onresult(result('Stop listening'));
  assert.equal(f.voice.active, false); assert.equal(f.received.length, 0); assert.equal(f.timers.size, 0);
});

test('the default live-turn lease accommodates ten-minute task receipts', () => {
  const f = fixture({ onTranscript: () => new Promise(() => {}) });
  f.startListening().onresult(result('Complete the requested task'));
  f.advance(600000); assert.equal(f.voice.active, true);
  f.advance(10000); assert.equal(f.voice.active, false); assert.equal(f.timers.size, 0);
});

test('ask submits screen help exactly once and releases the active microphone before replying', async () => {
  const f = fixture(), listener = f.startListening(), staleResult = listener.onresult;
  const asking = f.voice.ask('  Help me with this screen.  '); staleResult(result('Old microphone words'));
  assert.equal(listener.aborted, true); await asking;
  assert.deepEqual(f.received, ['Help me with this screen.']); assert.equal(f.spoken.length, 1);
  f.spoken[0].onstart(); f.spoken[0].onend(); assert.equal(f.listeners.length, 2);
  f.voice.stop(); assert.equal(f.timers.size, 0);
});

test('ask cancels the old request, bounds the new prompt, and respects End voice cancellation', async () => {
  const calls = [];
  const f = fixture({ onTranscript: (text, { signal }) => new Promise(resolve => calls.push({ text, signal, resolve })) });
  f.startListening().onresult(result('The old request'));
  const asking = f.voice.ask('h'.repeat(13000));
  assert.equal(calls[0].signal.aborted, true); assert.equal(calls[1].text.length, 12000);
  calls[0].resolve('Old reply'); await settle(); assert.equal(f.spoken.length, 0);
  f.voice.stop(); assert.equal(calls[1].signal.aborted, true); calls[1].resolve('New reply'); await asking;
  assert.equal(f.spoken.length, 0); assert.equal(f.states.at(-1).phase, 'idle'); assert.equal(f.timers.size, 0);
});

test('ask leaves inactive sessions and empty prompts unchanged', async () => {
  const f = fixture(); assert.equal(await f.voice.ask('Help here'), false); assert.equal(f.listeners.length, 0);
  const listener = f.startListening(); assert.equal(await f.voice.ask('   '), false);
  assert.equal(listener.aborted, undefined); assert.equal(f.received.length, 0); f.voice.stop();
});

test('missing browser recognition or speech playback never reports an active live call', () => {
  const f = fixture(); delete f.environment.SpeechRecognition;
  const unsupported = createOfficeVoice({ environment: f.environment });
  assert.equal(unsupported.supported, false); assert.equal(unsupported.start(), false); assert.equal(unsupported.active, false);
  delete f.environment.SpeechSynthesisUtterance;
  const silent = createOfficeVoice({ environment: { ...f.environment, SpeechRecognition: class {} } });
  assert.equal(silent.supported, false); assert.equal(silent.start(), false); assert.equal(silent.active, false);
});
