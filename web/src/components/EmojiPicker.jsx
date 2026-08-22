import { useState, useRef, useEffect } from 'react';

// Curated rather than an exhaustive ~3000-emoji library — no new dependency,
// no huge bundle, just the set people actually reach for in a professional-
// but-human networking post. Grouped the same way every mainstream picker
// groups them, since that's the mental model people already have.
const EMOJI_GROUPS = [
  { label: 'Smileys', emojis: ['😀','😁','😂','🤣','😊','😍','🥰','😎','🤔','😅','😉','🙂','😇','🥳','😴','🤯','😮','😢','😭','😤','🙄','😬','🫡','🤝'] },
  { label: 'Gestures', emojis: ['👍','👎','👏','🙌','🙏','💪','✌️','🤞','👌','🤙','👋','🫶','🤲','👀','💯','🔥','✨','🎉','🚀','⭐','💡','✅','❌','⚡'] },
  { label: 'Work & Tech', emojis: ['💻','📱','🖥️','⌨️','🖱️','📊','📈','📉','🗂️','📌','📝','🛠️','⚙️','🔧','🧩','🔗','📎','🗓️','⏰','💼','🏆','🎯','🧠','🤖'] },
  { label: 'People', emojis: ['👨‍💻','👩‍💻','🧑‍💼','👨‍💼','👩‍💼','🧑‍🎓','👥','🫂','🗣️','💬','📢','🤝‍'] },
  { label: 'Objects & Places', emojis: ['🌍','🌱','☕','🍕','🎓','🏢','🏠','✈️','🚗','📦','💰','💳','🎁','📷','🎬','🎧','📚','🗞️','🧾','🔒'] },
];

// Inserts at the current cursor position (or replaces a selection) rather
// than always appending to the end — same behavior a native text input's
// own IME/autocomplete gives, which is what users actually expect once
// they've clicked partway into what they've already written.
function insertAtCursor(textarea, value, insert) {
  const start = textarea?.selectionStart ?? value.length;
  const end = textarea?.selectionEnd ?? value.length;
  const next = value.slice(0, start) + insert + value.slice(end);
  const cursor = start + insert.length;
  return { next, cursor };
}

// Self-contained popover: owns its own open/close state and outside-click
// handling, so any composer just drops this in next to its other toolbar
// buttons and gets a working picker wired to its own textarea ref + value/
// onChange, without each composer re-implementing the popover mechanics.
export default function EmojiPicker({ textareaRef, value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState(0);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open]);

  function pick(emoji) {
    const ta = textareaRef?.current;
    const { next, cursor } = insertAtCursor(ta, value, emoji);
    onChange(next);
    // Restore focus + real cursor position after the emoji, not just at
    // the end — React's controlled-value update happens on the next tick,
    // so the selection restore has to wait for it too.
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        title="Add an emoji"
        aria-label="Add an emoji"
        aria-expanded={open}
      >
        😊
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Emoji picker"
          style={{
            position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 40,
            width: 288, maxWidth: '80vw',
            background: 'var(--card-bg, var(--surface))', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', boxShadow: '0 12px 32px rgba(0,0,0,.18)',
            padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
            {EMOJI_GROUPS.map((g, i) => (
              <button
                key={g.label}
                type="button"
                onClick={() => setActiveGroup(i)}
                style={{
                  flexShrink: 0, padding: '4px 10px', borderRadius: 'var(--radius-sm)', fontSize: '.72rem', fontWeight: 600,
                  border: `1px solid ${activeGroup === i ? 'var(--primary)' : 'transparent'}`,
                  background: activeGroup === i ? 'var(--primary)' : 'transparent',
                  color: activeGroup === i ? '#fff' : 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2, maxHeight: 168, overflowY: 'auto' }}>
            {EMOJI_GROUPS[activeGroup].emojis.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => pick(e)}
                style={{
                  border: 'none', background: 'none', fontSize: '1.25rem', lineHeight: 1,
                  padding: 6, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                }}
                onMouseEnter={(ev) => { ev.currentTarget.style.background = 'var(--surface)'; }}
                onMouseLeave={(ev) => { ev.currentTarget.style.background = 'none'; }}
                aria-label={e}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
