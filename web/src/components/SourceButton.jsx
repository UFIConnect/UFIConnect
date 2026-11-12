import { Check, Lock } from 'lucide-react';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { SOURCE_META } from './sourceMeta';
import './source-button.css';

export default function SourceButton({
  source, label, selected, connected = false, locked = false, reason,
  disabled = false, onClick, className = '', labelClassName = '', showMark = true, statusClassName = '', children, ...props
}) {
  const meta = SOURCE_META[source] || {};
  const name = label || meta.label || source;
  const status = locked ? `Locked. ${reason || 'Connect this source to use it.'}` : connected ? 'Connected' : '';
  return <button {...props} type="button"
    className={`source-button${selected ? ' is-selected' : ''}${connected ? ' is-connected' : ''}${locked ? ' is-locked' : ''} ${className}`.trim()}
    disabled={disabled || locked} aria-pressed={props.role === 'switch' ? undefined : selected}
    aria-label={props['aria-label'] || `${name}${status ? `: ${status}` : ''}`}
    title={locked ? status : reason || status || name} onClick={locked || disabled ? undefined : onClick}>
    {showMark && <span className="source-button-mark" aria-hidden="true" style={{ color: meta.color || 'var(--primary)' }}>
      {hasBrandIcon(source) ? <BrandIcon platform={source} size={18} /> : <span>{meta.icon || name?.slice(0, 3)}</span>}
    </span>}
    <span className={`source-button-label ${labelClassName}`.trim()}>{name}</span>
    {locked ? <Lock className={`source-button-status ${statusClassName}`.trim()} size={14} aria-hidden="true" />
      : connected ? <Check className="source-button-status" size={14} aria-hidden="true" /> : null}
    {children}
  </button>;
}
