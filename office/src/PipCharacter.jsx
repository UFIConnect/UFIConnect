import { useEffect, useId, useRef, useState } from 'react';
import { getPipTone } from './pip-tones.mjs';
import './PipCharacter.css';

const STATES = new Set(['idle', 'listening', 'thinking', 'speaking', 'happy']);

export default function PipCharacter({ state, speech, tone: toneId, size = 80, label = 'Pip, your little Office companion', decorative = false, className = '' }) {
  const id = useId().replace(/:/g, '');
  const avatar = useRef(null), [reducedMotion, setReducedMotion] = useState(false);
  const activity = speech && typeof speech === 'object' ? speech : state && typeof state === 'object' ? state : null;
  const requested = typeof state === 'string' ? state : activity?.phase || 'idle';
  const phase = STATES.has(requested) ? requested : requested === 'working' ? 'thinking' : requested === 'starting' ? 'listening' : 'idle';
  const tone = getPipTone(toneId ?? activity?.tone), word = typeof activity?.word === 'string' ? activity.word : '';
  const gestureSpeed = { friendly: 1, calm: .82, playful: 1.16, professional: .94 }[tone.id];
  useEffect(() => {
    const preference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!preference) return;
    const update = () => setReducedMotion(preference.matches);
    update(); preference.addEventListener?.('change', update);
    return () => preference.removeEventListener?.('change', update);
  }, []);
  useEffect(() => {
    const element = avatar.current;
    if (!element) return;
    let frame;
    const close = () => { element.style.setProperty('--pip-mouth-open', '0'); element.style.setProperty('--pip-mouth-width', '1'); element.dataset.mouthActive = 'false'; };
    close();
    // A word boundary drives one short articulation. The runtime supplies estimated
    // words on voices without boundaries; silence never starts a mouth loop.
    if (phase !== 'speaking' || !word.trim() || reducedMotion || !globalThis.requestAnimationFrame) return close;
    const letters = word.toLowerCase().replace(/[^a-z\u00c0-\u024f]/g, '');
    const duration = Math.min(280, Math.max(140, (letters.length * 20 + 85) / tone.speech.rate));
    const syllables = Math.min(3, Math.max(1, (letters.match(/[aeiouy]+/g) || []).length));
    let started;
    const articulate = timestamp => {
      started ??= timestamp;
      const progress = (timestamp - started) / duration;
      if (progress >= 1) { close(); return; }
      const letter = letters[Math.min(letters.length - 1, Math.floor(progress * letters.length))] || '';
      const envelope = Math.min(1, progress * 7, (1 - progress) * 5);
      const pulse = .45 + .55 * Math.abs(Math.sin(progress * Math.PI * syllables));
      const shape = /[mbp]/.test(letter) ? .22 : /[aeiouy]/.test(letter) ? 1 : .66;
      const opening = envelope * pulse * shape;
      element.style.setProperty('--pip-mouth-open', opening.toFixed(3));
      element.style.setProperty('--pip-mouth-width', /[ouw]/.test(letter) ? '.78' : /[eiy]/.test(letter) ? '1.2' : '1');
      element.dataset.mouthActive = opening > .06 ? 'true' : 'false';
      frame = globalThis.requestAnimationFrame(articulate);
    };
    frame = globalThis.requestAnimationFrame(articulate);
    return () => { globalThis.cancelAnimationFrame?.(frame); close(); };
  }, [phase, word, activity?.charIndex, activity?.speechTiming, tone.id, tone.speech.rate, reducedMotion]);
  return <svg ref={avatar} className={`pip-character ${className}`} width={size} height={size} viewBox="0 0 120 120"
    role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined} data-state={phase} data-tone={tone.id}
    style={{ '--pip-gesture-duration': `${(8 / gestureSpeed).toFixed(2)}s`, '--pip-bob-duration': `${(4.5 / gestureSpeed).toFixed(2)}s`, '--pip-attention-duration': `${(2.8 / gestureSpeed).toFixed(2)}s` }} focusable="false">
    <defs>
      <linearGradient id={`${id}-body`} x1="28" y1="33" x2="94" y2="100" gradientUnits="userSpaceOnUse"><stop stopColor="#E5DDFF" /><stop offset=".58" stopColor="#C5B8F4" /><stop offset="1" stopColor="#B1DED7" /></linearGradient>
      <linearGradient id={`${id}-mint`} x1="40" y1="12" x2="75" y2="41" gradientUnits="userSpaceOnUse"><stop stopColor="#E1FFF0" /><stop offset="1" stopColor="#8EDAC8" /></linearGradient>
      <radialGradient id={`${id}-face`} cx=".35" cy=".25" r=".9"><stop stopColor="#FFFFFF" /><stop offset="1" stopColor="#F2F5FF" /></radialGradient>
    </defs>
    <ellipse className="pip-character-shadow" cx="60" cy="108" rx="29" ry="5" fill="#9385C7" opacity=".18" />
    <g className="pip-character-float">
      <g className="pip-character-antenna"><path d="M60 34V24" stroke="#AB9FD8" strokeWidth="5" strokeLinecap="round" /><circle cx="60" cy="18" r="8" fill={`url(#${id}-mint)`} stroke="#9DCBC6" strokeWidth="1.5" /><ellipse cx="57.5" cy="15.5" rx="2.5" ry="1.8" fill="#FFF" opacity=".9" /></g>
      <g className="pip-character-arm-left"><path d="M29 72Q15 73 19 61" fill="none" stroke="#B7DDD8" strokeWidth="11" strokeLinecap="round" /><circle cx="20" cy="60" r="6.5" fill="#C5F2DF" /></g>
      <g className="pip-character-arm-right"><path d="M91 73Q109 67 103 54" fill="none" stroke="#B7DDD8" strokeWidth="11" strokeLinecap="round" /><circle cx="103" cy="53" r="7" fill="#C5F2DF" /><path d="M103 48V43M108 50L112 47" stroke="#C5F2DF" strokeWidth="4" strokeLinecap="round" /></g>
      <ellipse cx="44" cy="99" rx="11" ry="7" fill="#B9E4D9" /><ellipse cx="76" cy="99" rx="11" ry="7" fill="#B9E4D9" />
      <path d="M29 58C29 39 39 29 60 29S91 39 91 58V73C91 92 81 100 60 100S29 92 29 73Z" fill={`url(#${id}-body)`} stroke="#ABA1D0" strokeWidth="1.8" />
      <path d="M38 40C43 34 50 33 59 33" fill="none" stroke="#FFF" strokeWidth="3" strokeLinecap="round" opacity=".6" />
      <rect x="35" y="45" width="50" height="32" rx="15" fill={`url(#${id}-face)`} stroke="#C6BEE6" strokeWidth="1.3" />
      <g className="pip-character-gaze"><g className="pip-character-eyes" fill="#39415F"><ellipse cx="48.5" cy="59" rx="4" ry="4.7" /><ellipse cx="71.5" cy="59" rx="4" ry="4.7" /><circle cx="47.4" cy="57.6" r="1.1" fill="white" /><circle cx="70.4" cy="57.6" r="1.1" fill="white" /></g></g>
      <ellipse cx="41.5" cy="67" rx="4" ry="2.1" fill="#F0B8C9" opacity=".68" /><ellipse cx="78.5" cy="67" rx="4" ry="2.1" fill="#F0B8C9" opacity=".68" />
      <path className="pip-character-smile" d="M55 68.5Q60 73 65 68.5" fill="none" stroke="#59607D" strokeWidth="2.3" strokeLinecap="round" />
      <ellipse className="pip-character-talk" cx="60" cy="69" rx="3.7" ry="4.3" fill="#66617F" />
      <path d="M60 85C54 79 49 85 60 92C71 85 66 79 60 85Z" fill="#F7F4FF" opacity=".85" />
      <g className="pip-character-thoughts" fill="#C5F2DF"><circle cx="97" cy="27" r="3.1" /><circle cx="104" cy="20" r="2.3" /><circle cx="108" cy="11" r="1.6" /></g>
      <g className="pip-character-sparkle" fill="none" stroke="#D4C7FF" strokeWidth="2.3" strokeLinecap="round"><path d="M15 32V40M11 36H19" /><path d="M101 91V97M98 94H104" /></g>
    </g>
  </svg>;
}
