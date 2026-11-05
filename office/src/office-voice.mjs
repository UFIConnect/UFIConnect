import { getPipTone } from './pip-tones.mjs';

// Recognition stays paused during playback so the agent cannot transcribe itself.
// Every browser callback belongs to one recognition/playback instance and session.
export function createOfficeVoice({ environment = globalThis, tone = 'friendly', getTone, requestTimeoutMs = 610000, onState = () => {}, onError = () => {}, onTranscript }) {
  const Recognition = environment.SpeechRecognition || environment.webkitSpeechRecognition;
  const synthesis = environment.speechSynthesis;
  let active = false, muted = false, generation = 0, recognition = null, utterance = null, request = null;
  let activity = 'idle', state = { phase: 'idle', text: '' };
  const timers = new Set();
  const selectedTone = () => { const value = getTone ? getTone() : tone; return getPipTone(typeof value === 'string' ? value : value?.id); };
  const valid = current => active && generation === current;
  const emit = value => {
    state = { text: '', word: '', charIndex: 0, speechProgress: 0, ...value, tone: selectedTone().id, micMuted: muted };
    onState(state);
  };
  const schedule = (callback, delay) => {
    const id = environment.setTimeout(() => { timers.delete(id); callback(); }, delay);
    timers.add(id); return id;
  };
  const clearTimer = id => { if (id !== undefined) { environment.clearTimeout(id); timers.delete(id); } };
  const clearTimers = () => { timers.forEach(id => environment.clearTimeout(id)); timers.clear(); };
  function releaseRecognition() {
    const previous = recognition; recognition = null;
    if (!previous) return;
    previous.onend = previous.onresult = previous.onerror = previous.onstart = previous.onspeechstart = null;
    try { previous.abort(); } catch { /* A completed recognizer may already be released. */ }
  }
  function releaseSpeech() {
    const previous = utterance; utterance = null;
    if (previous) previous.onstart = previous.onend = previous.onerror = previous.onboundary = null;
    try { synthesis?.cancel(); } catch { /* Some embedded browsers have no audio output. */ }
  }
  function cancelWork() { request?.abort(); request = null; }
  function stop() {
    active = false; generation++; activity = 'idle'; muted = false;
    clearTimers(); releaseRecognition(); releaseSpeech(); cancelWork(); emit({ phase: 'idle' });
  }
  function fail(message) { stop(); onError(message); }
  function listen(current) {
    if (!valid(current)) return;
    clearTimers(); releaseRecognition();
    if (muted) { activity = 'muted'; emit({ phase: 'muted' }); return; }
    activity = 'listening'; emit({ phase: 'starting' });
    let listener;
    try { listener = new Recognition(); } catch { fail('Voice recognition could not start. Start voice again or type your message.'); return; }
    recognition = listener;
    let finalText = '', speechHeard = false, speechTimer, startTimer, endTimer, ending = false;
    const currentListener = () => valid(current) && recognition === listener && !muted;
    const finishListening = () => {
      if (!currentListener() || ending) return;
      ending = true;
      // Install before stop because browsers (and tests) can dispatch onend synchronously.
      endTimer = schedule(() => { if (currentListener()) listener.onend?.(); }, 1800);
      try { listener.stop(); } catch { listener.onend?.(); }
    };
    const boundSpeech = () => {
      speechHeard = true;
      if (speechTimer === undefined) speechTimer = schedule(finishListening, 45000);
    };
    listener.lang = environment.navigator?.language || 'en-US';
    listener.interimResults = true; listener.continuous = false; listener.maxAlternatives = 1;
    listener.onstart = () => {
      if (!currentListener()) return;
      clearTimer(startTimer); emit({ phase: 'listening' });
      // Keep the live session open through silence, renewing bounded browser leases.
      schedule(finishListening, 60000);
    };
    listener.onspeechstart = () => { if (currentListener()) boundSpeech(); };
    listener.onresult = event => {
      if (!currentListener()) return;
      let interim = ''; finalText = '';
      for (let index = 0; index < event.results.length; index++) {
        const words = event.results[index][0]?.transcript || '';
        if (event.results[index].isFinal) finalText += `${words} `; else interim += `${words} `;
      }
      if (finalText.trim() || interim.trim()) boundSpeech();
      emit({ phase: 'listening', text: `${finalText}${interim}`.trim() });
      if (finalText.trim() && !interim.trim()) finishListening();
    };
    listener.onerror = event => {
      if (!currentListener() || event.error === 'aborted') return;
      if (event.error === 'no-speech') {
        releaseRecognition(); clearTimers(); schedule(() => listen(current), 350); return;
      }
      fail(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone access was denied. Allow microphone access in your browser, then start voice again.'
        : event.error === 'audio-capture' ? 'No microphone is available. Connect a microphone and start voice again.'
          : 'Voice recognition is unavailable. Check your connection, or type your message.');
    };
    listener.onend = async () => {
      if (!currentListener()) return;
      clearTimer(endTimer); releaseRecognition(); clearTimers();
      const words = finalText.trim();
      if (!words) {
        if (speechHeard) onError('I could not make out the complete message. Please say it again, or type your request.');
        schedule(() => listen(current), 350); return;
      }
      if (/^(?:stop|stop listening|end (?:voice|conversation)|goodbye|bye)[.!?]*$/i.test(words)) { stop(); return; }
      return submit(words, current);
    };
    startTimer = schedule(() => { if (currentListener()) fail('Microphone permission is still pending. Allow access in your browser, then press Start voice.'); }, 20000);
    try { listener.start(); } catch { fail('Voice could not start. Press Start voice to try again.'); }
  }
  async function submit(words, current) {
    if (!valid(current)) return;
    onError(''); activity = 'working'; emit({ phase: 'working', text: words });
    const Controller = environment.AbortController || globalThis.AbortController;
    const controller = new Controller(); request = controller;
    // Task receipts can take ten minutes; their HTTP requests have shorter
    // independent timeouts. Keep the outer live-turn lease just above that wait.
    schedule(() => { if (valid(current) && request === controller) fail('The voice request timed out. Start voice again to retry.'); }, requestTimeoutMs);
    try {
      const reply = await onTranscript(words, { signal: controller.signal, tone: selectedTone().id });
      if (!valid(current) || request !== controller) return;
      request = null; clearTimers();
      if (typeof reply === 'string' && reply.trim()) speak(reply, current); else listen(current);
    } catch (cause) {
      if (valid(current) && request === controller) fail(cause?.message || 'The voice request could not be completed. Start voice again to retry.');
    }
  }
  function speak(reply, current) {
    if (!valid(current)) return;
    releaseRecognition(); clearTimers();
    if (!synthesis || !environment.SpeechSynthesisUtterance) { fail('Spoken replies are unavailable in this browser. Use a browser with speech playback, or type your message.'); return; }
    activity = 'speaking';
    const text = String(reply).replace(/```[\s\S]*?```/g, ' Code is available in the conversation. ')
      .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, ' linked source ')
      .replace(/[*_`#]+/g, '').replace(/\s+/g, ' ').trim();
    const chunks = text.match(/[\s\S]{1,240}(?:\s|$)|[\s\S]{1,240}/g) || [];
    let index = 0, offset = 0;
    const next = () => {
      if (!valid(current)) return;
      clearTimers();
      if (index >= chunks.length) { utterance = null; listen(current); return; }
      const chunk = chunks[index++], chunkOffset = offset; offset += chunk.length;
      const selected = selectedTone(), speech = new environment.SpeechSynthesisUtterance(chunk); utterance = speech;
      const currentSpeech = () => valid(current) && utterance === speech;
      speech.lang = environment.navigator?.language || 'en-US'; speech.rate = selected.speech.rate; speech.pitch = selected.speech.pitch;
      const voices = synthesis.getVoices?.() || [];
      speech.voice = voices.find(voice => voice.lang === speech.lang && voice.default)
        || voices.find(voice => voice.lang === speech.lang)
        || voices.find(voice => voice.lang?.split('-')[0] === speech.lang.split('-')[0]) || null;
      let startup, estimatedTimer, boundarySeen = false;
      const wordAt = (position, timing) => {
        if (!currentSpeech()) return;
        const local = Math.max(0, Math.min(chunk.length, position));
        const word = chunk.slice(local).match(/^\S+/)?.[0] || '';
        emit({ phase: 'speaking', text, word, charIndex: chunkOffset + local,
          speechProgress: (chunkOffset + local) / Math.max(1, text.length), speechTiming: timing });
      };
      speech.onstart = () => {
        if (!currentSpeech()) return;
        clearTimer(startup);
        // Boundary timing is browser supplied. A bounded estimate is a fallback,
        // never represented as measured audio energy.
        const words = [...chunk.matchAll(/\S+/g)]; let wordIndex = 0;
        const estimatedWord = () => {
          if (!currentSpeech() || boundarySeen || wordIndex >= words.length) return;
          const word = words[wordIndex++]; wordAt(word.index, 'estimated');
          estimatedTimer = schedule(estimatedWord, Math.max(140, Math.min(650, word[0].length * 60 / speech.rate)));
        };
        estimatedWord();
        schedule(() => { if (currentSpeech()) fail('Speech playback stopped responding. Start voice again to continue.'); },
          Math.min(120000, Math.max(20000, chunk.length * 180 / speech.rate + 12000)));
      };
      speech.onboundary = event => {
        if (!currentSpeech() || (event.name && event.name !== 'word') || !Number.isFinite(event.charIndex)) return;
        boundarySeen = true; clearTimer(estimatedTimer); wordAt(event.charIndex, 'boundary');
      };
      speech.onend = () => { if (!currentSpeech()) return; speech.onstart = speech.onend = speech.onerror = speech.onboundary = null; next(); };
      speech.onerror = event => {
        if (!currentSpeech()) return;
        if (event.error === 'canceled' || event.error === 'interrupted') { utterance = null; listen(current); return; }
        fail('Your browser could not play the spoken reply. Start voice again to continue.');
      };
      startup = schedule(() => { if (currentSpeech()) fail('Your browser needs a tap before playing audio. Press Start voice to hear the update.'); }, 5000);
      try { synthesis.speak(speech); } catch { fail('Speech playback is unavailable. Start voice again, or type your message.'); }
    };
    releaseSpeech(); next();
  }
  function start(greeting = '') {
    stop(); onError('');
    if (!Recognition) { onError('This browser does not support voice recognition. Use a supported Chrome, Edge, or Safari browser, or type your message.'); return false; }
    if (!synthesis || !environment.SpeechSynthesisUtterance) { onError('Spoken replies are unavailable in this browser. Use a browser with speech playback, or type your message.'); return false; }
    active = true; const current = generation;
    if (greeting) { emit({ phase: 'starting' }); speak(greeting, current); } else listen(current);
    return true;
  }
  function interrupt() {
    if (!active) return false;
    generation++; clearTimers(); releaseRecognition(); releaseSpeech(); cancelWork(); listen(generation); return true;
  }
  async function ask(text) {
    const words = typeof text === 'string' ? text.trim().slice(0, 12000) : '';
    if (!active || !words) return false;
    generation++; clearTimers(); releaseRecognition(); releaseSpeech(); cancelWork();
    await submit(words, generation); return true;
  }
  function setMuted(value) {
    muted = !!value;
    if (!active) { emit({ phase: 'idle' }); return muted; }
    if (muted && activity === 'listening') { clearTimers(); releaseRecognition(); activity = 'muted'; emit({ phase: 'muted' }); }
    else if (!muted && activity === 'muted') listen(generation);
    else emit(state);
    return muted;
  }
  return { start, stop, interrupt, ask, setMuted, supported: !!Recognition && !!synthesis && !!environment.SpeechSynthesisUtterance,
    get active() { return active; }, get muted() { return muted; } };
}
