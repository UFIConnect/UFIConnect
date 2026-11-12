import { useCallback, useEffect, useId, useRef, useState } from 'react';

const IDLE_INPUT = { throttle: false, brake: false };
const KEY_ACTIONS = { ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right', ArrowUp: 'throttle', w: 'throttle', ArrowDown: 'brake', s: 'brake' };
const ACTIONS = [
  { id: 'left', label: 'Turn left', icon: '←', text: 'Turn left' },
  { id: 'right', label: 'Turn right', icon: '→', text: 'Turn right' },
  { id: 'throttle', label: 'Accelerate', icon: '↑', text: 'Accelerate' },
  { id: 'brake', label: 'Brake / reverse', icon: '↓', text: 'Brake / reverse' },
];

export default function DriveControls({ disabled, resetKey, pendingTurn = 0, onInput, onTurn }) {
  const group = useRef(null), held = useRef(new Map()), pulses = useRef(new Map()), disabledRef = useRef(disabled);
  const focusWithin = useRef(false);
  const [input, setInput] = useState(IDLE_INPUT);
  const hintId = useId();
  disabledRef.current = disabled;
  const publish = useCallback(() => {
    const actions = new Set(held.current.values());
    const next = { throttle: actions.has('throttle'), brake: actions.has('brake') };
    setInput(previous => previous.throttle === next.throttle && previous.brake === next.brake ? previous : next);
    onInput(next);
  }, [onInput]);
  const activate = useCallback((token, action) => {
    if (held.current.has(token)) return;
    held.current.set(token, action);
    if (action === 'left' || action === 'right') onTurn(action === 'left' ? -1 : 1);
    publish();
  }, [onTurn, publish]);
  const clear = useCallback(() => {
    for (const timer of pulses.current.values()) window.clearTimeout(timer);
    pulses.current.clear(); held.current.clear(); publish();
  }, [publish]);
  function release(token) { if (held.current.delete(token)) publish(); }

  useEffect(() => {
    clear();
    // Keep a keyboard focus target when an accident disables the held button.
    if (disabled && focusWithin.current && (group.current?.contains(document.activeElement) || document.activeElement === document.body)) {
      group.current?.focus({ preventScroll: true });
    }
  }, [disabled, resetKey, clear]);
  useEffect(() => { group.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const keyDown = event => {
      if (disabledRef.current || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      const target = event.target;
      const map = group.current?.closest('.map-city-card');
      if (!map?.contains(target)) return;
      const ownButton = target.closest?.('[data-drive-action]');
      if (target.closest?.('input, select, textarea, a, [contenteditable="true"]') || (target.closest?.('button') && !ownButton)) return;
      const action = KEY_ACTIONS[event.key.length === 1 ? event.key.toLowerCase() : event.key]
        || (ownButton && [' ', 'Enter'].includes(event.key) ? ownButton.dataset.driveAction : null);
      if (!action) return;
      event.preventDefault();
      if (event.repeat) return;
      const token = 'key:' + event.code;
      activate(token, action);
    };
    const keyUp = event => { if (held.current.delete('key:' + event.code)) { event.preventDefault(); publish(); } };
    const visibility = () => { if (document.hidden) clear(); };
    const focusChange = event => {
      const target = event.target;
      const map = group.current?.closest('.map-city-card');
      if (!map?.contains(target) || target.closest?.('input, select, textarea, a, [contenteditable="true"]')
        || (target.closest?.('button') && !target.closest?.('[data-drive-action]'))) clear();
    };
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('focusin', focusChange);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('focusin', focusChange);
      clear();
    };
  }, [activate, clear, publish]);

  return <div ref={group} className="map-drive-steering" role="group" aria-label="Driving controls" aria-describedby={hintId} tabIndex={0}
    onFocusCapture={() => { focusWithin.current = true; }}
    onBlurCapture={event => {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      if (event.relatedTarget || !disabledRef.current) focusWithin.current = false;
      clear();
    }}>
    <div className="map-drive-steering-buttons">
      {ACTIONS.map(action => <button key={action.id} type="button" data-drive-action={action.id} aria-label={action.label} disabled={disabled}
        aria-pressed={action.id === 'left' ? pendingTurn < 0 : action.id === 'right' ? pendingTurn > 0 : input[action.id]}
        onPointerDown={event => {
          if (event.button !== 0 || disabledRef.current) return;
          event.preventDefault();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          activate('pointer:' + event.pointerId, action.id);
        }}
        onPointerUp={event => release('pointer:' + event.pointerId)}
        onPointerCancel={event => release('pointer:' + event.pointerId)}
        onLostPointerCapture={event => release('pointer:' + event.pointerId)}
        onClick={event => {
          // Assistive technologies may activate a button without pointer/key
          // events. Give that activation one short, bounded driving input.
          if (event.detail !== 0 || disabledRef.current) return;
          if (action.id === 'left' || action.id === 'right') {
            onTurn(action.id === 'left' ? -1 : 1);
            return;
          }
          const token = 'click:' + action.id;
          window.clearTimeout(pulses.current.get(token));
          held.current.set(token, action.id); publish();
          pulses.current.set(token, window.setTimeout(() => { pulses.current.delete(token); release(token); }, 200));
        }}
        onContextMenu={event => event.preventDefault()}>
        <span aria-hidden="true">{action.icon}</span>{action.text}
      </button>)}
    </div>
    <small id={hintId}>Choose left or right for the next street or ramp. Hold brake to slow down, then reverse. Focus these controls to use arrow keys or WASD.</small>
  </div>;
}
