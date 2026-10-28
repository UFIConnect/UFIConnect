(() => {
  'use strict';
  const params = new URLSearchParams(window.location.search);
  const slug = params.get('clip') || '';
  const player = document.getElementById('player');
  const status = document.getElementById('status');
  const reload = document.getElementById('reload');
  const original = document.getElementById('original');
  const title = document.getElementById('clip-title');
  const creator = document.getElementById('creator');
  let requested = false;

  // Twitch requires at least 400 x 300 CSS pixels. Fit the whole player into
  // narrower mobile displays instead of clipping its official controls.
  const viewport = document.querySelector('meta[name="viewport"]');
  function fitViewport() {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const landscape = window.matchMedia('(orientation: landscape)').matches;
    const edges = [window.screen.width, window.screen.height].filter(n => Number.isFinite(n) && n > 0);
    const physicalWidth = edges.length ? (landscape ? Math.max(...edges) : Math.min(...edges)) : 400;
    const width = Math.max(400, physicalWidth);
    viewport.content = `width=${width}, initial-scale=${Math.min(1, physicalWidth / width)}`;
  }
  fitViewport();
  window.addEventListener('orientationchange', () => window.setTimeout(fitViewport, 100));

  function optionalText(value, maximum) {
    return String(value || '').replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
  }
  const label = optionalText(params.get('title'), 160);
  const author = optionalText(params.get('creator'), 80);
  if (label) title.textContent = label;
  if (author) { creator.textContent = `Clip by ${author} on Twitch`; creator.hidden = false; }

  // Only clip IDs are accepted. Never accept a caller-supplied URL, parent,
  // script, source origin, or redirect destination.
  if (params.getAll('clip').length !== 1 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(slug)
      || !/^[a-z0-9.-]+$/i.test(window.location.hostname)) {
    status.textContent = 'This Twitch clip link is invalid. Return to UFIconnect and open the clip again.';
    player.hidden = true;
    return;
  }
  const source = new URL('https://clips.twitch.tv/');
  source.pathname = '/' + slug;
  original.href = source.href;
  original.hidden = false;

  function stop() {
    if (!player.querySelector('iframe')) return;
    player.replaceChildren();
    requested = false;
    reload.hidden = false;
    reload.textContent = 'Resume Twitch clip';
    status.textContent = 'Playback stopped while this player was in the background.';
  }
  function showPlayer() {
    if (document.hidden || requested) return;
    requested = true;
    const embed = new URL('https://clips.twitch.tv/embed');
    embed.searchParams.set('clip', slug);
    embed.searchParams.set('parent', window.location.hostname);
    embed.searchParams.set('autoplay', 'false');
    const iframe = document.createElement('iframe');
    iframe.src = embed.href;
    iframe.title = label ? `${label} — Twitch player` : 'Twitch clip player';
    iframe.width = '400';
    iframe.height = '300';
    iframe.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'origin';
    iframe.addEventListener('error', () => {
      status.textContent = 'The Twitch player could not load. Reload it or use the original clip link.';
    });
    player.replaceChildren(iframe);
    reload.hidden = false;
    reload.textContent = 'Reload Twitch player';
    status.textContent = 'Tap play in the Twitch player to watch. Twitch’s playback and fullscreen controls are available in the player.';
  }
  reload.addEventListener('click', () => { player.replaceChildren(); requested = false; showPlayer(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  // Loading the frame does not start playback. Mobile playback starts only
  // with a gesture on Twitch's own controls, which stay fully unobscured.
  showPlayer();
})();
