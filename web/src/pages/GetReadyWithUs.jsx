import { useCallback, useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useLocation } from 'react-router-dom';
import { Copy, LogOut, Mic, MicOff, Radio, Share2, Square, Video, VideoOff } from 'lucide-react';
import Layout from '../components/Layout';
import { isNativeRuntime } from '../nativeRuntime.mjs';
import client from '../api/client';
import { LIVE_API, broadcastLive, closeLiveConnection, liveSessionPath, liveViewerPath, watchLive } from './getReadyLive';
import './GetReadyWithUs.css';

const PAGE_TITLE = 'Get Ready With Us';
const INVITE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function errorMessage(error, fallback) {
  return error?.response?.data?.message || fallback;
}

function LiveVideo({ stream, placeholder, preview = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    return () => { video.srcObject = null; };
  }, [stream]);

  return <div className="get-ready-stage">
    {stream ? <video ref={ref} autoPlay playsInline muted controls={!preview} aria-label={preview ? 'Your camera preview' : 'Live video'} />
      : <div className="get-ready-stage-empty"><Video size={37} aria-hidden="true" /><p>{placeholder}</p></div>}
  </div>;
}

function InviteControls({ inviteToken, title }) {
  const [status, setStatus] = useState('');
  const field = useRef(null);
  const url = new URL(`${import.meta.env.BASE_URL}get-ready-with-us`, isNativeRuntime() ? 'https://uficonnect.org' : window.location.origin);
  url.hash = `join=${inviteToken}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url.href);
      setStatus('Invite link copied.');
    } catch {
      field.current?.focus();
      field.current?.select();
      setStatus('Copy the selected invite link.');
    }
  }

  async function share() {
    try { await navigator.share({ title, text: 'Join my Get Ready With Us live session on UFIConnect.', url: url.href }); }
    catch (error) { if (error.name !== 'AbortError') await copy(); }
  }

  return <div className="get-ready-invite">
    <h2>Invite people</h2>
    <p>Anyone signed in with this link can watch while you’re live.</p>
    <input ref={field} className="form-input" readOnly value={url.href} aria-label="Invite link" onFocus={event => event.currentTarget.select()} />
    <div className="get-ready-actions">
      <button type="button" className="btn btn-primary" onClick={copy}><Copy size={16} aria-hidden="true" />Copy invite link</button>
      {typeof navigator.share === 'function' && <button type="button" className="btn btn-outline" onClick={share}><Share2 size={16} aria-hidden="true" />Share</button>}
    </div>
    <span className="get-ready-feedback" role="status">{status}</span>
  </div>;
}

function HostStudio() {
  const resources = useRef({ stream: null, sessionId: null, action: null });
  const [stream, setStream] = useState(null);
  const [active, setActive] = useState(null);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [viewers, setViewers] = useState(0);
  const [reconnecting, setReconnecting] = useState(false);

  const release = useCallback(() => {
    const current = resources.current;
    current.action?.abort();
    current.stream?.getTracks().forEach(track => track.stop());
    if (current.sessionId) void closeLiveConnection(liveSessionPath(current.sessionId));
    resources.current = { stream: null, sessionId: null, action: null };
  }, []);

  const end = useCallback((message = '') => {
    release();
    setActive(null);
    setStream(null);
    setPending('');
    setViewers(0);
    setReconnecting(false);
    setError(message);
  }, [release]);

  useEffect(() => {
    const onHide = () => end();
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); release(); };
  }, [end, release]);

  useEffect(() => {
    if (!active || !stream) return;
    const controller = new AbortController();
    broadcastLive(active, stream, controller.signal, { onViewers: setViewers, onReconnect: setReconnecting, onEnd: end });
    return () => controller.abort();
  }, [active, stream, end]);

  async function preview() {
    const current = resources.current;
    if (current.action) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setError('Open this page in a browser that supports live video and camera access.');
      return;
    }
    const controller = new AbortController();
    current.action = controller;
    setPending('preview');
    setError('');
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24, max: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (controller.signal.aborted) return media.getTracks().forEach(track => track.stop());
      current.stream = media;
      setMicOn(true);
      setCameraOn(true);
      setStream(media);
      for (const track of media.getTracks()) track.addEventListener('ended', () => {
        if (resources.current.stream === media) end('Camera or microphone access was lost. Preview again to restart.');
      }, { once: true });
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure.name === 'NotAllowedError' ? 'Allow camera and microphone access in your browser to go live.'
        : 'Couldn’t open your camera and microphone. Check your devices and try again.');
    } finally {
      if (!controller.signal.aborted) { current.action = null; setPending(''); }
    }
  }

  async function start(event) {
    event.preventDefault();
    const current = resources.current;
    if (!current.stream || current.action) return;
    const controller = new AbortController();
    current.action = controller;
    // Retrying after a lost response returns the same room and invite link.
    current.sessionId ||= window.crypto.randomUUID();
    setPending('start');
    setError('');
    try {
      const { data } = await client.post(`${LIVE_API}/sessions`, { sessionId: current.sessionId, title }, { signal: controller.signal });
      if (!controller.signal.aborted) setActive(data);
    } catch (failure) {
      if (!controller.signal.aborted) setError(errorMessage(failure, 'Couldn’t start your session. Try again.'));
    } finally {
      if (!controller.signal.aborted) { current.action = null; setPending(''); }
    }
  }

  function toggleMedia(kind) {
    const [track] = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
    if (!track) return;
    track.enabled = !track.enabled;
    (kind === 'audio' ? setMicOn : setCameraOn)(track.enabled);
  }

  return <div className="get-ready-studio">
    <div className="get-ready-video-card">
      <LiveVideo stream={stream} preview placeholder="Preview your camera to start" />
      <div className="get-ready-video-bar">
        <span className={active ? 'get-ready-live-badge' : 'get-ready-preview-label'} role="status">
          {active ? (reconnecting ? 'Reconnecting…' : 'Live') : (stream ? 'Camera preview' : 'Camera off')}
        </span>
        {stream && <div className="get-ready-device-controls">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => toggleMedia('audio')}>
            {micOn ? <Mic size={17} aria-hidden="true" /> : <MicOff size={17} aria-hidden="true" />}{micOn ? 'Mute mic' : 'Unmute mic'}
          </button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => toggleMedia('video')}>
            {cameraOn ? <Video size={17} aria-hidden="true" /> : <VideoOff size={17} aria-hidden="true" />}{cameraOn ? 'Turn camera off' : 'Turn camera on'}
          </button>
        </div>}
      </div>
    </div>
    <section className="get-ready-panel" aria-label={active ? 'Live session controls' : 'Set up live session'}>
      {active ? <>
        <div><h2>{active.session.title}</h2><p role="status">{viewers} of {active.session.viewerLimit} viewers connected</p></div>
        <InviteControls inviteToken={active.inviteToken} title={active.session.title} />
        <button type="button" className="get-ready-end btn" onClick={() => end()}><Square size={16} aria-hidden="true" />End live session</button>
      </> : <form className="get-ready-form" onSubmit={start}>
        <h2>Start a live session</h2>
        <label htmlFor="get-ready-title">Session title</label>
        <input id="get-ready-title" className="form-input" placeholder={PAGE_TITLE} maxLength={100} value={title} onChange={event => setTitle(event.target.value)} />
        {!stream ? <button type="button" className="btn btn-primary" onClick={preview} disabled={Boolean(pending)}>
          <Video size={18} aria-hidden="true" />{pending === 'preview' ? 'Opening camera…' : 'Preview camera'}
        </button> : <div className="get-ready-actions">
          <button type="submit" className="btn btn-primary" disabled={Boolean(pending)}><Radio size={18} aria-hidden="true" />{pending === 'start' ? 'Starting…' : 'Go live'}</button>
          <button type="button" className="btn btn-outline" disabled={Boolean(pending)} onClick={() => end()}>Cancel preview</button>
        </div>}
      </form>}
      {error && <p className="get-ready-error" role="alert">{error}</p>}
    </section>
  </div>;
}

function GuestStudio({ token }) {
  const resources = useRef(null);
  const [session, setSession] = useState(null);
  const [stream, setStream] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  const release = useCallback(() => {
    const current = resources.current;
    resources.current = null;
    current?.controller.abort();
    if (current?.path) void closeLiveConnection(current.path);
  }, []);

  const leave = useCallback((message = '') => {
    release();
    setStream(null);
    setStatus('ready');
    setError(message);
  }, [release]);

  useEffect(() => {
    const onHide = () => leave();
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); release(); };
  }, [leave, release]);

  useEffect(() => {
    const controller = new AbortController();
    const unavailable = 'This live session has ended or the invitation is unavailable.';
    if (!INVITE_TOKEN.test(token)) { setStatus('unavailable'); setError(unavailable); return; }
    setStatus('loading');
    setError('');
    void client.post(`${LIVE_API}/invite`, { inviteToken: token }, { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted) { setSession(data.session); setStatus('ready'); }
    }).catch(failure => {
      if (!controller.signal.aborted) {
        setStatus([404, 409].includes(failure?.response?.status) ? 'unavailable' : 'retry');
        setError(errorMessage(failure, 'Couldn’t open this invitation. Try again.'));
      }
    });
    return () => controller.abort();
  }, [token, retry]);

  async function join() {
    if (resources.current) return;
    if (!window.RTCPeerConnection) { setError('Open this link in a browser that supports live video.'); return; }
    const controller = new AbortController();
    const viewerId = window.crypto.randomUUID();
    resources.current = { controller, path: liveViewerPath(session.id, viewerId) };
    setStatus('joining');
    setError('');
    try {
      const { data } = await client.post(`${LIVE_API}/join`, { inviteToken: token, viewerId }, { signal: controller.signal });
      await watchLive(resources.current?.path, data.iceServers, controller.signal, { onStream: setStream, onStatus: setStatus, onEnd: leave });
    } catch (failure) {
      if (!controller.signal.aborted) leave(errorMessage(failure, 'Couldn’t join the session. Try again.'));
    }
  }

  const joined = ['joining', 'watching', 'reconnecting'].includes(status);
  const stage = status === 'joining' ? 'Connecting to the host…' : status === 'reconnecting' ? 'Reconnecting to the host…' : 'Video will appear here when you join';
  return <div className="get-ready-studio">
    <div className="get-ready-video-card"><LiveVideo stream={stream} placeholder={stage} /></div>
    <section className="get-ready-panel" aria-label="Live invitation">
      <div>
        <h2>{session?.title || 'Live invitation'}</h2>
        {session && <p>Hosted by {session.hostName}</p>}
      </div>
      {status === 'loading' && <p role="status">Checking invitation…</p>}
      {error && <p className="get-ready-error" role="alert">{error}</p>}
      {status === 'retry' && <button type="button" className="btn btn-primary" onClick={() => setRetry(value => value + 1)}>Try again</button>}
      {status === 'ready' && <button type="button" className="btn btn-primary" onClick={join}><Radio size={18} aria-hidden="true" />Join live</button>}
      {joined && <>
        <p role="status">{status === 'watching' ? 'Watching live' : stage}</p>
        <button type="button" className="btn btn-outline" onClick={() => leave()}><LogOut size={17} aria-hidden="true" />Leave session</button>
      </>}
      {!joined && <Link className="get-ready-back" to="/get-ready-with-us">Start your own session</Link>}
    </section>
  </div>;
}

export default function GetReadyWithUs() {
  const { hash } = useLocation();
  const token = new URLSearchParams(hash.slice(1)).get('join');
  return <Layout wide>
    <Helmet><title>{PAGE_TITLE} | UFIconnect</title><meta name="robots" content="noindex, follow" /></Helmet>
    <div className="get-ready-page">
      <header className="get-ready-header">
        <span className="get-ready-header-icon" aria-hidden="true"><Radio size={28} /></span>
        <div><h1>{PAGE_TITLE}</h1>{token === null && <p>Go live and invite people to watch.</p>}</div>
      </header>
      {token === null ? <HostStudio /> : <GuestStudio key={token} token={token} />}
    </div>
  </Layout>;
}
