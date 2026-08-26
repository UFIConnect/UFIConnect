import { useState, useRef, useEffect } from 'react';

// A native <input type="file" accept="image/*"> already lets a mobile
// browser offer "Take Photo" as one of its own picker choices — but that's
// buried inside the OS sheet, easy to miss, and desktop has no camera
// option to speak of. Splitting it into two explicit choices (library vs.
// camera, via a second hidden input with capture="environment") makes
// "take a photo right now" a first-class, one-tap action instead of
// something a user has to already know is hiding in the file picker.
// Self-contained (owns its own menu open/close + outside-click, same
// pattern as EmojiPicker) so any upload area just drops this in instead of
// wiring two file inputs and a menu itself.
export default function PhotoPickerButton({ onFileSelected, accept = 'image/*', label = '📷 Photo', disabled = false, className, style }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const btnRef = useRef(null);
  const libraryInputRef = useRef(null);
  const cameraInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  function handleChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setOpen(false);
    if (file) onFileSelected(file);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <input ref={libraryInputRef} type="file" accept={accept} onChange={handleChange} style={{ display: 'none' }} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleChange} style={{ display: 'none' }} />
      <button
        ref={btnRef}
        type="button"
        className={className}
        style={style}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title="Add a photo"
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 40,
            minWidth: 180, background: 'var(--card-bg, var(--surface))', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', boxShadow: '0 12px 32px rgba(0,0,0,.18)',
            padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => libraryInputRef.current?.click()}
            style={{
              all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: '9px 10px', borderRadius: 'var(--radius-sm)',
              fontSize: '.85rem', fontWeight: 600, color: 'var(--text)', cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            🖼️ Choose from library
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => cameraInputRef.current?.click()}
            style={{
              all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10,
              width: '100%', padding: '9px 10px', borderRadius: 'var(--radius-sm)',
              fontSize: '.85rem', fontWeight: 600, color: 'var(--text)', cursor: 'pointer',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--surface)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            📸 Take a photo
          </button>
        </div>
      )}
    </div>
  );
}
