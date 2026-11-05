import { forwardRef, useEffect, useLayoutEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X, Globe2, Users, Video, ImagePlus, RotateCcw, Trash2 } from 'lucide-react';
import SnapCameraControls from './SnapCameraControls';
import SnapAvatar from './SnapAvatar';
import { safePostLink } from '../../../backend/post-links.mjs';
import { uploadMedia } from '../api/upload';
import { isNativeRuntime } from '../nativeRuntime.mjs';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import { useSnapCamera } from '../hooks/useSnapCamera';
import { SNAP_MAX_CAPTION, SNAP_MAX_VIDEO_SECONDS, snapFileError } from './snapRanking.mjs';
import { SNAP_FILTERS, SNAP_MAX_OVERLAY, snapFilterStyle } from './snapEffects.mjs';

function videoDuration(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const timer = window.setTimeout(() => finish(new Error('Could not read this video. Try an MP4 file.')), 10_000);
    function finish(error, duration) {
      window.clearTimeout(timer);
      video.onloadedmetadata = null; video.onerror = null;
      video.removeAttribute('src'); video.load();
      if (error) reject(error); else resolve(duration);
    }
    video.preload = 'metadata';
    video.onloadedmetadata = () => finish(null, video.duration);
    video.onerror = () => finish(new Error('Could not read this video. Try an MP4 file.'));
    video.src = url;
  });
}

const SnapComposer = forwardRef(function SnapComposer({ profile, onClose, onPublish }, ref) {
  const dialog = useRef(null), mounted = useRef(true), selection = useRef(0), uploaded = useRef(null);
  const photoInput = useRef(null), videoInput = useRef(null), galleryInput = useRef(null);
  const titleId = useId(), captionId = useId(), overlayId = useId();
  const [caption, setCaption] = useState(''), [overlayText, setOverlayText] = useState(''), [filter, setFilter] = useState('original');
  const [visibility, setVisibility] = useState('public'), [preview, setPreview] = useState(null);
  const [validating, setValidating] = useState(false), [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0), [publishing, setPublishing] = useState(false), [error, setError] = useState('');
  const [facing, setFacing] = useState('user'), [mirrorOverride, setMirrorOverride] = useState(null), [fillCamera, setFillCamera] = useState(true);
  const busy = uploading || publishing;
  const captionRequired = preview?.type === 'video';
  const author = profile?.name || 'UFIConnect member';
  const camera = useSnapCamera(selectFile, setError, profile?.id);
  const wasCameraActive = useRef(false);
  useLayoutEffect(() => {
    const returning = wasCameraActive.current && !camera.active;
    wasCameraActive.current = camera.active;
    if (returning && dialog.current?.open) dialog.current.querySelector('header button')?.focus({ preventScroll: true });
  }, [camera.active]);
  const mirrorSupported = camera.mode === 'photo' || typeof window !== 'undefined' && typeof window.HTMLCanvasElement?.prototype.captureStream === 'function';
  const previewMirrored = mirrorOverride ?? camera.mirrored;
  const mirror = mirrorSupported && previewMirrored;
  useLockBodyScroll();
  useImperativeHandle(ref, () => ({ openCamera }));
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { mounted.current = false; selection.current++; previous?.isConnected && previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview?.url]);

  async function selectFile(file, knownDuration) {
    if (busy) return;
    const fileError = snapFileError(file);
    if (fileError) { setError(fileError); return; }
    camera.stop();
    const id = ++selection.current;
    const next = { url: URL.createObjectURL(file), type: file.type.startsWith('video/') ? 'video' : 'image', file };
    uploaded.current = null;
    setPreview(next); setProgress(0); setError(''); setValidating(true);
    try {
      if (next.type === 'video') {
        const duration = knownDuration ?? await videoDuration(next.url);
        if (!Number.isFinite(duration) || duration <= 0 || duration > SNAP_MAX_VIDEO_SECONDS) throw new Error(`Snap videos must be ${SNAP_MAX_VIDEO_SECONDS} seconds or shorter.`);
      }
      if (mounted.current && selection.current === id) setPreview({ ...next, valid: true });
    } catch (failure) {
      if (mounted.current && selection.current === id) setError(failure.message || 'Could not read this snap. Please try another file.');
    } finally { if (mounted.current && selection.current === id) setValidating(false); }
  }
  function removeMedia() {
    selection.current++; uploaded.current = null; camera.stop();
    setPreview(null); setValidating(false); setError(''); setProgress(0);
  }
  function deleteDraft() {
    removeMedia(); setCaption(''); setOverlayText(''); setFilter('original');
  }
  function openCamera(mode = 'photo') {
    if (busy) return;
    setError('');
    if (isNativeRuntime()) {
      camera.stop();
      // Called synchronously from a trusted click, including the rail camera tile.
      (mode === 'video' ? videoInput : photoInput).current?.click();
    } else { removeMedia(); camera.open(mode, facing); }
  }
  function fileChanged(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (file) selectFile(file);
  }
  async function publish(event) {
    event.preventDefault();
    if (busy || validating || !preview?.valid || (captionRequired && !caption.trim())) return;
    setPublishing(true); setError('');
    try {
      if (!uploaded.current) {
        setUploading(true);
        uploaded.current = await uploadMedia(preview.file, fraction => { if (mounted.current) setProgress(fraction); }, 'snaps');
        if (!mounted.current) return;
        setUploading(false);
      }
      const media = uploaded.current;
      await onPublish({ mediaUrl: media.url, mediaType: media.type, caption: caption.trim(), visibility, upload: media.upload,
        filter, overlayText: overlayText.trim() });
      if (mounted.current) onClose();
    } catch (failure) {
      if (mounted.current) setError(failure.response?.data?.message || failure.message || 'Could not publish this snap. Please try again.');
    } finally { if (mounted.current) { setUploading(false); setPublishing(false); } }
  }
  return createPortal(<dialog ref={dialog} className={`snap-composer${camera.active ? ' snap-composer-camera' : ''}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (camera.active) { if (camera.recording) camera.stopRecording(); else camera.stop(); } else if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form onSubmit={publish}>
      <header><div><h2 id={titleId}><Camera size={20} />Post a snap</h2><p>Your photo or video disappears after 24 hours.</p></div><button type="button" className="snap-dialog-icon" onClick={onClose} disabled={busy} aria-label="Close snap composer"><X size={20} /></button></header>
      <div className="snap-composer-owner snap-social-header" aria-label={`Posting as ${author}`}>
        <SnapAvatar urls={[safePostLink(profile?.avatarUrl)]} member className="post-chrome-avatar" />
        <div className="snap-social-identity post-chrome-identity"><span className="post-chrome-who"><strong className="snap-social-name post-chrome-name">{author}</strong>
          <span className="snap-social-meta">UFIConnect · {visibility === 'followers' ? <><Users size={13} aria-hidden="true" />Followers</> : <><Globe2 size={13} aria-hidden="true" />Public</>}</span>
        </span></div>
      </div>
      <div className="snap-capture-stage">
      <div className="snap-composer-media">
        {camera.active ? <video ref={camera.videoRef} className="snap-camera-preview" autoPlay muted playsInline aria-label="Live camera preview" style={{ ...snapFilterStyle(filter), transform: previewMirrored ? 'scaleX(-1)' : undefined, objectFit: fillCamera ? 'cover' : 'contain' }} />
          : preview ? preview.type === 'video' ? <video src={preview.url} controls playsInline preload="metadata" style={snapFilterStyle(filter)} />
          : <img src={preview.url} alt="Your snap preview" style={snapFilterStyle(filter)} />
          : <div className="snap-composer-placeholder"><Camera size={36} /><strong>Share a moment</strong><span>Take a photo, record a video, or choose from your gallery.</span></div>}
        {overlayText.trim() && (preview || camera.active) && <span className="snap-text-overlay">{overlayText.trim()}</span>}
      </div>
      {camera.active && <SnapCameraControls camera={camera} accountId={profile?.id} mirror={mirror} mirrorSupported={mirrorSupported}
        onMirror={() => setMirrorOverride(!mirror)} onSwitch={() => { const next = camera.facing === 'user' ? 'environment' : 'user'; setFacing(next); setMirrorOverride(null); camera.open(camera.mode, next); }}
        onMode={mode => { if (mode !== camera.mode) openCamera(mode); }} onClose={onClose} onGallery={() => { camera.stop(); galleryInput.current?.click(); }}
        filter={filter} onFilter={setFilter} overlayText={overlayText} onText={setOverlayText} fill={fillCamera} onFill={() => setFillCamera(value => !value)} error={error} />}
      </div>
      <input ref={photoInput} type="file" accept="image/*" capture="environment" hidden onChange={fileChanged} aria-label="Take a snap photo" />
      <input ref={videoInput} type="file" accept="video/*" capture="environment" hidden onChange={fileChanged} aria-label="Record a snap video" />
      <input ref={galleryInput} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" hidden onChange={fileChanged} aria-label="Choose snap media" />
      <div className="snap-composer-file">
        <button type="button" className="btn btn-outline btn-sm" disabled={busy || camera.recording} onClick={() => openCamera('photo')}><Camera size={16} />Photo</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy || camera.recording} onClick={() => openCamera('video')}><Video size={16} />Video</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={busy || camera.recording} onClick={() => { camera.stop(); galleryInput.current?.click(); }}><ImagePlus size={16} />Gallery</button>
        {preview && <><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => openCamera(preview.type === 'video' ? 'video' : 'photo')}><RotateCcw size={16} />Retake</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={deleteDraft}><Trash2 size={16} />Delete draft</button></>}
      </div>
      <p className="snap-composer-limits">Photos up to 10 MB · Videos up to 100 MB and {SNAP_MAX_VIDEO_SECONDS}s. Uploads start when you post.</p>
      {validating && <p role="status" className="snap-composer-limits">Checking your video…</p>}
      {uploading && <div className="snap-upload-progress" role="status"><progress max="100" value={Math.round(progress * 100)} /><span>Uploading {Math.round(progress * 100)}%</span></div>}
      <fieldset className="snap-filters" disabled={busy}><legend>Filter</legend><div>{SNAP_FILTERS.map(option => <button type="button" key={option.id} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>{option.label}</button>)}</div></fieldset>
      <label htmlFor={overlayId}>Text on your snap</label><input id={overlayId} className="snap-overlay-input" value={overlayText} maxLength={SNAP_MAX_OVERLAY} disabled={busy} placeholder="Add a text caption" onChange={event => setOverlayText(event.target.value)} />
      <div className="snap-caption-count">{overlayText.length} / {SNAP_MAX_OVERLAY}</div>
      <label htmlFor={captionId}>{captionRequired ? 'Description (required for videos)' : 'Description (optional)'}</label><textarea id={captionId} value={caption} maxLength={SNAP_MAX_CAPTION} rows={2} required={captionRequired} disabled={busy} placeholder="Describe your moment." onChange={event => setCaption(event.target.value)} />
      <div className="snap-caption-count">{caption.length} / {SNAP_MAX_CAPTION}</div>
      <fieldset disabled={busy} className="snap-visibility"><legend>Who can see this snap?</legend>
        <label><input type="radio" name={`${titleId}-visibility`} value="public" checked={visibility === 'public'} onChange={() => setVisibility('public')} /><Globe2 size={16} /><span><strong>Public</strong><small>Anyone who can view your profile</small></span></label>
        <label><input type="radio" name={`${titleId}-visibility`} value="followers" checked={visibility === 'followers'} onChange={() => setVisibility('followers')} /><Users size={16} /><span><strong>Followers</strong><small>People who follow you</small></span></label>
      </fieldset>
      {error && <p className="snap-composer-error" role="alert">{error}</p>}
      <footer><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || validating || !preview?.valid || (captionRequired && !caption.trim())}>{uploading ? 'Uploading…' : publishing ? 'Posting…' : 'Post snap'}</button></footer>
    </form>
  </dialog>, document.body);
});
export default SnapComposer;
