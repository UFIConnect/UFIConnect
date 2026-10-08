import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X, Globe2, Users } from 'lucide-react';
import PhotoPickerButton from './PhotoPickerButton';
import SnapAvatar from './SnapAvatar';
import { safePostLink } from '../../../backend/post-links.mjs';
import { uploadMedia } from '../api/upload';
import { useLockBodyScroll } from '../hooks/useLockBodyScroll';
import { SNAP_MAX_CAPTION, SNAP_MAX_VIDEO_SECONDS, snapFileError } from './snapRanking.mjs';

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

export default function SnapComposer({ profile, onClose, onPublish }) {
  const dialog = useRef(null), mounted = useRef(true);
  const titleId = useId(), captionId = useId();
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState('public');
  const [preview, setPreview] = useState(null);
  const [media, setMedia] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const busy = uploading || publishing;
  const captionRequired = preview?.type === 'video';
  const author = profile?.name || 'UFIConnect member';
  const authorAvatar = safePostLink(profile?.avatarUrl);
  useLockBodyScroll();
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { mounted.current = false; previous?.isConnected && previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => () => { if (preview?.url) URL.revokeObjectURL(preview.url); }, [preview]);

  async function selectFile(file) {
    if (busy) return;
    const fileError = snapFileError(file);
    if (fileError) { setError(fileError); return; }
    setError(''); setMedia(null); setProgress(0); setUploading(true);
    const nextPreview = { url: URL.createObjectURL(file), type: file.type.startsWith('video/') ? 'video' : 'image', name: file.name };
    setPreview(nextPreview);
    try {
      if (nextPreview.type === 'video') {
        const duration = await videoDuration(nextPreview.url);
        if (!Number.isFinite(duration) || duration <= 0 || duration > SNAP_MAX_VIDEO_SECONDS) throw new Error(`Snap videos must be ${SNAP_MAX_VIDEO_SECONDS} seconds or shorter.`);
      }
      if (!mounted.current) return;
      const uploaded = await uploadMedia(file, fraction => { if (mounted.current) setProgress(fraction); }, 'snaps');
      if (mounted.current) setMedia(uploaded);
    } catch (failure) {
      if (mounted.current) setError(failure.response?.data?.message || failure.message || 'Could not upload this snap. Please try again.');
    } finally { if (mounted.current) setUploading(false); }
  }
  function removeMedia() { setPreview(null); setMedia(null); setError(''); setProgress(0); }
  async function publish(event) {
    event.preventDefault();
    if (busy || !media?.url || (captionRequired && !caption.trim())) return;
    setPublishing(true); setError('');
    try {
      await onPublish({ mediaUrl: media.url, mediaType: media.type, caption: caption.trim(), visibility, upload: media.upload });
      if (mounted.current) onClose();
    } catch (failure) {
      if (mounted.current) {
        setError(failure.response?.data?.message || failure.message || 'Could not publish this snap. Please try again.');
        setPublishing(false);
      }
    }
  }
  return createPortal(<dialog ref={dialog} className="snap-composer" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <form onSubmit={publish}>
      <header><div><h2 id={titleId}><Camera size={20} />Post a snap</h2><p>Your photo or video disappears after 24 hours.</p></div><button type="button" className="snap-dialog-icon" onClick={onClose} disabled={busy} aria-label="Close snap composer"><X size={20} /></button></header>
      <div className="snap-composer-owner snap-social-header" aria-label={`Posting as ${author}`}>
          <SnapAvatar urls={[authorAvatar]} member className="post-chrome-avatar" />
        <div className="snap-social-identity post-chrome-identity"><span className="post-chrome-who">
          <strong className="snap-social-name post-chrome-name">{author}</strong>
          <span className="snap-social-meta"><span>UFIConnect</span><span aria-hidden="true"> · </span>{visibility === 'followers' ? <><Users size={13} aria-hidden="true" />Followers</> : <><Globe2 size={13} aria-hidden="true" />Public</>}</span>
        </span></div>
      </div>
      <div className="snap-composer-media">{preview ? preview.type === 'video'
        ? <video src={preview.url} controls playsInline preload="metadata" />
        : <img src={preview.url} alt="Your snap preview" />
        : <div className="snap-composer-placeholder"><Camera size={36} /><strong>Share a moment</strong><span>Add a photo or a video up to {SNAP_MAX_VIDEO_SECONDS} seconds.</span></div>}</div>
      <div className="snap-composer-file"><PhotoPickerButton onFileSelected={selectFile} accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" disabled={busy} label={preview ? 'Replace photo or video' : 'Add photo or video'} ariaLabel={preview ? 'Replace snap media' : 'Add snap media'} className="btn btn-outline btn-sm" />
        {preview && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={removeMedia}>Remove</button>}</div>
      <p className="snap-composer-limits">Photos up to 10 MB · Videos up to 100 MB</p>
      {uploading && <div className="snap-upload-progress" role="status"><progress max="100" value={Math.round(progress * 100)} /><span>{progress ? `Uploading ${Math.round(progress * 100)}%` : 'Preparing your snap…'}</span></div>}
      <label htmlFor={captionId}>{captionRequired ? 'Caption (required for videos)' : 'Caption (optional)'}</label><textarea id={captionId} value={caption} maxLength={SNAP_MAX_CAPTION} rows={2} required={captionRequired} disabled={publishing} placeholder={captionRequired ? 'Describe what’s in your video.' : 'What’s happening?'} onChange={event => setCaption(event.target.value)} />
      <div className="snap-caption-count">{caption.length} / {SNAP_MAX_CAPTION}</div>
      <fieldset disabled={publishing} className="snap-visibility"><legend>Who can see this snap?</legend>
        <label><input type="radio" name={`${titleId}-visibility`} value="public" checked={visibility === 'public'} onChange={() => setVisibility('public')} /><Globe2 size={16} /><span><strong>Public</strong><small>Anyone who can view your profile</small></span></label>
        <label><input type="radio" name={`${titleId}-visibility`} value="followers" checked={visibility === 'followers'} onChange={() => setVisibility('followers')} /><Users size={16} /><span><strong>Followers</strong><small>People who follow you</small></span></label>
      </fieldset>
      {error && <p className="snap-composer-error" role="alert">{error}</p>}
      <footer><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || !media?.url || (captionRequired && !caption.trim())}>{publishing ? 'Posting…' : uploading ? 'Uploading…' : 'Post snap'}</button></footer>
    </form>
  </dialog>, document.body);
}
