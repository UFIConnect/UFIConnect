import { useAuth } from '../contexts/AuthContext';
import useSnaps from '../hooks/useSnaps';
import { normalizeSourceFavorites } from './sourceFavorites';
import { normalizeSnapSourceErrors } from './snapRanking.mjs';
import { syncFailureReason } from './sourceSyncFailureReason.mjs';
import SnapRail from './SnapRail';

export default function SnapFeedRail({ mode = 'home', favorites, followingErrors = {}, onRetryFollowing, noticeTarget }) {
  const { profile } = useAuth();
  const snaps = useSnaps(mode, profile?.id);
  const savedFavorites = normalizeSourceFavorites(profile?.roleSettings?.feedSourceFavorites);
  const following = mode === 'following';
  const noticeErrors = following ? {
    ...Object.fromEntries(Object.entries(normalizeSnapSourceErrors(followingErrors))
      .map(([source, message]) => [source, syncFailureReason(message)])),
    ...(snaps.error ? { snaps: 'Temporarily unavailable.' } : snaps.sourceErrors),
  } : undefined;

  function retrySync() {
    if (snaps.error || Object.keys(snaps.sourceErrors).length) void snaps.refresh();
    if (Object.keys(followingErrors).length) void onRetryFollowing?.();
  }

  return <SnapRail key={`${profile?.id || 'guest'}:${mode}`} mode={mode} profile={profile}
    favorites={favorites || (profile?.id ? savedFavorites[following ? 'following' : 'feed'] : [])}
    items={snaps.items} loading={snaps.loading} error={snaps.error} sourceErrors={snaps.sourceErrors} refreshingSources={snaps.refreshingSources}
    noticeErrors={noticeErrors} noticeTarget={noticeTarget} onRetrySources={following ? retrySync : undefined}
    onRefresh={snaps.refresh} onPostSnap={snaps.publish} onDeleteSnap={snaps.remove} />;
}
