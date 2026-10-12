import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Play, Square } from 'lucide-react';
import BrandIcon from './BrandIcon';
import { useSoloVideoPlayback } from './videoMedia';
import { officialTwitchClipEmbedUrl, officialTwitchClipUrl, officialTwitchPosterUrl } from '../utils/sourceMediaPolicy.mjs';
import './TwitchClipPlayer.css';

// Clips have no interactive Twitch JS API. Removing the official iframe stops
// playback; returning to a card always requires another deliberate play click.
export default function TwitchClipPlayer({ post, title, forcePause = false, controlsTarget }) {
  const host = useRef(null), started = useRef(null), playerId = useId();
  const original = post?.source === 'twitch' ? officialTwitchClipUrl(post.sourceUrl) || officialTwitchClipUrl(post.mediaUrl) : null;
  const embed = original && typeof window !== 'undefined' ? officialTwitchClipEmbedUrl(original, window.location.hostname) : null;
  const poster = officialTwitchPosterUrl(post?.mediaPoster) || officialTwitchPosterUrl(post?.thumbnailUrl);
  const [width, setWidth] = useState(0), [inView, setInView] = useState(false);
  const [requested, setRequested] = useState(null), [failed, setFailed] = useState(null), [failedPoster, setFailedPoster] = useState(null);
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const [modalBlocked, setModalBlocked] = useState(false);
  const eligible = !!embed && requested === original && width >= 400 && inView && visible && !forcePause && !modalBlocked;
  const solo = useSoloVideoPlayback(`twitch-clip-${playerId}`, eligible);
  const playing = eligible && solo && failed !== original;

  useEffect(() => {
    const node = host.current;
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
  const commands = <div className="twitch-clip-commands" role="group" aria-label="Twitch clip controls">
    {playing ? <button type="button" className="twitch-clip-play" onClick={() => setRequested(null)}>
      <Square size={17} aria-hidden="true" />Close Twitch player</button>
      : embed && width >= 400 && failed !== original && <button type="button" className="twitch-clip-play" disabled={forcePause || modalBlocked || !visible}
        onClick={() => { setInView(true); setRequested(original); }}><Play size={19} aria-hidden="true" />Load Twitch player</button>}
    {failed === original && <span className="twitch-clip-error" role="status">This clip could not load. Open it on Twitch.</span>}
  </div>;
  return <div ref={host} className="twitch-clip-player" data-embedding={playing ? 'true' : 'false'}>
    <div className="twitch-clip-stage">
      {playing ? <iframe src={embed} title={title || post.title || 'Twitch clip'} width="400" height="300"
        allow="fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
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
