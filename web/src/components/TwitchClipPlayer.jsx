import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Play, Square } from 'lucide-react';
import BrandIcon from './BrandIcon';
import { isNativeRuntime } from '../nativeRuntime.mjs';
import { openNativeTwitchPlayer } from '../nativeTwitchPlayer.mjs';
import { useSoloVideoPlayback, useGlobalMuted } from './videoMedia';
import { useDataPreferences, previewPlaybackAllowed } from '../preferences';
import { officialTwitchClipEmbedUrl, officialTwitchClipUrl, officialTwitchPosterUrl } from '../utils/sourceMediaPolicy.mjs';
import './TwitchClipPlayer.css';

// Clips have no interactive Twitch JS API. Removing the official iframe stops
// playback. Start only the visible eligible clip; explicit Close stays stopped.
export default function TwitchClipPlayer({ post, title, forcePause = false, controlsTarget }) {
  const host = useRef(null), stage = useRef(null), started = useRef(null), playerId = useId();
  const automatic = useRef(new Set());
  const [muted] = useGlobalMuted();
  const preferences = useDataPreferences();
  const autoplayAllowed = controlsTarget !== undefined || previewPlaybackAllowed(preferences);
  const original = post?.source === 'twitch' ? officialTwitchClipUrl(post.sourceUrl) || officialTwitchClipUrl(post.mediaUrl) : null;
  const hostedPlayer = original ? `https://uficonnect.org/twitch-player.html?clip=${encodeURIComponent(new URL(original).pathname.slice(1))}` : null;
  const embed = original && !isNativeRuntime() && typeof window !== 'undefined' ? officialTwitchClipEmbedUrl(original, window.location.hostname) : null;
  const poster = officialTwitchPosterUrl(post?.mediaPoster) || officialTwitchPosterUrl(post?.thumbnailUrl);
  const [width, setWidth] = useState(0), [inView, setInView] = useState(false);
  const [requested, setRequested] = useState(null), [failed, setFailed] = useState(null), [failedPoster, setFailedPoster] = useState(null);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const [modalBlocked, setModalBlocked] = useState(false);
  const [nativeOpening, setNativeOpening] = useState(false), [nativeError, setNativeError] = useState('');
  const native = isNativeRuntime();
  const eligible = !!embed && requested === original && width >= 400 && inView && visible && !forcePause && !modalBlocked;
  const solo = useSoloVideoPlayback(`twitch-clip-${playerId}`, eligible, stage);
  const playing = eligible && solo && failed !== original;

  useEffect(() => {
    if (embed && autoplayAllowed && width >= 400 && inView && visible && !forcePause && !modalBlocked && !automatic.current.has(original)) {
      automatic.current.add(original); setRequested(original);
    }
  }, [embed, autoplayAllowed, width, inView, visible, forcePause, modalBlocked, original]);

  useEffect(() => {
    const node = stage.current;
    if (!node) return undefined;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setWidth(node.clientWidth);
      if (node.clientWidth < 400) setRequested(null);
      if (typeof IntersectionObserver === 'undefined') {
        const onScreen = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
        setInView(onScreen); if (!onScreen) setRequested(null);
      }
    };
    measure();
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    resize?.observe(node);
    const intersection = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting); if (!entry.isIntersecting) setRequested(null);
    }, { threshold: 0.01 }) : null;
    intersection?.observe(node);
    window.addEventListener('resize', measure);
    if (!intersection) window.addEventListener('scroll', measure, { passive: true });
    const visibility = () => { setVisible(!document.hidden); if (document.hidden) setRequested(null); };
    document.addEventListener('visibilitychange', visibility);
    const checkModals = () => {
      const blocked = [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')]
        .some(modal => modal.getClientRects().length && !modal.contains(node));
      setModalBlocked(blocked); if (blocked) setRequested(null);
    };
    checkModals();
    const modals = new MutationObserver(checkModals);
    modals.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'aria-modal'] });
    return () => {
      resize?.disconnect(); intersection?.disconnect(); modals.disconnect();
      window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [original]);
  useEffect(() => { if (forcePause || modalBlocked || !visible) setRequested(null); }, [forcePause, modalBlocked, visible]);
  useEffect(() => {
    if (!eligible) started.current = null;
    else if (solo) started.current = original;
    else if (started.current === original) setRequested(null);
  }, [eligible, solo, original]);

  if (!original) return null;
  const openInApp = async event => {
    event.preventDefault(); event.stopPropagation();
    if (nativeOpening) return;
    setNativeOpening(true); setNativeError('');
    try { await openNativeTwitchPlayer({ url: original, title: title || post.title,
      creator: post.author?.name || post.author?.username || post.authorName || post.sourceAccountName }); }
    catch (error) { setNativeError(error.message || 'The Twitch player could not open. Please try again.'); }
    finally { setNativeOpening(false); }
  };
  const commands = <div className="twitch-clip-commands" role="group" aria-label="Twitch clip controls">
    {native && <button type="button" className="twitch-clip-play" onClick={openInApp}
      disabled={nativeOpening || forcePause || modalBlocked || !visible || !inView}>
      <BrandIcon platform="twitch" size={17} />{nativeOpening ? 'Opening Twitch player…' : 'Play Twitch clip'}</button>}
    {nativeError && <span className="twitch-clip-error" role="status">{nativeError}</span>}
    {playing ? <button type="button" className="twitch-clip-play" onClick={() => setRequested(null)}>
      <Square size={17} aria-hidden="true" />Close Twitch player</button>
      : embed && width >= 400 && failed !== original && <button type="button" className="twitch-clip-play" disabled={forcePause || modalBlocked || !visible || !inView}
        onClick={() => setRequested(original)}><Play size={19} aria-hidden="true" />Play Twitch clip</button>}
    {failed === original && <span className="twitch-clip-error" role="status">This clip could not load. Open its UFIconnect player to try again.</span>}
    {(!embed || width > 0 && width < 400) && <span className="twitch-clip-notice">
      Watch here in UFIconnect with Twitch’s player.
    </span>}
    {!native && (!embed || width > 0 && width < 400 || failed === original)
      && <a className="twitch-clip-play" href={hostedPlayer} onClick={event => event.stopPropagation()}>
        <Play size={17} aria-hidden="true" />Play Twitch clip</a>}
  </div>;
  return <div ref={host} className="twitch-clip-player" data-embedding={playing ? 'true' : 'false'}>
    <div ref={stage} className="twitch-clip-stage">
      {playing ? <iframe src={`${embed.replace('autoplay=false', 'autoplay=true')}&muted=${muted ? 'true' : 'false'}`} title={title || post.title || 'Twitch clip'} width="400" height="300"
        allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
        onError={() => { setFailed(original); setRequested(null); }} />
        : <>{poster && failedPoster !== poster ? <img src={poster} alt={title || post.title || 'Twitch clip preview'} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedPoster(poster)} />
          : <div className="twitch-clip-placeholder" aria-hidden="true"><BrandIcon platform="twitch" size={42} /></div>}
          </>}
    </div>
    {controlsTarget !== undefined ? controlsTarget && createPortal(commands, controlsTarget) : <>
      {commands}
      <div className="twitch-clip-source"><span className="twitch-clip-watermark"><BrandIcon platform="twitch" size={16} />Twitch</span>
        <a href={original} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} aria-hidden="true" />Watch on Twitch</a></div>
    </>}
  </div>;
}
