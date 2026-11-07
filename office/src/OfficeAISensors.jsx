import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Camera, CameraOff, Mic, MicOff, Paperclip, PhoneOff, Square, Volume2 } from 'lucide-react';
import PipCharacter from './PipCharacter';
import { createOfficeVoice } from './office-voice.mjs';
import { ATTACHMENT_ACCEPT } from './office-attachments.mjs';
import { PIP_TONES, getPipTone } from './pip-tones.mjs';
import { shouldMirrorCameraPreview } from '../../shared/cameraPreview.mjs';
import './PipCall.css';

const PHASE_LABELS = { idle: 'Voice off', starting: 'Starting microphone…', listening: 'Listening', speaking: 'Pip is speaking', working: 'Working on your request…', muted: 'Microphone paused' };

const OfficeAISensors = forwardRef(function OfficeAISensors({ active = true, disabled = false, busy = false, compact = false, tone = 'friendly', onToneChange = () => {}, following = false, onFollowingChange = () => {}, officeSection, onHelpHere, onActivityChange = () => {}, onCallOpenChange, onContinueWithText, onVoiceMessage, onFiles, welcomeBriefing, onWelcomeConsumed = () => {}, onActivate = () => {} }, ref) {
  const [voiceState, setVoiceState] = useState({ phase: 'idle', text: '' }), [error, setError] = useState('');
  const [camera, setCamera] = useState(false), [cameraBusy, setCameraBusy] = useState(false);
  const [cameraMirrored, setCameraMirrored] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const call = useRef(null), callStarted = useRef(false), reportedCallOpen = useRef(false);
  const cameraFacing = useRef('user');
  const voice = useRef(null), stream = useRef(null), video = useRef(null), input = useRef(null), cameraSequence = useRef(0), mounted = useRef(false);
  const callbacks = useRef({ onVoiceMessage, onFiles, onWelcomeConsumed, onActivate, onActivityChange, onCallOpenChange, onContinueWithText, tone }); callbacks.current = { onVoiceMessage, onFiles, onWelcomeConsumed, onActivate, onActivityChange, onCallOpenChange, onContinueWithText, tone };
  const welcome = useRef(null), seenWelcome = useRef(null);
  useEffect(() => {
    if (reportedCallOpen.current === callOpen) return;
    reportedCallOpen.current = callOpen;
    callbacks.current.onCallOpenChange?.(callOpen);
  }, [callOpen]);

  function stopCamera() {
    cameraSequence.current++;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
    if (mounted.current) { setCamera(false); setCameraBusy(false); setCameraMirrored(false); }
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
    voice.current = createOfficeVoice({ getTone: () => callbacks.current.tone, onState: value => { if (mounted.current) { setVoiceState(value); callbacks.current.onActivityChange(value); if (value.phase === 'idle' && callStarted.current) { callStarted.current = false; setCallOpen(false); stopCamera(); } } }, onError: value => { if (mounted.current) { setError(value); if (value) setCallOpen(true); } },
      onTranscript: async (text, options) => callbacks.current.onVoiceMessage(text, video.current?.videoWidth && video.current.readyState >= 2 ? snapshot() : null, options) });
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
      if (event.key === 'Escape') { event.preventDefault(); if (compact) event.stopPropagation(); endCall(); }
      if (event.key === 'Tab' && !compact) {
        const controls = [...(call.current?.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])') || [])]
          .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert]'));
        if (!controls.length) return;
        if (event.shiftKey && (document.activeElement === controls[0] || !call.current.contains(document.activeElement))) { event.preventDefault(); controls.at(-1).focus(); }
        else if (!event.shiftKey && (document.activeElement === controls.at(-1) || !call.current.contains(document.activeElement))) { event.preventDefault(); controls[0].focus(); }
      }
    };
    const keyTarget = compact ? call.current : document;
    keyTarget?.addEventListener('keydown', keys);
    return () => { keyTarget?.removeEventListener('keydown', keys); previous?.focus?.(); };
  }, [callOpen, compact]);
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
      stream.current = media; setCameraMirrored(shouldMirrorCameraPreview(media)); setCamera(true); setCameraBusy(false); setCallOpen(true);
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
  function muteVoice() { voice.current?.setMuted(!voiceState.micMuted); }
  function switchCamera() { if (cameraBusy) return; cameraFacing.current = cameraFacing.current === 'user' ? 'environment' : 'user'; stopCamera(); toggleCamera(); }
  function helpHere() {
    const prompt = `What can I do in ${officeSection?.label || 'this Office section'}? Explain useful next steps.`;
    if (voice.current?.active) { void voice.current.ask(prompt); return; }
    callbacks.current.onContinueWithText?.(); endCall(); onHelpHere?.();
  }
  const followControl = <label className="pip-follow-toggle"><input type="checkbox" checked={following} onChange={event => onFollowingChange(event.target.checked)} /><span><strong>Keep Pip with me</strong><small>{following ? `With you in ${officeSection?.label || 'Office'}` : 'Stay available while I navigate Office'}</small></span></label>;
  const contextHint = following && <div className="pip-context-hint"><span>{officeSection?.description || 'Your current Office section'}</span><button type="button" disabled={disabled || busy} onClick={helpHere}>Help with this screen</button><small>Section names and recent navigation are shared with your next message.</small></div>;
  return <div className="office-ai-sensors" data-call-open={callOpen}>
    <nav className="office-ai-sensor-controls" aria-label="Pip quick actions" hidden={callOpen}>
      <input ref={input} hidden type="file" multiple accept={ATTACHMENT_ACCEPT} aria-label="Attach file or photo" onChange={async event => { const files = [...event.target.files]; event.target.value = ''; try { await callbacks.current.onFiles(files); } catch (cause) { setError(cause.message || 'The attachment could not be read.'); } }} />
      <button type="button" aria-label="Attach file or photo" disabled={disabled || busy} onClick={() => input.current?.click()}><Paperclip size={16} />Attach</button>
      <button type="button" aria-label={camera ? 'Turn camera off' : cameraBusy ? 'Cancel camera' : 'Share camera'} aria-pressed={camera} disabled={disabled} onClick={toggleCamera}>{camera ? <CameraOff size={16} /> : <Camera size={16} />}{cameraBusy ? 'Cancel' : 'Camera'}</button>
      {voiceState.phase === 'idle' ? <button type="button" aria-label="Start voice" disabled={disabled || busy} onClick={startVoice}><Mic size={16} />Voice</button> : <button type="button" className="office-ai-stop-voice" onClick={endCall}><Square size={15} />End voice</button>}
    </nav>
    {!callOpen && <><div className="office-ai-sensor-status" role="status" aria-live="polite"><span data-active={voiceState.phase !== 'idle'}>{voiceState.phase === 'speaking' ? <Volume2 size={14} /> : <Mic size={14} />}{PHASE_LABELS[voiceState.phase]}</span><span data-active={camera}><Camera size={14} />{camera ? 'Camera on · a frame is shared with each message' : 'Camera off'}</span></div>
    {voiceState.text && <p className="office-ai-live-transcript">{voiceState.text}</p>}</>}
    <div className="office-ai-call-backdrop" hidden={!callOpen}>
      <section ref={call} className="office-ai-call pip-call" role={compact ? 'region' : 'dialog'} aria-modal={compact ? undefined : true} aria-labelledby="office-ai-call-title" aria-describedby="office-ai-call-state" data-phase={voiceState.phase}>
        <header><span>Voice call</span><button type="button" onClick={endCall} aria-label="Close voice and camera call"><PhoneOff size={18} /></button></header>
        <div className="office-ai-call-stage"><div className="office-ai-call-avatar"><PipCharacter size={110} state={voiceState.phase === 'working' ? 'thinking' : voiceState.phase === 'starting' ? 'listening' : voiceState.phase} speech={voiceState} tone={tone} decorative /></div><h2 id="office-ai-call-title">Pip</h2><p id="office-ai-call-state" role="status">{PHASE_LABELS[voiceState.phase]}</p><div className="office-ai-call-wave" data-word={voiceState.word || undefined} aria-hidden="true">{Array.from({length:9}, (_, index) => <i key={index} style={{animationDelay:`${index * .1}s`}} />)}</div><p className="office-ai-call-hint">{voiceState.phase === 'working' ? 'Your request is running in Work. Keep this call open to hear the result.' : following ? `I’m with you in ${officeSection?.label || 'Office'}. Tell me what you need.` : 'Tell me what you need. You can share your camera too.'}</p></div>
        <div className="office-ai-self-preview" hidden={!camera}><video ref={video} autoPlay muted playsInline aria-label="Live camera preview" style={{ transform: cameraMirrored ? 'scaleX(-1)' : undefined }} hidden={!camera} /><span>You · camera on</span></div>
        {voiceState.text && <p className="office-ai-call-transcript">{voiceState.text}</p>}
        {error && <p className="office-ai-error" role="alert">{error}</p>}
        <div className="office-ai-call-controls"><button type="button" onClick={voiceState.phase === 'idle' ? startVoice : muteVoice} aria-label={voiceState.phase === 'idle' || voiceState.micMuted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={voiceState.phase !== 'idle' && !voiceState.micMuted}>{voiceState.micMuted ? <MicOff size={19} /> : <Mic size={19} />}{voiceState.phase === 'idle' || voiceState.micMuted ? 'Unmute' : 'Mute'}</button><button type="button" onClick={toggleCamera} aria-label={camera ? 'Turn camera off' : cameraBusy ? 'Cancel camera' : 'Turn camera on'} aria-pressed={camera}>{camera ? <Camera size={19} /> : <CameraOff size={19} />}{cameraBusy ? 'Cancel camera' : camera ? 'Camera on' : 'Camera off'}</button><button type="button" className="office-ai-end-call" onClick={endCall}><PhoneOff size={19} />End call</button></div>
        {['speaking', 'working'].includes(voiceState.phase) && <button type="button" className="pip-call-interrupt" onClick={() => voice.current?.interrupt()}><Volume2 size={16} />{voiceState.phase === 'working' ? 'Speak while Pip works' : 'Interrupt & speak'}</button>}
        <details className="pip-call-options"><summary>Call settings</summary><div className="pip-call-settings"><label className="office-ai-tone-control"><span>Tone</span><select aria-label="Call tone" value={tone} onChange={event => onToneChange(event.target.value)}>{PIP_TONES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><small>{getPipTone(tone).description}</small></label>{camera && <button type="button" disabled={cameraBusy} onClick={switchCamera}><Camera size={16} />Switch camera</button>}{followControl}{contextHint}</div></details>
        <button type="button" className="office-ai-call-text" onClick={() => { callbacks.current.onContinueWithText?.(); endCall(); }}>Continue with text</button>
      </section>
    </div>
    {!callOpen && error && <p className="office-ai-error" role="alert">{error}</p>}
  </div>;
});
export default OfficeAISensors;
