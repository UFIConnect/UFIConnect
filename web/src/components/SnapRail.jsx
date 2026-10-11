import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, RefreshCw, Star } from 'lucide-react';
import { sourceAuthorProfileUrl } from '../../../backend/post-links.mjs';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { SOURCE_META } from './sourceMeta';
import { rankSnapGroups, normalizeSnapSourceErrors } from './snapRanking.mjs';
import SnapComposer from './SnapComposer';
import SnapViewer from './SnapViewer';
import SnapAvatar, { snapAvatarUrls } from './SnapAvatar';
import ReportModal from './ReportModal';
import './SnapRail.css';

function groupSnapProfiles(items, source) {
  const profiles = new Map();
  for (const snap of items) {
    const authorId = snap.author?.id || snap.authorId;
    const profileUrl = sourceAuthorProfileUrl(snap);
    const identity = authorId ? `id:${String(authorId)}` : profileUrl ? `url:${profileUrl}` : `snap:${snap.id}`;
    const key = `${source}:${identity}`;
    if (!profiles.has(key)) profiles.set(key, { key, items: [] });
    profiles.get(key).items.push(snap);
  }
  return [...profiles.values()];
}

function SnapProfile({ group, onOpen, refreshKey }) {
  const snap = group.items[0];
  const author = snap.author?.name || 'UFIConnect member';
  const avatars = group.items.map(item => item.author?.avatarUrl);
  const count = group.items.length;
  return <button type="button" className="snap-profile-button" onClick={onOpen}
    data-snap-id={snap.id} data-snap-ids={JSON.stringify(group.items.map(item => item.id))} data-snap-author-key={group.key}
    aria-label={`View ${author}'s ${count === 1 ? 'snap' : `${count} snaps`}`} title={`${author} · ${count} ${count === 1 ? 'snap' : 'snaps'}`}>
    <span className="snap-profile-ring" aria-hidden="true"><SnapAvatar urls={avatars} source={snap.source} refreshKey={refreshKey} />
      {count > 1 && <span className="snap-profile-count">{count}</span>}</span>
    <span className="snap-profile-name">{author}</span>
  </button>;
}

// UFI and Following keep native posting. Home shows external source clips;
// unavailable providers never appear as populated groups.
export default function SnapRail({ mode = 'home', items = [], favorites = [], profile,
  loading = false, error = '', sourceErrors = {}, refreshingSources = [], onRefresh, onPostSnap, onDeleteSnap, notice = '' }) {
  const [now, setNow] = useState(Date.now);
  const [selectedId, setSelectedId] = useState(null);
  const [composing, setComposing] = useState(false);
  const [reportSnap, setReportSnap] = useState(null);
  const [photoRevisions, setPhotoRevisions] = useState({});
  const maxProfileRows = mode === 'home' || mode === 'following' ? 2 : 3;
  const groups = useMemo(() => {
    const ranked = rankSnapGroups(items, favorites, now);
    const external = ranked.filter(group => group.source !== 'uficonnect');
    if (mode === 'home') return external;
    const native = ranked.find(group => group.source === 'uficonnect')
      || { source: 'uficonnect', items: [], favorite: favorites.includes('uficonnect') };
    return [native, ...external];
  }, [mode, items, favorites, now]);
  const profileGroups = useMemo(() => groups.map(group => ({ ...group, profiles: groupSnapProfiles(group.items, group.source) })), [groups]);
  const activeItems = profileGroups.flatMap(group => group.profiles.flatMap(author => {
    const avatarUrls = snapAvatarUrls(author.items.map(item => item.author?.avatarUrl));
    return author.items.map(item => ({ ...item, author: { ...item.author, avatarUrls } }));
  }));
  const selectedIndex = activeItems.findIndex(snap => `${snap.source}:${snap.id}` === selectedId);
  const sourceFailures = Object.entries(normalizeSnapSourceErrors(sourceErrors));
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);
  useEffect(() => { setSelectedId(null); setComposing(false); setReportSnap(null); }, [mode, profile?.id]);
  useEffect(() => { if (selectedId && selectedIndex < 0) setSelectedId(null); }, [selectedId, selectedIndex]);
  async function publish(payload) {
    const result = await onPostSnap(payload);
    setNow(Date.now());
    return result;
  }
  async function refreshSource(source) {
    await onRefresh(source);
    // A deliberate refresh retries a transient photo failure once, even when
    // the source still returns the same image URL.
    setPhotoRevisions(current => ({ ...current, [source]: (current[source] || 0) + 1 }));
  }
  return <section className="snap-rail" aria-label="Snaps" data-snap-mode={mode}>
    {error && <p className="snap-rail-message snap-rail-error" role="alert">{error}</p>}
    {notice && <p className="snap-rail-message">{notice}</p>}
    {sourceFailures.length > 0 && <div className="snap-source-notices" role="status" aria-label="Snap source availability">
      <p>Some sources could not refresh.</p>
      <ul>{sourceFailures.map(([source, message]) => <li key={source}><strong>{SOURCE_META[source]?.label || source}</strong>: {message}</li>)}</ul>
    </div>}
    <div className="snap-rail-browser">
      <div className="snap-source-row" role="region" aria-label="Snap source profiles" aria-busy={loading}>
        {profileGroups.map(group => {
          const isNative = group.source === 'uficonnect';
          const source = isNative ? { ...SOURCE_META.uficonnect, label: 'UFI' } : SOURCE_META[group.source] || { label: group.source, icon: group.source.slice(0, 2) };
          const isRefreshing = refreshingSources.includes(group.source) || (loading && refreshingSources.length === 0);
          const refreshLabel = `Refresh ${source.label} snaps`;
          return <article key={group.source} className="snap-source-box" data-snap-source={group.source} style={{ '--snap-source-color': source.color || 'var(--primary)' }} aria-label={`${source.label} snaps`} aria-busy={isRefreshing}>
            <header className="snap-source-heading"><span className="snap-source-mark" aria-hidden="true">{hasBrandIcon(group.source) ? <BrandIcon platform={group.source} size={17} /> : <b>{source.icon}</b>}</span>
              <strong>{source.label}</strong>{group.items.length > 0 && <span className="snap-source-count">{group.items.length}</span>}
              {group.favorite && <Star className="snap-source-favorite" size={15} fill="currentColor" aria-label="Favorite source" />}
              <button type="button" className="snap-refresh-button" disabled={loading || !onRefresh} onClick={() => refreshSource(group.source)} aria-label={refreshLabel} title={refreshLabel} aria-busy={isRefreshing}><RefreshCw size={16} className={isRefreshing ? 'snap-refresh-spinning' : ''} /></button>
            </header>
            {group.items.length > 0
              ? <ul className="snap-source-items" role="list" aria-label={`${source.label} snap profiles`} style={{ '--snap-profile-rows': Math.min(maxProfileRows, group.profiles.length) }}>{group.profiles.map(author => <li key={author.key} className="snap-profile-item"><SnapProfile group={author} refreshKey={photoRevisions[group.source]} onOpen={() => setSelectedId(`${author.items[0].source}:${author.items[0].id}`)} /></li>)}</ul>
              : <div className="snap-source-empty" role="status" aria-live="polite"><Camera size={22} aria-hidden="true" /><span>{isRefreshing ? 'Loading UFI snaps...' : error || sourceErrors.uficonnect ? 'UFI snaps could not load. Try refreshing.' : 'No UFI snaps yet.'}</span></div>}
            {isNative && <div className="snap-source-compose">
              {profile?.id && onPostSnap
                ? <button type="button" className="snap-post-button" onClick={() => setComposing(true)}><Camera size={16} />Post snap</button>
                : !profile?.id && <Link to="/login" className="snap-post-button"><Camera size={16} />Post snap</Link>}
            </div>}
          </article>;
        })}
      </div>
    </div>
    {selectedIndex >= 0 && <SnapViewer items={activeItems} index={selectedIndex} profile={profile} now={now}
      onChange={snap => setSelectedId(`${snap.source}:${snap.id}`)} onClose={() => setSelectedId(null)} onDelete={onDeleteSnap}
      onReport={profile?.id ? snap => { setSelectedId(null); setReportSnap(snap); } : undefined} />}
    {composing && onPostSnap && <SnapComposer profile={profile} onClose={() => setComposing(false)} onPublish={publish} />}
    {reportSnap && <ReportModal targetType="post" targetId={reportSnap.id} targetLabel="snap" source={reportSnap.source}
      sourceUrl={reportSnap.sourceUrl} signInRequired={!profile?.id} onClose={() => setReportSnap(null)} />}
  </section>;
}
