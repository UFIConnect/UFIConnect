import { createContext, useContext, useMemo, useRef, useState } from 'react';
import client from '../api/client';
import { getAccessToken } from '../auth/session';
import { normalizeSourceFavorites } from '../components/sourceFavorites';

const SourceFavoritesContext = createContext(null);

export function SourceFavoritesProvider({ children, profile, token, updateProfileLocally }) {
  const [edits, setEdits] = useState({});
  const editsRef = useRef({});
  const writes = useRef(new Map());
  const saved = useMemo(() => normalizeSourceFavorites(profile?.roleSettings?.feedSourceFavorites), [profile?.roleSettings?.feedSourceFavorites]);

  function setEdit(mode, edit) {
    const next = { ...editsRef.current };
    if (edit) next[mode] = edit;
    else delete next[mode];
    editsRef.current = next;
    setEdits(next);
  }

  async function save(mode, favorites) {
    const memberId = profile?.id;
    if (!memberId || !token || getAccessToken() !== token) return;
    const edit = { memberId, token, favorites };
    setEdit(mode, edit);

    const persist = async () => {
      // A later selection contains the complete list, so only send the most
      // recent edit still waiting for its turn.
      if (getAccessToken() !== token || editsRef.current[mode] !== edit) return;
      const { data } = await client.patch('/profile', { feedSourceFavorites: { [mode]: favorites } }, {
        headers: { Authorization: `Bearer ${token}` },
        fetchOptions: { keepalive: true },
      });
      const persisted = (data?.profile || data)?.roleSettings?.feedSourceFavorites?.[mode];
      if (!Array.isArray(persisted) || persisted.length !== favorites.length
        || persisted.some((source, index) => source !== favorites[index])) {
        throw new Error('Source favorites were not saved.');
      }
      if (getAccessToken() !== token) return;
      updateProfileLocally(current => current?.id === memberId ? {
        roleSettings: {
          ...current.roleSettings,
          feedSourceFavorites: { ...current.roleSettings?.feedSourceFavorites, [mode]: persisted },
        },
      } : {});
    };

    // Keep writes from this member in order across both feed modes and routes.
    const previous = writes.current.get(memberId);
    const write = previous ? previous.catch(() => {}).then(persist) : persist();
    writes.current.set(memberId, write);
    try {
      await write;
      if (editsRef.current[mode] === edit) setEdit(mode, null);
    } catch {
      if (editsRef.current[mode] === edit) {
        setEdit(mode, getAccessToken() === token ? { ...edit, failed: true } : null);
      }
    } finally {
      if (writes.current.get(memberId) === write) writes.current.delete(memberId);
    }
  }

  function memberEdit(edit) {
    return token && edit?.token === token && edit.memberId === profile?.id ? edit : null;
  }

  function changeFavorites(mode, source) {
    const edit = memberEdit(editsRef.current[mode]);
    const current = edit && !edit.failed ? edit.favorites : saved[mode];
    const next = source === undefined ? [] : current.includes(source)
      ? current.filter(key => key !== source) : [...current, source];
    return save(mode, next);
  }

  function retryFavorites(mode) {
    const edit = memberEdit(editsRef.current[mode]);
    if (edit?.failed) return save(mode, edit.favorites);
  }

  return <SourceFavoritesContext.Provider value={{ saved, edits, memberEdit, changeFavorites, retryFavorites }}>
    {children}
  </SourceFavoritesContext.Provider>;
}

export function useSourceFavorites(mode) {
  const { saved, edits, memberEdit, changeFavorites, retryFavorites } = useContext(SourceFavoritesContext);
  const edit = memberEdit(edits[mode]);
  return {
    favorites: edit && !edit.failed ? edit.favorites : saved[mode],
    saveFailed: edit?.failed === true,
    changeFavorites: source => changeFavorites(mode, source),
    retryFavorites: () => retryFavorites(mode),
  };
}
