import { useImperativeHandle } from 'react';
import { useAuth } from '../contexts/AuthContext';
import useSnaps from '../hooks/useSnaps';
import { normalizeSourceFavorites } from './sourceFavorites';
import { normalizeSnapSourceErrors } from './snapRanking.mjs';
import { syncFailureReason } from './sourceSyncFailureReason.mjs';
import SnapRail from './SnapRail';

export default function SnapFeedRail({ ref, mode = 'home', favorites, feedSourceErrors, onRetryFeed }) {
  const { profile } = useAuth();
  const snaps = useSnaps(mode, profile?.id);
  useImperativeHandle(ref, () => ({ refresh: snaps.refresh }), [snaps.refresh]);
  const savedFavorites = normalizeSourceFavorites(profile?.roleSettings?.feedSourceFavorites);
  const following = mode === 'following';
  const supportsSyncNotice = following || mode === 'home';
  const postFailures = Object.entries(normalizeSnapSourceErrors(feedSourceErrors));
  const snapFailures = snaps.error ? { snaps: 'Temporarily unavailable.' } : snaps.sourceErrors;
  const noticeErrors = supportsSyncNotice ? {
    ...Object.fromEntries(postFailures.map(([source, message]) => [source, syncFailureReason(message)])),
    ...snapFailures,
  } : undefined;

  return <SnapRail key={`${profile?.id || 'guest'}:${mode}`} mode={mode} profile={profile}
    favorites={favorites || (profile?.id ? savedFavorites[following ? 'following' : 'feed'] : [])}
    items={snaps.items} loading={snaps.loading} error={snaps.error} sourceErrors={snaps.sourceErrors} refreshingSources={snaps.refreshingSources}
    avatarRevision={snaps.avatarRevision} noticeErrors={noticeErrors} onRetrySources={onRetryFeed}
    onPostSnap={snaps.publish} onDeleteSnap={snaps.remove} />;
}
