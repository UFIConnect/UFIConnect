import { getPipTone } from './pip-tones.mjs';

// Browser speech recognition owns microphone permission and releases it on abort.
// Recognition is paused while the assistant speaks, preventing feedback loops.
export function createOfficeVoice({ environment = globalThis, onState = () => {}, onError = () => {}, onTranscript, tone = 'friendly', getTone }) {
  const Recognition = environment.SpeechRecognition || environment.webkitSpeechRecognition;
  const synthesis = environment.speechSynthesis;
  let active = false, conversation = false, recognition = null, timer = null, restartTimer = null, sequence = 0, initialDeadline = null;
  const now = () => environment.Date?.now() ?? Date.now();
  const clearTimers = () => { environment.clearTimeout(timer); environment.clearTimeout(restartTimer); timer = null; restartTimer = null; };
  function releaseRecognition() {
    const previous = recognition; recognition = null;
    if (previous) { previous.onend = previous.onresult = previous.onerror = previous.onstart = previous.onspeechstart = null; try { previous.abort(); } catch {} }
  }
  function stop() {
    active = false; conversation = false; initialDeadline = null; sequence++; clearTimers(); releaseRecognition(); synthesis?.cancel(); onState({ phase: 'idle', text: '' });
  }
  function fail(message) { stop(); onError(message); }
  function listen(current) {
    if (!active || current !== sequence) return;
    clearTimers(); releaseRecognition();
    let finalText = '', speechHeard = false;
    const listener = new Recognition(); recognition = listener;
    listener.lang = environment.navigator?.language || 'en-US'; listener.interimResults = true; listener.continuous = false; listener.maxAlternatives = 1;
    listener.onstart = () => {
      if (!active || current !== sequence) return releaseRecognition();
      environment.clearTimeout(timer);
      onState({ phase: 'listening', text: '', initial: !conversation });
      if (!conversation) {
        initialDeadline ??= now() + 5000;
        timer = environment.setTimeout(() => { if (!speechHeard) stop(); }, Math.max(0, initialDeadline - now()));
      }
    };
    listener.onspeechstart = () => {
      speechHeard = true; environment.clearTimeout(timer);
      // A single utterance has a bounded microphone window even when recognition stalls.
      timer = environment.setTimeout(() => { try { listener.stop(); } catch { stop(); } }, 30000);
    };
    listener.onresult = event => {
      if (!active || current !== sequence) return;
      let interim = ''; finalText = '';
      for (let index = 0; index < event.results.length; index++) {
        const words = event.results[index][0]?.transcript || '';
        if (event.results[index].isFinal) finalText += `${words} `; else interim += words;
      }
      if (finalText.trim() || interim.trim()) { speechHeard = true; environment.clearTimeout(timer); timer = environment.setTimeout(() => { try { listener.stop(); } catch { stop(); } }, 30000); }
      onState({ phase: 'listening', text: `${finalText}${interim}`.trim(), initial: !conversation });
    };
    listener.onerror = event => {
      if (!active || current !== sequence || event.error === 'aborted') return;
      if (event.error === 'no-speech') return;
      fail(event.error === 'not-allowed' || event.error === 'service-not-allowed' ? 'Microphone access was denied. Allow microphone access in your browser, then start voice again.'
        : event.error === 'audio-capture' ? 'No microphone is available. Connect a microphone and start voice again.'
          : 'Voice recognition is unavailable. Check your connection, or type your message.');
    };
    listener.onend = async () => {
      if (!active || current !== sequence) return;
      recognition = null; clearTimers();
      const words = finalText.trim();
      if (!words) {
        if (speechHeard) return fail('I could not make out the complete message. Start voice again, or type your request.');
        if (!conversation && initialDeadline !== null && now() >= initialDeadline) return stop();
        restartTimer = environment.setTimeout(() => listen(current), 300); return;
      }
      if (/^(?:stop|stop listening|end (?:voice|conversation)|goodbye|bye)[.!?]*$/i.test(words)) return stop();
      conversation = true; onState({ phase: 'working', text: words });
      try {
        const reply = await onTranscript(words);
        if (!active || current !== sequence) return;
        if (typeof reply === 'string' && reply.trim()) speak(reply, current); else listen(current);
      } catch (cause) { if (active && current === sequence) fail(cause?.message || 'The voice request could not be completed. Your message is available to retry.'); }
    };
    timer = environment.setTimeout(() => { if (active && current === sequence) fail('Microphone permission is still pending. Allow access in your browser, then press Start voice.'); }, 20000);
    try { listener.start(); } catch { fail('Voice could not start. Press Start voice to try again.'); }
  }
  function speak(text, current) {
    if (!active || current !== sequence) return;
    releaseRecognition(); clearTimers();
    if (!synthesis || !environment.SpeechSynthesisUtterance) return listen(current);
    const chunks = String(text).replace(/```[\s\S]*?```/g, ' Code is available in the task result. ').replace(/https?:\/\/\S+/g, ' linked source ').match(/[\s\S]{1,900}(?:\s|$)|[\s\S]{1,900}/g) || [];
    let index = 0;
    const next = () => {
      if (!active || current !== sequence) return;
      if (index >= chunks.length) return listen(current);
      const utterance = new environment.SpeechSynthesisUtterance(chunks[index++]);
      utterance.lang = environment.navigator?.language || 'en-US';
      const profile = getPipTone(getTone ? getTone() : tone).speech;
      utterance.rate = profile.rate; utterance.pitch = profile.pitch;
      utterance.onstart = () => { if (!active || current !== sequence) return; environment.clearTimeout(timer); onState({ phase: 'speaking', text: '' }); };
      utterance.onend = next;
      utterance.onerror = event => { if (active && current === sequence && event.error !== 'canceled' && event.error !== 'interrupted') fail('Your browser could not play the spoken update. Press Start voice to continue.'); };
      timer = environment.setTimeout(() => { if (active && current === sequence) fail('Your browser needs a tap before playing audio. Press Start voice to hear the update.'); }, 5000);
      synthesis.speak(utterance);
    };
    synthesis.cancel(); next();
  }
  function start(greeting = '') {
    stop(); onError('');
    if (!Recognition) { onError('This browser does not support voice recognition. Use a supported Chrome, Edge, or Safari browser, or type your message.'); return false; }
    active = true; const current = sequence;
    onState({ phase: greeting ? 'speaking' : 'starting', text: '', initial: true });
    if (greeting) speak(greeting, current); else listen(current);
    return true;
  }
  return { start, stop, supported: !!Recognition, get active() { return active; } };
}
