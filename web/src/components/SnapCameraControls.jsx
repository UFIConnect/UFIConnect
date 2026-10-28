import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Camera, Video, Square, SwitchCamera, FlipHorizontal2, Mic, MicOff, Pause, Play, X, ChevronLeft, Timer, ImagePlus, SlidersHorizontal, CircleHelp, Maximize2 } from 'lucide-react';
import { useCameraVoiceCommands } from '../hooks/useCameraVoiceCommands';
import { SNAP_FILTERS, SNAP_MAX_OVERLAY } from './snapEffects.mjs';
import { SNAP_MAX_VIDEO_SECONDS } from './snapRanking.mjs';
import './SnapCameraControls.css';

export default function SnapCameraControls({ camera, accountId, mirror, mirrorSupported, onMirror, onSwitch, onMode, onClose, onGallery, filter, onFilter, overlayText, onText, fill, onFill, error }) {
  const [timer, setTimer] = useState(0), [countdown, setCountdown] = useState(0), [panel, setPanel] = useState(''), [notice, setNotice] = useState('');
  const countdownRef = useRef(null), generation = useRef(0), actions = useRef(null), closeButton = useRef(null);
  const previousPanel = useRef('');
  useLayoutEffect(() => { if (previousPanel.current && !panel) closeButton.current?.focus({ preventScroll: true }); previousPanel.current = panel; }, [panel]);
  const locked = camera.recording || countdown > 0;
  function cancelTimer() { generation.current++; clearInterval(countdownRef.current); countdownRef.current = null; setCountdown(0); }
  function capture(kind = camera.mode) {
    if (!camera.ready || countdownRef.current || camera.recording) return;
    if (kind !== camera.mode) { setNotice(`Select ${kind === 'video' ? 'Video' : 'Photo'} mode first.`); return; }
    setNotice('');
    const perform = () => kind === 'photo' ? camera.photo({ mirror }) : camera.record({ mirror });
    if (!timer) { perform(); return; }
    let remaining = timer; const id = ++generation.current;
    setCountdown(remaining);
    countdownRef.current = setInterval(() => {
      if (generation.current !== id || document.hidden) { cancelTimer(); return; }
      remaining--; setCountdown(remaining);
      if (remaining === 0) { cancelTimer(); perform(); }
    }, 1000);
  }
  function available(action) {
    if (!camera.ready || locked) { setNotice('Stop recording or cancel the timer before changing camera settings.'); return; }
    setNotice(''); action();
  }
  function command(name) {
    const table = {
      photo: () => capture('photo'), capture: () => camera.recording ? camera.stopRecording() : capture(), record: () => capture('video'),
      stop: () => { if (camera.recording) camera.stopRecording(); },
      pause: () => { if (camera.recording && !camera.paused) camera.pauseRecording(); },
      resume: () => { if (camera.recording && camera.paused) camera.pauseRecording(); },
      mute: () => { if (camera.ready && camera.mode === 'video' && !camera.muted) camera.toggleMicrophone(); },
      unmute: () => { if (camera.ready && camera.mode === 'video' && camera.muted) camera.toggleMicrophone(); },
      photoMode: () => available(() => onMode('photo')), videoMode: () => available(() => onMode('video')),
      switch: () => available(onSwitch), mirror: () => available(() => { if (mirrorSupported) onMirror(); }),
      timerOff: () => available(() => setTimer(0)), timerThree: () => available(() => setTimer(3)), timerTen: () => available(() => setTimer(10)),
      cancelTimer, help: () => setPanel('help'), hideHelp: () => setPanel(''),
      effects: () => setPanel('effects'), fit: () => { if (fill) onFill(); }, fill: () => { if (!fill) onFill(); },
      back: () => { if (panel) setPanel(''); else if (countdown) cancelTimer(); else if (camera.recording) camera.stopRecording(); else camera.stop(); },
      close: () => { if (camera.recording) setNotice('Stop recording first to keep your video.'); else { cancelTimer(); camera.stop(); } },
    };
    table[name]?.();
  }
  actions.current = command;
  const voice = useCameraVoiceCommands(command, accountId);
  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
    const keys = event => {
      if (event.target.closest?.('dialog') !== closeButton.current?.closest('dialog')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); actions.current('back'); return; }
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      const name = { p: 'photoMode', v: 'videoMode', f: 'switch', m: 'mirror', c: 'capture' }[event.key.toLowerCase()];
      if (name) { event.preventDefault(); actions.current(name); }
      else if (event.code === 'Space' && !event.target.closest?.('button,a')) { event.preventDefault(); actions.current('capture'); }
    };
    window.addEventListener('keydown', keys);
    return () => { generation.current++; clearInterval(countdownRef.current); window.removeEventListener('keydown', keys); };
  }, []);
  useEffect(() => { if (!camera.ready) cancelTimer(); }, [camera.ready]);
  const status = !camera.ready ? 'Opening camera…' : camera.recording ? `${camera.paused ? 'Paused' : 'Recording'} · ${camera.seconds}s / ${SNAP_MAX_VIDEO_SECONDS}s` : `${camera.facing === 'user' ? 'Front' : 'Rear'} camera${mirror ? ' · Mirrored' : ''}`;
  return <div className="snap-capture-controls" aria-label="Camera controls">
    <div className="snap-capture-top">
      <button ref={closeButton} type="button" className="snap-capture-icon" aria-label="Close camera" disabled={camera.recording} onClick={() => { cancelTimer(); camera.stop(); }}><ChevronLeft size={23} /></button>
      <span className={`snap-camera-status${camera.recording ? ' is-recording' : ''}`} role="status">{status}</span>
      <button type="button" className="snap-capture-icon" aria-label="Close snap composer" disabled={camera.recording} onClick={onClose}><X size={23} /></button>
    </div>
    {countdown > 0 && <div className="snap-capture-countdown" role="status" aria-live="assertive">{countdown}<button type="button" onClick={cancelTimer}>Cancel timer</button></div>}
    <div className="snap-capture-tools">
      <button type="button" disabled={!camera.ready || locked} aria-label="Switch camera" onClick={() => available(onSwitch)}><SwitchCamera size={21} /><span>Flip</span></button>
      <button type="button" disabled={!camera.ready || locked || !mirrorSupported} aria-label="Mirror camera" aria-pressed={mirror} onClick={() => available(onMirror)}><FlipHorizontal2 size={21} /><span>Mirror</span></button>
      <button type="button" disabled={locked} aria-label={`Capture timer: ${timer ? `${timer} seconds` : 'off'}`} onClick={() => setTimer(timer === 0 ? 3 : timer === 3 ? 10 : 0)}><Timer size={21} /><span>{timer ? `${timer}s` : 'Timer'}</span></button>
      <button type="button" aria-label={fill ? 'Fit camera frame' : 'Fill camera screen'} onClick={onFill}><Maximize2 size={21} /><span>{fill ? 'Fit' : 'Fill'}</span></button>
      <button type="button" aria-label="Camera effects" aria-expanded={panel === 'effects'} onClick={() => setPanel(panel === 'effects' ? '' : 'effects')}><SlidersHorizontal size={21} /><span>Effects</span></button>
      <button type="button" aria-label="Camera commands" aria-expanded={panel === 'help'} onClick={() => setPanel(panel === 'help' ? '' : 'help')}><CircleHelp size={21} /><span>Commands</span></button>
    </div>
    {panel && <section className="snap-capture-panel" aria-label={panel === 'effects' ? 'Camera effects' : 'Camera commands'}>
      <button type="button" className="snap-capture-icon" aria-label="Close camera panel" onClick={() => setPanel('')}><X size={18} /></button>
      {panel === 'effects' ? <><label>Camera filter<select value={filter} onChange={event => onFilter(event.target.value)}>{SNAP_FILTERS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Text on camera<input maxLength={SNAP_MAX_OVERLAY} value={overlayText} onChange={event => onText(event.target.value)} placeholder="Add text to your snap" /></label></>
        : <><h3>Camera commands</h3><p>Say “take photo,” “video mode,” “start recording,” “pause recording,” “resume recording,” “stop recording,” “mute recording,” “unmute recording,” “switch camera,” “mirror camera,” “three second timer,” “ten second timer,” “timer off,” “fit frame,” “show effects,” or “stop listening.”</p><p>Keyboard: P photo · V video · F flip · M mirror · C capture or stop · Escape back.</p><p>Voice uses your browser’s speech service, which may process audio online. UFIconnect does not store command transcripts. Commands may be audible in your video unless recording audio is muted. Voice commands never post your snap.</p><button type="button" disabled={!voice.supported || voice.starting} onClick={voice.listening ? voice.stop : voice.start}>{voice.listening ? 'Stop voice commands' : 'Enable voice commands'}</button></>}
    </section>}
    <div className="snap-capture-bottom">
      {(notice || error || voice.message || !voice.supported) && <p className="snap-capture-notice" role={error ? 'alert' : 'status'}>{error || notice || voice.message || 'Voice commands are unavailable in this browser. Use the on-screen controls.'}</p>}
      <div className="snap-capture-modes" role="group" aria-label="Capture mode"><button type="button" aria-pressed={camera.mode === 'photo'} disabled={locked} onClick={() => onMode('photo')}>Photo</button><button type="button" aria-pressed={camera.mode === 'video'} disabled={locked} onClick={() => onMode('video')}>Video</button></div>
      <div className="snap-camera-actions">
        <button type="button" className="snap-shutter" disabled={!camera.ready || countdown > 0} aria-label={camera.mode === 'photo' ? 'Take photo' : camera.recording ? 'Stop recording' : 'Record video'} onClick={() => camera.recording ? camera.stopRecording() : capture()}>{camera.recording ? <Square fill="currentColor" size={27} /> : camera.mode === 'photo' ? <Camera size={30} /> : <Video size={30} />}</button>
        {camera.recording && <button type="button" className="snap-capture-icon snap-pause" aria-label={camera.paused ? 'Resume recording' : 'Pause recording'} onClick={camera.pauseRecording}>{camera.paused ? <Play size={23} /> : <Pause size={23} />}</button>}
      </div>
      <div className="snap-capture-secondary">
        <button type="button" disabled={locked} onClick={onGallery}><ImagePlus size={21} /><span>Gallery</span></button>
        <button type="button" aria-label="Voice commands" aria-pressed={voice.listening || voice.starting} disabled={!voice.supported} onClick={() => voice.listening || voice.starting ? voice.stop() : setPanel('help')}>{voice.listening ? <Mic size={21} /> : <MicOff size={21} />}<span>{voice.starting ? 'Starting…' : voice.listening ? 'Listening' : 'Voice'}</span></button>
        {camera.mode === 'video' && <button type="button" disabled={!camera.ready} aria-label={camera.muted ? 'Unmute recording microphone' : 'Mute recording microphone'} aria-pressed={camera.muted} onClick={camera.toggleMicrophone}>{camera.muted ? <MicOff size={21} /> : <Mic size={21} />}<span>{camera.muted ? 'Sound off' : 'Sound on'}</span></button>}
      </div>
    </div>
  </div>;
}
