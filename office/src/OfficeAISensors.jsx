import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Bot, Camera, CameraOff, Mic, Paperclip, PhoneOff, Square, Volume2 } from 'lucide-react';
import { createOfficeVoice } from './office-voice.mjs';
import { ATTACHMENT_ACCEPT } from './office-attachments.mjs';

const PHASE_LABELS = { idle: 'Voice off', starting: 'Starting microphone…', listening: 'Listening', speaking: 'Pip is speaking', working: 'Working on your request…' };

const OfficeAISensors = forwardRef(function OfficeAISensors({ active = true, disabled = false, busy = false, onVoiceMessage, onFiles, welcomeBriefing, onWelcomeConsumed = () => {}, onActivate = () => {} }, ref) {
  const [voiceState, setVoiceState] = useState({ phase: 'idle', text: '' }), [error, setError] = useState('');
  const [camera, setCamera] = useState(false), [cameraBusy, setCameraBusy] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const call = useRef(null), callStarted = useRef(false);
  const cameraFacing = useRef('user');
  const voice = useRef(null), stream = useRef(null), video = useRef(null), input = useRef(null), cameraSequence = useRef(0), mounted = useRef(false);
  const callbacks = useRef({ onVoiceMessage, onFiles, onWelcomeConsumed, onActivate }); callbacks.current = { onVoiceMessage, onFiles, onWelcomeConsumed, onActivate };
  const welcome = useRef(null), seenWelcome = useRef(null);

  function stopCamera() {
    cameraSequence.current++;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
    if (mounted.current) { setCamera(false); setCameraBusy(false); }
  }
  function snapshot() {
    const preview = video.current;
    if (!stream.current) return null;
    if (!preview?.videoWidth || preview.readyState < 2) throw Error('The camera is warming up. Wait for the preview, then try again.');
    const scale = Math.min(1, 1280 / Math.max(preview.videoWidth, preview.videoHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(preview.videoWidth * scale); canvas.height = Math.round(preview.videoHeight * scale);
    canvas.getContext('2d').drawImage(preview, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/jpeg', .8);
    if (data.length > 690000) data = canvas.toDataURL('image/jpeg', .5);
    if (data.length > 690000) throw Error('The camera frame is too large. Move closer to the subject or attach a photo.');
    return { name: `camera-${Date.now()}.jpg`, type: 'image/jpeg', data };
  }
  useImperativeHandle(ref, () => ({ snapshot, stop: () => { voice.current?.stop(); stopCamera(); }, get voiceActive() { return !!voice.current?.active; } }));
  useEffect(() => {
    mounted.current = true;
    voice.current = createOfficeVoice({ onState: value => { if (mounted.current) { setVoiceState(value); if (value.phase === 'idle' && callStarted.current) { callStarted.current = false; setCallOpen(false); stopCamera(); } } }, onError: value => { if (mounted.current) { setError(value); if (value) setCallOpen(true); } },
      onTranscript: async text => callbacks.current.onVoiceMessage(text, snapshot()) });
    const reset = () => { voice.current?.stop(); stopCamera(); setCallOpen(false); welcome.current = null; setError(''); };
    const visibility = () => { if (document.hidden) { voice.current?.stop(); stopCamera(); setCallOpen(false); } };
    window.addEventListener('office-token-changed', reset); document.addEventListener('visibilitychange', visibility);
    return () => { mounted.current = false; voice.current?.stop(); stopCamera(); window.removeEventListener('office-token-changed', reset); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  useEffect(() => { if (!active) { voice.current?.stop(); stopCamera(); setCallOpen(false); } }, [active]);
  useEffect(() => { if (camera && stream.current && video.current) { if (video.current.srcObject !== stream.current) video.current.srcObject = stream.current; video.current.play().catch(() => {}); } }, [camera, callOpen]);
  useEffect(() => {
    if (!callOpen) return;
    const previous = document.activeElement;
    call.current?.querySelector('button')?.focus();
    const keys = event => {
      if (event.key === 'Escape') { event.preventDefault(); endCall(); }
      if (event.key === 'Tab') {
        const buttons = [...(call.current?.querySelectorAll('button:not(:disabled)') || [])];
        if (!buttons.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
      }
    };
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); previous?.focus?.(); };
  }, [callOpen]);
  useEffect(() => {
    if (!welcomeBriefing?.id || typeof welcomeBriefing.text !== 'string' || seenWelcome.current === welcomeBriefing.id || disabled || busy) return;
    seenWelcome.current = welcomeBriefing.id; welcome.current = welcomeBriefing.text;
    callbacks.current.onActivate();
    beginCall(welcome.current);
    callbacks.current.onWelcomeConsumed(welcomeBriefing.id);
  }, [welcomeBriefing, disabled, busy]);
  async function toggleCamera() {
    if (stream.current || cameraBusy) { stopCamera(); return; }
    const current = ++cameraSequence.current; setCameraBusy(true); setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw Error('Camera sharing needs a secure browser with camera support.');
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: cameraFacing.current }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (!mounted.current || current !== cameraSequence.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media; setCamera(true); setCameraBusy(false); setCallOpen(true);
      media.getVideoTracks().forEach(track => { track.onended = stopCamera; });
    } catch (cause) {
      if (mounted.current && current === cameraSequence.current) { stopCamera(); setError(cause.name === 'NotAllowedError' ? 'Camera access was denied. Allow camera access in your browser, then try again.' : cause.name === 'NotFoundError' ? 'No camera is available. Attach a photo instead.' : cause.message || 'The camera could not start.'); }
    }
  }
  function beginCall(greeting = '') {
    setError(''); setCallOpen(true); callbacks.current.onActivate(); callStarted.current = false;
    callStarted.current = !!voice.current?.start(greeting);
    if (!stream.current && !cameraBusy) toggleCamera();
  }
  function startVoice() { beginCall(welcome.current || ''); welcome.current = null; }
  function endCall() { voice.current?.stop(); stopCamera(); setCallOpen(false); }
  function muteVoice() { callStarted.current = false; voice.current?.stop(); }
  function switchCamera() { if (cameraBusy) return; cameraFacing.current = cameraFacing.current === 'user' ? 'environment' : 'user'; stopCamera(); toggleCamera(); }
  return <div className="office-ai-sensors">
    <div className="office-ai-sensor-controls">
      <input ref={input} hidden type="file" multiple accept={ATTACHMENT_ACCEPT} aria-label="Attach file or photo" onChange={async event => { const files = [...event.target.files]; event.target.value = ''; try { await callbacks.current.onFiles(files); } catch (cause) { setError(cause.message || 'The attachment could not be read.'); } }} />
      <button type="button" disabled={disabled || busy} onClick={() => input.current?.click()}><Paperclip size={16} />Attach file or photo</button>
      <button type="button" aria-pressed={camera} disabled={disabled} onClick={toggleCamera}>{camera ? <CameraOff size={16} /> : <Camera size={16} />}{camera ? 'Turn camera off' : cameraBusy ? 'Cancel camera' : 'Share camera'}</button>
      {voiceState.phase === 'idle' ? <button type="button" disabled={disabled || busy} onClick={startVoice}><Mic size={16} />Start voice</button> : <button type="button" className="office-ai-stop-voice" onClick={endCall}><Square size={15} />End voice</button>}
    </div>
    <div className="office-ai-sensor-status" role="status" aria-live="polite"><span data-active={voiceState.phase !== 'idle'}>{voiceState.phase === 'speaking' ? <Volume2 size={14} /> : <Mic size={14} />}{PHASE_LABELS[voiceState.phase]}{voiceState.phase === 'listening' && voiceState.initial ? ' · waiting up to 5 seconds for your reply' : ''}</span><span data-active={camera}><Camera size={14} />{camera ? 'Camera on · a frame is shared with each message' : 'Camera off'}</span></div>
    {voiceState.text && <p className="office-ai-live-transcript">{voiceState.text}</p>}
    <div className="office-ai-call-backdrop" hidden={!callOpen}>
      <section ref={call} className="office-ai-call" role="dialog" aria-modal="true" aria-labelledby="office-ai-call-title" aria-describedby="office-ai-call-state" data-phase={voiceState.phase}>
        <header><span>UFICONNECT OFFICE</span><button type="button" onClick={endCall} aria-label="Close voice and camera call"><PhoneOff size={18} /></button></header>
        <div className="office-ai-call-stage"><div className="office-ai-call-avatar"><Bot size={66} strokeWidth={1.4} /></div><h2 id="office-ai-call-title">Pip</h2><p id="office-ai-call-state" role="status">{PHASE_LABELS[voiceState.phase]}{voiceState.phase === 'listening' && voiceState.initial ? ' · 5 seconds to respond' : ''}</p><div className="office-ai-call-wave" aria-hidden="true">{Array.from({length:9}, (_, index) => <i key={index} style={{animationDelay:`${index * .1}s`}} />)}</div><p className="office-ai-call-hint">{voiceState.phase === 'working' ? 'Your request is running in Work. Keep this call open to hear the result.' : 'Show me what you mean, then tell me what you need.'}</p></div>
        <div className="office-ai-self-preview"><video ref={video} autoPlay muted playsInline aria-label="Live camera preview" hidden={!camera} />{!camera && <div><CameraOff size={25} /><span>{cameraBusy ? 'Connecting camera…' : 'Camera off'}</span></div>}<span>You{camera ? ' · camera on' : ''}</span></div>
        {voiceState.text && <p className="office-ai-call-transcript">{voiceState.text}</p>}
        {error && <p className="office-ai-error" role="alert">{error}</p>}
        <div className="office-ai-call-controls"><button type="button" onClick={voiceState.phase === 'idle' ? startVoice : muteVoice} aria-pressed={voiceState.phase !== 'idle'}><Mic size={19} />{voiceState.phase === 'idle' ? 'Unmute microphone' : 'Mute microphone'}</button><button type="button" onClick={toggleCamera} aria-pressed={camera}>{camera ? <Camera size={19} /> : <CameraOff size={19} />}{camera ? 'Turn camera off' : 'Turn camera on'}</button><button type="button" disabled={cameraBusy} onClick={switchCamera}><Camera size={19} />Switch camera</button><button type="button" className="office-ai-end-call" onClick={endCall}><PhoneOff size={19} />End call</button></div>
        <button type="button" className="office-ai-call-text" onClick={endCall}>Continue with text</button>
      </section>
    </div>
    {error && <p className="office-ai-error" role="alert">{error}</p>}
  </div>;
});
export default OfficeAISensors;
