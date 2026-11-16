import { useAuth } from '../contexts/AuthContext';
import useSnaps from '../hooks/useSnaps';
import { normalizeSourceFavorites } from './sourceFavorites';
import FollowingConnectionNotice from './FollowingConnectionNotice';
import SnapRail from './SnapRail';

export default function SnapFeedRail({ mode = 'home', favorites, followingErrors = {}, onRetryFollowing }) {
  const { profile } = useAuth();
  const snaps = useSnaps(mode, profile?.id);
  const savedFavorites = normalizeSourceFavorites(profile?.roleSettings?.feedSourceFavorites);
  const following = mode === 'following';

  function retrySync() {
    if (snaps.error || Object.keys(snaps.sourceErrors).length) void snaps.refresh();
    if (Object.keys(followingErrors).length) void onRetryFollowing?.();
  }

  return <>
    {following && <FollowingConnectionNotice errors={{
      ...(snaps.error ? { snaps: snaps.error } : snaps.sourceErrors),
      ...followingErrors,
    }} onRetry={retrySync} />}
    <SnapRail key={`${profile?.id || 'guest'}:${mode}`} mode={mode} profile={profile}
      favorites={favorites || (profile?.id ? savedFavorites[following ? 'following' : 'feed'] : [])}
      items={snaps.items} loading={snaps.loading} error={snaps.error} sourceErrors={snaps.sourceErrors} refreshingSources={snaps.refreshingSources}
      showSyncNotices={!following} onRefresh={snaps.refresh} onPostSnap={snaps.publish} onDeleteSnap={snaps.remove} />
  </>;
}
