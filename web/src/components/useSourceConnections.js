import { useEffect, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { subscribeNativeForeground } from '../nativeRuntime.mjs';

export default function useSourceConnections(enabled = true) {
  const { profile } = useAuth();
  const accountScope = profile?.id ? `${profile.id}:${profile.plan || ''}` : null;
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState({ owner: null, connected: {}, platforms: {} });
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('ufi-connections-changed', refresh);
    const unsubscribe = subscribeNativeForeground(refresh);
    return () => { window.removeEventListener('ufi-connections-changed', refresh); unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!enabled || !profile?.id) return;
    let active = true;
    const controller = new AbortController();
    client.get('/social/platforms', { signal: controller.signal }).then(({ data }) => {
      if (active) setCatalog({ owner: accountScope, connected: data.connected || {}, platforms: data.platforms || {} });
    }).catch(() => {
      if (active) setCatalog({ owner: accountScope, connected: {}, platforms: {} });
    });
    return () => { active = false; controller.abort(); };
  }, [enabled, accountScope, revision]);
  return catalog.owner === accountScope ? catalog : { connected: {}, platforms: {} };
}
