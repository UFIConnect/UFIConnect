import { useAuth } from '../contexts/AuthContext';
import useSnaps from '../hooks/useSnaps';
import { normalizeSourceFavorites } from './sourceFavorites';
import { normalizeSnapSourceErrors } from './snapRanking.mjs';
import { syncFailureReason } from './sourceSyncFailureReason.mjs';
import SnapRail from './SnapRail';

export default function SnapFeedRail({ mode = 'home', favorites, feedSourceErrors, onRetryFeed }) {
  const { profile } = useAuth();
  const snaps = useSnaps(mode, profile?.id);
  const savedFavorites = normalizeSourceFavorites(profile?.roleSettings?.feedSourceFavorites);
  const following = mode === 'following';
  const supportsSyncNotice = following || mode === 'home';
  const postFailures = Object.entries(normalizeSnapSourceErrors(feedSourceErrors));
  const snapFailures = snaps.error ? { snaps: 'Temporarily unavailable.' } : snaps.sourceErrors;
  const noticeErrors = supportsSyncNotice ? {
    ...Object.fromEntries(postFailures.map(([source, message]) => [source, syncFailureReason(message)])),
    ...snapFailures,
  } : undefined;

  function retrySync() {
    if (Object.keys(snapFailures).length) void snaps.refresh();
    if (postFailures.length) void onRetryFeed?.();
  }

  return <SnapRail key={`${profile?.id || 'guest'}:${mode}`} mode={mode} profile={profile}
    favorites={favorites || (profile?.id ? savedFavorites[following ? 'following' : 'feed'] : [])}
    items={snaps.items} loading={snaps.loading} error={snaps.error} sourceErrors={snaps.sourceErrors} refreshingSources={snaps.refreshingSources}
    noticeErrors={noticeErrors} onRetrySources={supportsSyncNotice ? retrySync : undefined}
    onRefresh={snaps.refresh} onPostSnap={snaps.publish} onDeleteSnap={snaps.remove} />;
}
