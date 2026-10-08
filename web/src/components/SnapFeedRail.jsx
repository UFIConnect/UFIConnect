import { useAuth } from '../contexts/AuthContext';
import useSnaps from '../hooks/useSnaps';
import { normalizeSourceFavorites } from './sourceFavorites';
import SnapRail from './SnapRail';

export default function SnapFeedRail({ mode = 'home', favorites }) {
  const { profile } = useAuth();
  const snaps = useSnaps(mode, profile?.id);
  const savedFavorites = normalizeSourceFavorites(profile?.roleSettings?.feedSourceFavorites);
  return <SnapRail key={`${profile?.id || 'guest'}:${mode}`} mode={mode} profile={profile}
    favorites={favorites || (profile?.id ? savedFavorites[mode === 'following' ? 'following' : 'feed'] : [])}
    items={snaps.items} loading={snaps.loading} error={snaps.error} sourceErrors={snaps.sourceErrors}
    onRefresh={snaps.refresh} onPostSnap={snaps.publish} onDeleteSnap={snaps.remove} />;
}
