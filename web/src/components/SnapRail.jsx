import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, RefreshCw, Star, Play } from 'lucide-react';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { SOURCE_META } from './sourceMeta';
import { rankSnapGroups, normalizeSnapSourceErrors, snapDurationLabel } from './snapRanking.mjs';
import SnapComposer from './SnapComposer';
import SnapViewer from './SnapViewer';
import ReportModal from './ReportModal';
import './SnapRail.css';

function SnapThumbnail({ snap, onOpen }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [snap.id, snap.mediaUrl]);
  const author = snap.author?.name || 'UFIConnect member';
  return <button type="button" className="snap-thumbnail" onClick={onOpen}
    aria-label={`View ${author}'s snap${snap.caption ? `: ${snap.caption}` : ''}`}>
    {!failed && (snap.mediaType === 'video'
      ? snap.thumbnailUrl
        ? <img src={snap.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : <span className="snap-thumbnail-fallback"><Play size={22} /></span>
      : <img src={snap.thumbnailUrl || snap.mediaUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />)}
    {failed && <span className="snap-thumbnail-fallback"><Camera size={22} /></span>}
    {snap.mediaType === 'video' && <span className="snap-thumbnail-play" aria-hidden="true"><Play size={13} fill="currentColor" /></span>}
    {snap.mediaType === 'video' && snapDurationLabel(snap.videoDurationSeconds) && <span className="snap-thumbnail-duration">{snapDurationLabel(snap.videoDurationSeconds)}</span>}
    <span className="snap-thumbnail-author">{author}</span>
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
  const groups = useMemo(() => {
    const ranked = rankSnapGroups(items, favorites, now);
    const external = ranked.filter(group => group.source !== 'uficonnect');
    if (mode === 'home') return external;
    const native = ranked.find(group => group.source === 'uficonnect')
      || { source: 'uficonnect', items: [], favorite: favorites.includes('uficonnect') };
    return [native, ...external];
  }, [mode, items, favorites, now]);
  const activeItems = groups.flatMap(group => group.items);
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
  return <section className="snap-rail" aria-label="Snaps" data-snap-mode={mode}>
    {error && <p className="snap-rail-message snap-rail-error" role="alert">{error}</p>}
    {notice && <p className="snap-rail-message">{notice}</p>}
    {sourceFailures.length > 0 && <div className="snap-source-notices" role="status" aria-label="Snap source availability">
      <p>Some sources could not refresh.</p>
      <ul>{sourceFailures.map(([source, message]) => <li key={source}><strong>{SOURCE_META[source]?.label || source}</strong>: {message}</li>)}</ul>
    </div>}
    <div className="snap-rail-browser">
      <div className="snap-source-row" tabIndex={0} role="region" aria-label="Snap sources" aria-busy={loading}>
        {groups.map(group => {
          const isNative = group.source === 'uficonnect';
          const source = isNative ? { ...SOURCE_META.uficonnect, label: 'UFI' } : SOURCE_META[group.source] || { label: group.source, icon: group.source.slice(0, 2) };
          const isRefreshing = refreshingSources.includes(group.source) || (loading && refreshingSources.length === 0);
          const refreshLabel = `Refresh ${source.label} snaps`;
          return <article key={group.source} className="snap-source-box" data-snap-source={group.source} aria-label={`${source.label} snaps`} aria-busy={isRefreshing}>
            <header className="snap-source-heading"><span className="snap-source-mark" aria-hidden="true">{hasBrandIcon(group.source) ? <BrandIcon platform={group.source} size={17} /> : <b>{source.icon}</b>}</span>
              <strong>{source.label}</strong>{group.items.length > 0 && <span className="snap-source-count">{group.items.length}</span>}
              {group.favorite && <Star className="snap-source-favorite" size={15} fill="currentColor" aria-label="Favorite source" />}
              <button type="button" className="snap-refresh-button" disabled={loading || !onRefresh} onClick={() => onRefresh(group.source)} aria-label={refreshLabel} title={refreshLabel} aria-busy={isRefreshing}><RefreshCw size={16} className={isRefreshing ? 'snap-refresh-spinning' : ''} /></button>
            </header>
            {group.items.length > 0
              ? <div className="snap-source-items">{group.items.map(snap => <SnapThumbnail key={`${snap.source}:${snap.id}`} snap={snap} onOpen={() => setSelectedId(`${snap.source}:${snap.id}`)} />)}</div>
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
    {composing && onPostSnap && <SnapComposer onClose={() => setComposing(false)} onPublish={publish} />}
    {reportSnap && <ReportModal targetType="post" targetId={reportSnap.id} targetLabel="snap" source={reportSnap.source}
      sourceUrl={reportSnap.sourceUrl} signInRequired={!profile?.id} onClose={() => setReportSnap(null)} />}
  </section>;
}
