import { useRef, useState } from 'react';
import client from '../api/client';
import { getAccessToken } from '../auth/session';
import { normalizeSourceFavorites } from '../components/sourceFavorites';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

const favoriteWrites = new Map();

function persistSourceFavorites(memberId, token, mode, favorites) {
  const save = async () => {
    if (getAccessToken() !== token) return null;
    const { data } = await client.patch('/profile', { feedSourceFavorites: { [mode]: favorites } }, {
      headers: { Authorization: `Bearer ${token}` },
      fetchOptions: { keepalive: true },
    });
    const saved = (data?.profile || data)?.roleSettings?.feedSourceFavorites?.[mode];
    if (!Array.isArray(saved) || JSON.stringify(saved) !== JSON.stringify(favorites)) {
      throw new Error('Source favorites were not saved.');
    }
    return saved;
  };
  const previous = favoriteWrites.get(memberId);
  const write = (previous ? previous.catch(() => {}).then(save) : save())
    .finally(() => { if (favoriteWrites.get(memberId) === write) favoriteWrites.delete(memberId); });
  favoriteWrites.set(memberId, write);
  return write;
}

export default function useSourceFavorites(mode) {
  const { profile, token, updateProfileLocally } = useAuth();
  const { showToast } = useToast();
  const [pending, setPending] = useState({});
  const pendingRef = useRef({});
  const saved = normalizeSourceFavorites(profile?.roleSettings?.feedSourceFavorites)[mode];
  const favorites = pending[mode]?.token === token && token ? pending[mode].favorites : saved;

  async function changeFavorites(source) {
    if (!profile?.id || !token || getAccessToken() !== token) return;
    const previous = pendingRef.current[mode];
    const current = previous?.token === token ? previous.favorites : saved;
    const next = source === undefined ? [] : current.includes(source)
      ? current.filter(key => key !== source) : [...current, source];
    const edit = { token, favorites: next };
    pendingRef.current[mode] = edit;
    setPending({ ...pendingRef.current });

    try {
      const persisted = await persistSourceFavorites(profile.id, token, mode, next);
      if (persisted && getAccessToken() === token) {
        updateProfileLocally(currentProfile => ({
          roleSettings: {
            ...currentProfile.roleSettings,
            feedSourceFavorites: { ...currentProfile.roleSettings?.feedSourceFavorites, [mode]: persisted },
          },
        }));
      }
    } catch {
      if (pendingRef.current[mode] === edit && getAccessToken() === token) {
        showToast('Favorites could not be saved. Try again.', 'error');
      }
    } finally {
      if (pendingRef.current[mode] === edit) {
        delete pendingRef.current[mode];
        setPending({ ...pendingRef.current });
      }
    }
  }

  return { favorites, changeFavorites };
}
