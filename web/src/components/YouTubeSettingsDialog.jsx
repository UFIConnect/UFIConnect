import PagedList from './PagedList';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './YouTubeSettingsDialog.css';

const CAPTION_SIZES = [
  { value: -1, label: 'Small' },
  { value: 0, label: 'Default' },
  { value: 1, label: 'Large' },
  { value: 2, label: 'Larger' },
  { value: 3, label: 'Largest' },
];

function SettingsChoices({ label, options, selected, onChange, disabled }) {
  const choices = useRef([]);
  const selectedIndex = options.findIndex(option => option.value === selected);

  function handleKey(event, index) {
    if (disabled || !options.length) return;
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
      type="button" role="radio" aria-label={option.label} aria-checked={option.value === selected} disabled={disabled}
      tabIndex={index === (selectedIndex < 0 ? 0 : selectedIndex) ? 0 : -1}
      onClick={() => onChange(option.value)} onKeyDown={event => handleKey(event, index)}>{option.label}</button>)}
  </div>;
}

// Provider capabilities come from the mounted player. A source's name alone
// never enables a control that its embed cannot perform.
export default function YouTubeSettingsDialog({ settings, title = 'YouTube settings', provider, sourceLabel,
  onRateChange, onCaptionSizeChange, onCaptionTrackChange, onQualityChange, onOpenYouTube, onOpenSource, sourceNotice, onClose }) {
  const dialog = useRef(null), closeButton = useRef(null), restoreFocus = useRef(true);
  const mounted = useRef(false), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const kind = provider || (title === 'Player settings' ? 'native' : 'youtube');
  const label = sourceLabel || (kind === 'youtube' ? 'YouTube' : kind === 'vimeo' ? 'Vimeo' : 'the original source');
  const openSource = onOpenSource || onOpenYouTube;
  const rates = [...new Set((settings?.rates || []).filter(rate => Number.isFinite(rate) && rate > 0))].sort((left, right) => left - right);
  const captionSize = settings?.captionFontSize;
  const hasCaptionSize = Number.isInteger(captionSize) && captionSize >= -1 && captionSize <= 3;
  const tracks = (settings?.captionTracks || []).filter(track => typeof track?.value === 'string' && track.value !== 'off' && typeof track.label === 'string');
  const qualities = (settings?.qualities || []).filter(quality => typeof quality?.value === 'string' && typeof quality.label === 'string');
  const disabled = busy || settings?.ready === false;
  const hasRate = rates.length > 0 && typeof onRateChange === 'function';
  const hasTracks = tracks.length > 0 && typeof onCaptionTrackChange === 'function';
  const hasQuality = qualities.length > 0 && typeof onQualityChange === 'function';

  const change = operation => async value => {
    if (pending.current || disabled || typeof operation !== 'function') return;
    pending.current = true; setBusy(true); setError('');
    try {
      const accepted = await operation(value);
      if (accepted === false && mounted.current) setError('This setting could not change. Try again or open the original source.');
    } catch {
      if (mounted.current) setError('This setting could not change. Try again or open the original source.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement, overflow = document.body.style.overflow, current = dialog.current;
    current.showModal(); document.body.style.overflow = 'hidden'; closeButton.current?.focus();
    return () => {
      mounted.current = false;
      current.close(); document.body.style.overflow = overflow;
      if (restoreFocus.current && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<dialog ref={dialog} className="youtube-settings-dialog" aria-label={title}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="youtube-settings-content">
      <header>
        <h2>{title}</h2>
        <button ref={closeButton} type="button" className="youtube-settings-close" aria-label={`Close ${title}`} onClick={onClose}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <PagedList pageSize={2} label="Player settings">
      {kind !== 'source' && <section>
        <h3>Playback speed</h3>
        {hasRate ? <SettingsChoices label="Playback speed" options={rates.map(rate => ({ value: rate, label: `${rate}\u00d7` }))}
          selected={settings.rate} disabled={disabled} onChange={change(onRateChange)} /> : <p className="youtube-settings-help">{settings?.ready === false ? 'Playback settings become available when the video is ready.' : 'Playback speed is unavailable for this video.'}</p>}
      </section>}
      {hasCaptionSize && typeof onCaptionSizeChange === 'function' && <section>
        <h3>Caption size</h3>
        <SettingsChoices label="Caption size" options={CAPTION_SIZES} selected={captionSize} disabled={disabled} onChange={change(onCaptionSizeChange)} />
      </section>}
      {(kind === 'native' || hasTracks) && <section>
        <h3>Captions</h3>
        {hasTracks ? <SettingsChoices label="Captions" options={[{ value: 'off', label: 'Off' }, ...tracks]}
          selected={settings?.captionTrack || 'off'} disabled={disabled} onChange={change(onCaptionTrackChange)} />
          : <p className="youtube-settings-help">Caption tracks are unavailable for this video.</p>}
      </section>}
      {hasQuality && <section>
        <h3>Video quality</h3>
        <SettingsChoices label="Video quality" options={qualities} selected={settings?.quality} disabled={disabled} onChange={change(onQualityChange)} />
      </section>}
      {typeof openSource === 'function' && <section className="youtube-settings-provider">
        <h3>{kind === 'youtube' ? 'Quality and captions' : `${label} playback`}</h3>
        <p>{sourceNotice || (kind === 'youtube'
          ? 'YouTube adjusts quality automatically here. Open the original video to choose quality, caption language, or turn captions on or off.'
          : kind === 'source' ? `This source manages playback in its own player. Open the original post for its playback options.`
            : `Open the original video for any additional options offered by ${label}.`)}</p>
        <button type="button" className="btn btn-primary" onClick={openSource}>Open on {label}</button>
      </section>}
      </PagedList>
      {error && <p className="youtube-settings-error" role="alert">{error}</p>}
    </div>
  </dialog>, document.body);
}
