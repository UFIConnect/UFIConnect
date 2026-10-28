import { useEffect, useRef, useState } from 'react';
import { cameraVoiceCommand } from '../components/snapCameraCommands.mjs';

export function useCameraVoiceCommands(onCommand, accountId) {
  const recognition = useRef(null), generation = useRef(0), mounted = useRef(true), callback = useRef(onCommand);
  callback.current = onCommand;
  const [listening, setListening] = useState(false), [starting, setStarting] = useState(false), [message, setMessage] = useState('');
  const Speech = typeof window === 'undefined' ? null : window.SpeechRecognition || window.webkitSpeechRecognition;
  function stop() {
    generation.current++;
    const current = recognition.current; recognition.current = null;
    if (current) { current.onstart = current.onresult = current.onend = current.onerror = null; try { current.abort(); } catch { /* Already stopped. */ } }
    if (mounted.current) { setListening(false); setStarting(false); setMessage(''); }
  }
  function start() {
    if (!Speech || recognition.current || document.hidden) return;
    const id = ++generation.current;
    try {
      const current = new Speech(), seen = new Set();
      recognition.current = current;
      current.lang = 'en-US'; current.continuous = true; current.interimResults = false; current.maxAlternatives = 1;
      const valid = () => mounted.current && generation.current === id && recognition.current === current && !document.hidden;
      current.onstart = () => { if (valid()) { setStarting(false); setListening(true); setMessage('Listening for camera commands.'); } };
      current.onresult = event => {
        if (!valid()) return;
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index];
          if (!result.isFinal || seen.has(index)) continue;
          seen.add(index);
          const command = cameraVoiceCommand(result[0]?.transcript);
          if (command === 'stopListening') { stop(); setMessage('Voice commands stopped.'); return; }
          if (command) { setMessage('Listening for camera commands.'); callback.current(command); }
          else setMessage('Command not recognized. Open Commands to see the phrases.');
          // A recognition event performs at most one action.
          return;
        }
      };
      current.onerror = event => {
        if (!valid()) return;
        stop();
        setMessage(['not-allowed', 'service-not-allowed'].includes(event.error) ? 'Microphone access was not granted. Use the buttons or enable microphone access in your browser.'
          : event.error === 'network' ? 'Voice recognition could not connect. Use the buttons or try again.'
          : event.error === 'audio-capture' ? 'The microphone is unavailable. Use the buttons or try again.'
          : 'Voice commands stopped. Tap Voice commands to try again.');
      };
      current.onend = () => { if (valid()) { stop(); setMessage('Voice commands stopped. Tap Voice commands to listen again.'); } };
      setStarting(true); setMessage('Starting voice commands…'); current.start();
    } catch { stop(); setMessage('Voice commands are unavailable here. You can use the on-screen buttons.'); }
  }
  useEffect(() => {
    mounted.current = true;
    stop(); setMessage('');
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { mounted.current = false; stop(); document.removeEventListener('visibilitychange', hidden); };
  }, [accountId]);
  return { supported: Boolean(Speech), listening, starting, message, start, stop };
}
