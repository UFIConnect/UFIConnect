import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import './PasswordInput.css';

// Keep browser autofill and paste available for password managers. Blocking
// copying prevents accidental clipboard exposure; it is not encryption.
const PasswordInput = forwardRef(function PasswordInput({ onCopy, onCut, onDragStart, id, ...props }, ref) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const inputRef = useRef(null);
  const selectionRef = useRef(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const hide = () => setRevealed(false);
    // Browsers may freeze or snapshot a page as soon as these events end.
    // Commit concealment before returning instead of queuing a React update.
    const hideImmediately = () => flushSync(hide);
    const hideWhenHidden = () => { if (document.hidden) hideImmediately(); };
    const form = inputRef.current?.form;
    window.addEventListener('blur', hideImmediately);
    window.addEventListener('pagehide', hideImmediately);
    document.addEventListener('visibilitychange', hideWhenHidden);
    form?.addEventListener('submit', hide, true);
    form?.addEventListener('reset', hide, true);
    return () => {
      window.removeEventListener('blur', hideImmediately);
      window.removeEventListener('pagehide', hideImmediately);
      document.removeEventListener('visibilitychange', hideWhenHidden);
      form?.removeEventListener('submit', hide, true);
      form?.removeEventListener('reset', hide, true);
    };
  }, []);

  useLayoutEffect(() => {
    if (props.value === '' || props.disabled) setRevealed(false);
  }, [props.value, props.disabled]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const selection = selectionRef.current;
    let cancelled = false;
    const restoreSelection = () => {
      if (!cancelled && inputRef.current === input && selection) input.setSelectionRange(...selection);
    };
    restoreSelection();
    // Browsers can reset the selection while applying the new input type.
    // Restore it after that update, while preserving the user's focus.
    const frame = requestAnimationFrame(restoreSelection);
    selectionRef.current = null;
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [revealed]);

  const preventExport = (event) => {
    event.preventDefault();
    event.clipboardData?.clearData();
    event.dataTransfer?.clearData();
  };
  const toggleVisibility = () => {
    const input = inputRef.current;
    if (input && !selectionRef.current) selectionRef.current = [input.selectionStart, input.selectionEnd, input.selectionDirection];
    setRevealed(value => !value);
  };
  return (
    <span
      className="password-input"
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setRevealed(false); }}
      onKeyDown={event => { if (event.key === 'Escape') setRevealed(false); }}
    >
      <input
        {...props}
        id={inputId}
        ref={input => {
          inputRef.current = input;
          if (typeof ref === 'function') ref(input);
          else if (ref) ref.current = input;
        }}
        type={revealed ? 'text' : 'password'}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        draggable={false}
        onCopy={preventExport}
        onCut={preventExport}
        onDragStart={preventExport}
      />
      <button
        type="button"
        className="password-input-toggle"
        aria-label={revealed ? 'Hide password' : 'Show password'}
        aria-controls={inputId}
        aria-pressed={revealed}
        disabled={props.disabled}
        onPointerDown={event => {
          event.preventDefault();
          const input = inputRef.current;
          if (input) {
            selectionRef.current = [input.selectionStart, input.selectionEnd, input.selectionDirection];
            // A pointer may target another field's toggle directly. Move
            // focus into this field so the previously revealed one hides.
            input.focus({ preventScroll: true });
          }
        }}
        onMouseDown={event => event.preventDefault()}
        onClick={toggleVisibility}
      >
        {revealed ? 'Hide' : 'Show'}
      </button>
    </span>
  );
});

export default PasswordInput;
