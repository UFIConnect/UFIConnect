import { safePostLink } from '../../../backend/post-links.mjs';
import { directMediaPlaybackAllowed, officialYouTubeId } from '../utils/sourceMediaPolicy.mjs';

export const SNAP_MAX_CAPTION = 500;
export const SNAP_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const SNAP_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const SNAP_MAX_VIDEO_SECONDS = 60;

// A favorite source keeps its position while refreshing. Sources outside that
// list follow in order of their newest active snap; no fabricated rating is
// assigned to an author or to a provider that has no active stories.
export function rankSnapGroups(items, favorites = [], now = Date.now()) {
  const priorities = new Map();
  for (const source of Array.isArray(favorites) ? favorites : []) {
    if (typeof source === 'string' && !priorities.has(source)) priorities.set(source, priorities.size);
  }
  const seen = new Set(), groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.id || typeof item.source !== 'string'
      || !['image', 'video'].includes(item.mediaType) || !safePostLink(item.mediaUrl)) continue;
    const expiry = new Date(item.expiresAt).getTime();
    if (!Number.isFinite(expiry) || expiry <= now) continue;
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!groups.has(item.source)) groups.set(item.source, { source: item.source, items: [], favorite: priorities.has(item.source) });
    groups.get(item.source).items.push(item);
  }
  const created = item => new Date(item.createdAt).getTime() || 0;
  for (const group of groups.values()) group.items.sort((a, b) => created(b) - created(a) || String(a.id).localeCompare(String(b.id)));
  return [...groups.values()].sort((a, b) => {
    const priorityA = priorities.get(a.source) ?? Infinity, priorityB = priorities.get(b.source) ?? Infinity;
    if (priorityA !== priorityB) return priorityA < priorityB ? -1 : 1;
    return created(b.items[0]) - created(a.items[0]) || a.source.localeCompare(b.source);
  });
}

export function snapTimeRemaining(expiresAt, now = Date.now()) {
  const remaining = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return 'Expired';
  return remaining < 3_600_000 ? `${Math.max(1, Math.ceil(remaining / 60_000))}m left`
    : `${Math.ceil(remaining / 3_600_000)}h left`;
}

export function isExternalSnap(snap) {
  return snap?.isExternal === true || (typeof snap?.source === 'string' && snap.source !== 'uficonnect');
}

export function snapDurationLabel(seconds) {
  const duration = Math.round(Number(seconds));
  if (!Number.isFinite(duration) || duration <= 0) return '';
  return duration < 60 ? `${duration}s` : `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
}

export function snapAvailabilityLabel(snap, now = Date.now()) {
  if (!isExternalSnap(snap)) return snapTimeRemaining(snap?.expiresAt, now);
  const labels = ['Recent source clip'];
  const duration = snapDurationLabel(snap.videoDurationSeconds);
  if (duration) labels.push(duration);
  const published = new Date(snap.createdAt);
  if (snap.createdAt && Number.isFinite(published.getTime())) {
    labels.push(published.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }));
  }
  return labels.join(' · ');
}

export function normalizeSnapSourceErrors(errors) {
  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) return {};
  return Object.fromEntries(Object.entries(errors).flatMap(([source, error]) => {
    const message = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : '';
    return /^[a-z][a-z0-9_-]{0,79}$/.test(source) && message.trim() ? [[source, message.trim().slice(0, 240)]] : [];
  }));
}

export function snapPlaybackInfo(snap) {
  const safeHttps = value => {
    const safe = safePostLink(value);
    return safe && new URL(safe).protocol === 'https:' ? safe : null;
  };
  const mediaUrl = safeHttps(snap?.mediaUrl);
  const original = safeHttps(snap?.sourceUrl);
  const poster = safeHttps(snap?.thumbnailUrl);
  if (snap?.mediaType !== 'video') return { kind: 'image', mediaUrl, original, poster };
  if (snap.mediaKind === 'youtube' || snap.source === 'youtube') {
    const id = officialYouTubeId(mediaUrl) || officialYouTubeId(original);
    if (id && (!snap.embedId || snap.embedId === id)) return { kind: 'youtube', id, original, poster };
    return { kind: 'source', original, poster };
  }
  if (snap.mediaKind === 'source') return { kind: 'source', original, poster };
  if (mediaUrl && directMediaPlaybackAllowed(snap)) {
    return { kind: snap.mediaKind === 'hls' || /\.m3u8(?:[?#]|$)/i.test(mediaUrl) ? 'hls' : 'file', mediaUrl, original, poster };
  }
  return { kind: 'source', original, poster };
}

export function snapFileError(file) {
  if (!file) return 'Choose a photo or video.';
  if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return file.size > SNAP_MAX_IMAGE_BYTES ? 'Photos must be 10 MB or smaller.' : '';
  }
  if (['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type)) {
    return file.size > SNAP_MAX_VIDEO_BYTES ? 'Videos must be 100 MB or smaller.' : '';
  }
  return 'Choose a JPG, PNG or WebP photo, or an MP4, WebM or MOV video.';
}
