import { useEffect, useRef, useState } from 'react';
import { SNAP_MAX_VIDEO_BYTES, SNAP_MAX_VIDEO_SECONDS } from '../components/snapRanking.mjs';
import { MEDIA_PERMISSION_CHANGED, readMediaPermissions, requestMediaPermission } from '../utils/mediaPermissions.mjs';

// Browser capture only. The native host uses its system camera file inputs.
export function useSnapCamera(onCapture, onError, accountId) {
  const videoRef = useRef(null), stream = useRef(null), recorder = useRef(null);
  const request = useRef(0), pending = useRef(false), mounted = useRef(true), recordingTimer = useRef(null), clock = useRef(null);
  const permission = useRef(null);
  const mirroredStream = useRef(null), frame = useRef(null), elapsed = useRef(null), capturingPhoto = useRef(false);
  const callbacks = useRef({ onCapture, onError });
  callbacks.current = { onCapture, onError };
  const [active, setActive] = useState(false), [ready, setReady] = useState(false);
  const [mode, setMode] = useState('photo'), [recording, setRecording] = useState(false), [seconds, setSeconds] = useState(0);
  const [facing, setFacing] = useState('environment'), [paused, setPaused] = useState(false), [muted, setMuted] = useState(false);

  function recordedSeconds() {
    const time = elapsed.current;
    return time ? ((time.pausedAt || performance.now()) - time.started - time.pausedMs) / 1000 : 0;
  }
  function clearMirror() {
    cancelAnimationFrame(frame.current); frame.current = null;
    mirroredStream.current?.getVideoTracks().forEach(track => track.stop()); mirroredStream.current = null;
  }

  function clearTimers() { clearTimeout(recordingTimer.current); clearInterval(clock.current); }
  function stop() {
    request.current++;
    pending.current = false;
    permission.current?.abort(); permission.current = null;
    clearTimers();
    clearMirror(); capturingPhoto.current = false;
    if (recorder.current) {
      recorder.current.ondataavailable = recorder.current.onstop = recorder.current.onerror = null;
      if (recorder.current.state !== 'inactive') recorder.current.stop();
      recorder.current = null;
    }
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    elapsed.current = null;
    if (mounted.current) { setActive(false); setReady(false); setRecording(false); setPaused(false); setMuted(false); setSeconds(0); }
  }
  async function open(nextMode = 'photo', facingMode = 'environment') {
    stop();
    const id = request.current;
    pending.current = true;
    setMode(nextMode); setActive(true); setReady(false);
    try {
      const gate = new AbortController(); permission.current = gate;
      const allowed = await requestMediaPermission(accountId, 'camera', { signal: gate.signal });
      if (!mounted.current || request.current !== id) return;
      permission.current = null;
      if (!allowed) { stop(); return; }
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera capture is unavailable here. Choose a photo or video from your gallery.');
      if (nextMode === 'video' && typeof MediaRecorder === 'undefined') throw new Error('Video recording is unavailable in this browser. Choose a video from your gallery.');
      const nextStream = await navigator.mediaDevices.getUserMedia({ audio: nextMode === 'video', video: {
        facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 },
      } });
      if (!mounted.current || request.current !== id) { nextStream.getTracks().forEach(track => track.stop()); return; }
      pending.current = false;
      stream.current = nextStream;
      setFacing(nextStream.getVideoTracks()[0]?.getSettings?.().facingMode || facingMode);
      nextStream.getTracks().forEach(track => track.addEventListener('ended', () => {
        if (!mounted.current || request.current !== id) return;
        stop(); callbacks.current.onError('The camera connection ended. Open it again or choose from your gallery.');
      }, { once: true }));
      const video = videoRef.current;
      if (!video) { stop(); return; }
      video.srcObject = nextStream;
      await video.play();
      if (mounted.current && request.current === id) setReady(true);
    } catch (error) {
      if (!mounted.current || request.current !== id) return;
      stop();
      callbacks.current.onError(['NotAllowedError', 'SecurityError'].includes(error.name)
        ? 'Camera permission was not granted. Allow camera access in your browser settings, or choose from your gallery.'
        : error.name === 'NotFoundError' ? 'No camera was found. Choose a photo or video from your gallery.'
        : error.name === 'NotSupportedError' ? 'Camera capture is unavailable in this browser. Choose a photo or video from your gallery.'
        : error.name === 'NotReadableError' ? 'The camera is busy. Close other camera apps and try again, or use your gallery.'
        : error.message || 'Could not open the camera. Try again or choose from your gallery.');
    }
  }
  function photo({ mirror = false } = {}) {
    const video = videoRef.current, id = request.current;
    if (!ready || capturingPhoto.current || !video?.videoWidth || !video?.videoHeight) return;
    capturingPhoto.current = true; setReady(false);
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (mirror) { context.translate(canvas.width, 0); context.scale(-1, 1); }
    context.drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!mounted.current || id !== request.current) return;
      if (!blob) { capturingPhoto.current = false; setReady(true); callbacks.current.onError('Could not capture this photo. Please try again.'); return; }
      stop(); callbacks.current.onCapture(new File([blob], `snap-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', .9);
  }
  function stopRecording() {
    if (recorder.current && ['recording', 'paused'].includes(recorder.current.state)) { clearTimers(); recorder.current.stop(); setRecording(false); setPaused(false); }
  }
  function pauseRecording() {
    const capture = recorder.current, time = elapsed.current;
    if (!capture || !time) return;
    if (capture.state === 'recording' && typeof capture.pause === 'function') { capture.pause(); time.pausedAt = performance.now(); setSeconds(Math.floor(recordedSeconds())); setPaused(true); }
    else if (capture.state === 'paused' && typeof capture.resume === 'function') { capture.resume(); time.pausedMs += performance.now() - time.pausedAt; time.pausedAt = 0; setPaused(false); }
  }
  function toggleMicrophone() {
    const tracks = stream.current?.getAudioTracks() || [];
    if (!tracks.length) return;
    const enabled = !tracks[0].enabled;
    tracks.forEach(track => { track.enabled = enabled; }); setMuted(!enabled);
  }
  function record({ mirror = false } = {}) {
    if (!ready || !stream.current || recorder.current) return;
    try {
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'video/webm']
        .find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('Video recording is unavailable in this browser. Choose a video from your gallery.');
      let input = stream.current;
      if (mirror) {
        const video = videoRef.current, canvas = document.createElement('canvas');
        if (!canvas.captureStream || !video?.videoWidth) throw new Error('Mirrored video is unavailable here. Turn off Mirror and try again.');
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const context = canvas.getContext('2d'), id = request.current;
        const draw = () => {
          if (request.current !== id) return;
          context.save(); context.translate(canvas.width, 0); context.scale(-1, 1); context.drawImage(video, 0, 0); context.restore();
          frame.current = requestAnimationFrame(draw);
        };
        draw(); mirroredStream.current = canvas.captureStream(30);
        input = new window.MediaStream([...mirroredStream.current.getVideoTracks(), ...stream.current.getAudioTracks()]);
      }
      const capture = new MediaRecorder(input, { mimeType, videoBitsPerSecond: 3_000_000, audioBitsPerSecond: 128_000 });
      const chunks = [], id = request.current;
      elapsed.current = { started: performance.now(), pausedAt: 0, pausedMs: 0 };
      let bytes = 0;
      recorder.current = capture;
      capture.ondataavailable = event => {
        if (event.data?.size) { chunks.push(event.data); bytes += event.data.size; }
        if (bytes > SNAP_MAX_VIDEO_BYTES * .95 && capture.state === 'recording') stopRecording();
      };
      capture.onerror = () => { stop(); callbacks.current.onError('Recording failed. Please try again or choose a video from your gallery.'); };
      capture.onstop = () => {
        if (!mounted.current || id !== request.current) return;
        const duration = recordedSeconds();
        const type = capture.mimeType.split(';')[0], blob = new Blob(chunks, { type });
        stop();
        if (!blob.size) { callbacks.current.onError('The recording was empty. Please try again.'); return; }
        callbacks.current.onCapture(new File([blob], `snap-${Date.now()}.${type === 'video/mp4' ? 'mp4' : 'webm'}`, { type }), duration);
      };
      capture.start(500); setRecording(true); setPaused(false); setSeconds(0);
      clock.current = setInterval(() => {
        const duration = recordedSeconds(); setSeconds(Math.floor(duration));
        if (duration >= SNAP_MAX_VIDEO_SECONDS - 1) stopRecording();
      }, 250);
      // Leave room for the encoder to finish within the server's 60-second limit.
    } catch (error) { stop(); callbacks.current.onError(error.message || 'Could not start recording.'); }
  }
  useEffect(() => {
    mounted.current = true;
    const pause = () => {
      if (document.hidden && (stream.current || pending.current)) { stop(); callbacks.current.onError('The camera was paused while you were away. Open it again to continue.'); }
    };
    const changed = () => {
      if ((stream.current || pending.current) && readMediaPermissions(accountId).camera === 'block') {
        stop(); callbacks.current.onError('Camera is turned off for this account. Change your choice in Settings to use it again.');
      }
    };
    document.addEventListener('visibilitychange', pause);
    window.addEventListener(MEDIA_PERMISSION_CHANGED, changed);
    window.addEventListener('storage', changed);
    return () => { mounted.current = false; stop(); document.removeEventListener('visibilitychange', pause); window.removeEventListener(MEDIA_PERMISSION_CHANGED, changed); window.removeEventListener('storage', changed); };
  }, [accountId]);
  return { videoRef, active, ready, mode, facing, recording, paused, muted, seconds, open, stop, photo, record, stopRecording, pauseRecording, toggleMicrophone };
}
