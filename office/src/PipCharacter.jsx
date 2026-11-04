import { useId } from 'react';
import './PipCharacter.css';

const STATES = new Set(['idle', 'listening', 'thinking', 'speaking', 'happy']);

export default function PipCharacter({ state = 'idle', size = 80, label = 'Pip, your little Office companion', decorative = false, className = '' }) {
  const id = useId().replace(/:/g, '');
  const phase = STATES.has(state) ? state : state === 'working' ? 'thinking' : 'idle';
  return <svg className={`pip-character ${className}`} width={size} height={size} viewBox="0 0 120 120"
    role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : label} aria-hidden={decorative || undefined} data-state={phase} focusable="false">
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
      <g className="pip-character-eyes" fill="#39415F"><ellipse cx="48.5" cy="59" rx="4" ry="4.7" /><ellipse cx="71.5" cy="59" rx="4" ry="4.7" /><circle cx="47.4" cy="57.6" r="1.1" fill="white" /><circle cx="70.4" cy="57.6" r="1.1" fill="white" /></g>
      <ellipse cx="41.5" cy="67" rx="4" ry="2.1" fill="#F0B8C9" opacity=".68" /><ellipse cx="78.5" cy="67" rx="4" ry="2.1" fill="#F0B8C9" opacity=".68" />
      <path className="pip-character-smile" d="M55 68.5Q60 73 65 68.5" fill="none" stroke="#59607D" strokeWidth="2.3" strokeLinecap="round" />
      <ellipse className="pip-character-talk" cx="60" cy="69" rx="3.7" ry="4.3" fill="#66617F" />
      <path d="M60 85C54 79 49 85 60 92C71 85 66 79 60 85Z" fill="#F7F4FF" opacity=".85" />
      <g className="pip-character-thoughts" fill="#C5F2DF"><circle cx="97" cy="27" r="3.1" /><circle cx="104" cy="20" r="2.3" /><circle cx="108" cy="11" r="1.6" /></g>
      <g className="pip-character-sparkle" fill="none" stroke="#D4C7FF" strokeWidth="2.3" strokeLinecap="round"><path d="M15 32V40M11 36H19" /><path d="M101 91V97M98 94H104" /></g>
    </g>
  </svg>;
}
