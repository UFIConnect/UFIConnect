import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_SURFACE_DISTANCE_METERS } from './focus-geofence.mjs';

export function selectPhoneConfig(settings) {
  const enabled = settings.zones.filter(zone => zone.enabled);
  const candidates = settings.fence.scope === 'selected' ? enabled.filter(zone => zone.id === settings.activeZoneId) : enabled;
  // Native region monitoring implements circles and arrivals/exits. Keep all
  // other zones and their options in the existing Office browser settings.
  const hasExclusions = enabled.some(zone => zone.exclude);
  const advancedRules = settings.fence.stay !== 'off' || settings.fence.approach !== 'off' || settings.fence.cooldownSeconds > 0;
  const zones = !hasExclusions && !advancedRules ? candidates.filter(zone =>
    (!zone.shape || zone.shape === 'circle') && zone.radius >= 100 && zone.radius < MAX_SURFACE_DISTANCE_METERS && !zone.schedule?.enabled
    && !zone.until && !zone.snoozedUntil && !Object.keys(zone.overrides ?? {}).length
    && (zone.rules?.stay ?? settings.fence.stay) === 'off'
    && (zone.rules?.approach ?? settings.fence.approach) === 'off') : [];
  const eligible = settings.fence.scope === 'all' && zones.length !== candidates.length ? [] : zones;
  const { scope, enter, exit, custom, profile, seconds } = settings.fence;
  return { config: { zones: eligible, activeZoneId: settings.activeZoneId, minutes: settings.minutes,
    fence: { scope, enter, exit, custom, profile, seconds } }, skipped: candidates.length - eligible.length };
}

export default function useOfficeFocus(request, authScope, active) {
  const [envelope, setEnvelope] = useState(null);
  const [requestStatus, setRequestStatus] = useState({ scope: null });
  const [codeEnvelope, setCodeEnvelope] = useState(null);
  const currentScope = useRef(authScope);
  currentScope.current = authScope;
  const revision = useRef(0), writing = useRef(false);
  const owner = useRef(null);

  const snapshot = envelope?.scope === authScope && authScope !== null ? envelope.data : null;
  const pairing = codeEnvelope?.scope === authScope ? codeEnvelope.code : null;
  const status = requestStatus.scope === authScope ? requestStatus : {};

  const refresh = useCallback(async signal => {
    if (!request || authScope === null || writing.current) return;
    const generation = ++revision.current;
    const matches = () => !signal?.aborted && generation === revision.current && authScope === currentScope.current;
    try {
      const data = await request('', { signal });
      if (matches()) {
        if (owner.current !== data.ownerId) {
          owner.current = data.ownerId;
          setCodeEnvelope(null);
        }
        setEnvelope({ scope: authScope, data });
        setRequestStatus({ scope: authScope });
        if (data.phone) setCodeEnvelope(null);
      }
    } catch (error) {
      if (!matches()) return;
      if (error.status === 401 || error.status === 403 || error.status === 404) {
        setEnvelope(null); setCodeEnvelope(null);
      }
      setRequestStatus({ scope: authScope, code: error.status, error: error.message });
    }
  }, [request, authScope]);

  useEffect(() => {
    if (authScope === null || (!active && !snapshot?.config)) return undefined;
    const controller = new AbortController();
    const load = () => { if (!document.hidden) void refresh(controller.signal); };
    const delay = snapshot?.phone?.scopes?.zones || snapshot?.phone?.scopes?.precision ? 4000 : active ? 12000 : 30000;
    load();
    const timer = window.setInterval(load, delay);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [active, authScope, refresh, Boolean(snapshot?.config), Boolean(snapshot?.phone?.scopes?.zones), Boolean(snapshot?.phone?.scopes?.precision)]);

  const mutate = useCallback(async (path, options) => {
    if (!request || authScope === null || !snapshot?.ownerId || writing.current) return null;
    writing.current = true;
    const generation = ++revision.current;
    setRequestStatus({ scope: authScope, busy: true });
    try {
      const data = await request(path, { ...options, ownerId: snapshot.ownerId });
      if (generation !== revision.current || authScope !== currentScope.current) return null;
      setRequestStatus({ scope: authScope });
      return { data };
    } catch (error) {
      if (generation !== revision.current || authScope !== currentScope.current) return null;
      if (error.status === 401 || error.status === 403) {
        setEnvelope(null); setCodeEnvelope(null);
      }
      setRequestStatus({ scope: authScope, code: error.status, error: error.message });
      return null;
    } finally { writing.current = false; }
  }, [request, authScope, snapshot?.ownerId]);

  return {
    snapshot, pairing, status, refresh,
    async save(config, expected = snapshot?.revision ?? 0) {
      const saved = await mutate('/config', { method: 'PUT', body: { config, revision: expected } });
      if (saved) setEnvelope({ scope: authScope, data: saved.data });
      return Boolean(saved);
    },
    async confirmPhone(confirmation) {
      const confirmed = await mutate('/confirm', { method: 'POST', body: { id: snapshot?.phone?.id, confirmation } });
      if (confirmed) setEnvelope({ scope: authScope, data: confirmed.data });
      return Boolean(confirmed);
    },
    async pair() {
      const reply = await mutate('/pair', { method: 'POST' });
      if (reply) setCodeEnvelope({ scope: authScope, code: reply.data });
    },
    async disconnect(removeConfig = false) {
      if (!await mutate(removeConfig ? '' : '/phone', { method: 'DELETE' })) return;
      setEnvelope({ scope: authScope, data: removeConfig ? { config: null, revision: 0, ownerId: snapshot.ownerId }
        : { ...snapshot, phone: null, audio: null } });
      setCodeEnvelope(null);
      await refresh();
      return true;
    },
    async command(action) {
      const result = await mutate('/session', { method: 'POST', body: { action } });
      if (result?.data?.session) setEnvelope(previous => previous?.scope === authScope ? {
        ...previous, data: { ...previous.data, session: result.data.session },
      } : previous);
    },
    async claimAudio(id) {
      const result = await mutate('/audio', { method: 'POST', body: { id } });
      if (result) setEnvelope(previous => previous?.scope === authScope && previous.data.audio?.id === id ? {
        ...previous, data: { ...previous.data, audio: null },
      } : previous);
      return result?.data;
    },
  };
}
