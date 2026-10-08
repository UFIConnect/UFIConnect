import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './YouTubeSettingsDialog.css';

const CAPTION_SIZES = [
  { value: -1, label: 'Small' },
  { value: 0, label: 'Default' },
  { value: 1, label: 'Large' },
  { value: 2, label: 'Larger' },
  { value: 3, label: 'Largest' },
];

function SettingsChoices({ label, options, selected, onChange }) {
  const choices = useRef([]);
  const selectedIndex = options.findIndex(option => option.value === selected);

  function handleKey(event, index) {
    let next;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault(); event.stopPropagation();
    choices.current[next]?.focus({ preventScroll: true });
    onChange(options[next].value);
  }

  return <div className="youtube-settings-choices" role="radiogroup" aria-label={label}>
    {options.map((option, index) => <button key={option.value} ref={element => { choices.current[index] = element; }}
      type="button" role="radio" aria-label={option.label} aria-checked={option.value === selected}
      tabIndex={index === (selectedIndex < 0 ? 0 : selectedIndex) ? 0 : -1}
      onClick={() => onChange(option.value)} onKeyDown={event => handleKey(event, index)}>{option.label}</button>)}
  </div>;
}

export default function YouTubeSettingsDialog({ settings, onRateChange, onCaptionSizeChange, onPlayerControls, onClose }) {
  const dialog = useRef(null), closeButton = useRef(null), restoreFocus = useRef(true);
  const rates = [...new Set((settings?.rates || []).filter(rate => Number.isFinite(rate) && rate > 0))].sort((left, right) => left - right);
  const captionSize = settings?.captionFontSize;
  const hasCaptionSize = Number.isInteger(captionSize) && captionSize >= -1 && captionSize <= 3;

  useEffect(() => {
    const previous = document.activeElement, overflow = document.body.style.overflow, current = dialog.current;
    current.showModal(); document.body.style.overflow = 'hidden'; closeButton.current?.focus();
    return () => {
      current.close(); document.body.style.overflow = overflow;
      if (restoreFocus.current && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<dialog ref={dialog} className="youtube-settings-dialog" aria-label="YouTube settings"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="youtube-settings-content">
      <header>
        <h2>YouTube settings</h2>
        <button ref={closeButton} type="button" className="youtube-settings-close" aria-label="Close YouTube settings" onClick={onClose}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <section>
        <h3>Playback speed</h3>
        {rates.length ? <SettingsChoices label="Playback speed" options={rates.map(rate => ({ value: rate, label: `${rate}\u00d7` }))}
          selected={settings.rate} onChange={onRateChange} /> : <p className="youtube-settings-help">Playback speed is unavailable for this video.</p>}
      </section>
      {hasCaptionSize && <section>
        <h3>Caption size</h3>
        <SettingsChoices label="Caption size" options={CAPTION_SIZES} selected={captionSize} onChange={onCaptionSizeChange} />
      </section>}
      <section className="youtube-settings-provider">
        <h3>Quality and captions</h3>
        <p>Use the YouTube player’s gear for quality and caption language, and CC to turn captions on or off.</p>
        <button type="button" className="btn btn-primary" onClick={() => { restoreFocus.current = false; onPlayerControls(); }}>Use YouTube player controls</button>
      </section>
    </div>
  </dialog>, document.body);
}
