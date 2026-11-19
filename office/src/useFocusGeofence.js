import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceFence, advanceStay, advanceZoneFences, checkFence, clearFenceCandidate, EMPTY_FENCE,
  EMPTY_STAY, fenceProfile, interruptStay, MAX_FIX_AGE_MS, zoneAvailable,
} from './focus-geofence.mjs';
import { automaticCommandAllowed, boundaryRule, chooseBoundaryRule } from './focus-studio-model.mjs';

function resetCandidates(run) {
  if (!run) return;
  run.area = clearFenceCandidate(run.area);
  for (const [id, state] of run.zones) run.zones.set(id, clearFenceCandidate(state));
  for (const [id, state] of run.stays) run.stays.set(id, interruptStay(state));
  run.approaches.clear();
}

function initialRun(config, fireOnStart) {
  return {
    config, area: EMPTY_FENCE, zones: new Map(), stays: new Map(), approaches: new Map(),
    lastActions: new Map(), activeKey: null, lastFix: -Infinity, fireOnStart,
  };
}

const eventKey = ({ zoneId, type }) => JSON.stringify([zoneId, type]);
const EVENT_LABELS = { enter: 'Arrival', exit: 'Departure', stay: 'Stay', approach: 'Approach' };

export default function useFocusGeofence(settings, focusOpen, onBoundary, focusRunning, suppressActions = false) {
  const [requested, setRequested] = useState(false);
  const [pauseUntil, setPauseUntil] = useState(null);
  const [reading, setReading] = useState(null);
  const [events, setEvents] = useState([]);
  const session = useRef(null);
  const newSession = useRef(false);
  const selected = settings.zones.find(zone => zone.id === settings.activeZoneId);
  const fence = settings.fence;

  // Names and action edits do not reset an existing boundary reading.
  const { scope, seconds, combination, group } = fence;
  const { maxAccuracy, buffer, highAccuracy } = fenceProfile(fence);
  const exitSeconds = fence.separateExit ? fence.exitSeconds : seconds;
  const key = JSON.stringify(settings.zones.filter(zone => zone.enabled
    && (scope === 'selected' ? zone.id === settings.activeZoneId : !group || zone.group === group))
    .map(({ id, center, radius, shape, vertices, exclude, schedule, until, snoozedUntil, overrides }) =>
      ({ id, center, radius, shape, vertices, exclude, schedule, until, snoozedUntil, overrides })).sort((a, b) => a.id.localeCompare(b.id)));
  const config = useMemo(() => ({
    monitored: JSON.parse(key), profile: { maxAccuracy, buffer, highAccuracy }, scope, combination,
    enterMs: seconds * 1000, exitMs: exitSeconds * 1000,
  }), [key, maxAccuracy, buffer, highAccuracy, scope, combination, seconds, exitSeconds]);
  const { monitored } = config;
  const active = requested && monitored.length > 0;
  const paused = pauseUntil !== null;
  const enabled = active && !paused && (focusOpen || fence.background);

  const clearReading = useCallback(() => {
    setReading(null);
    resetCandidates(session.current);
  }, []);
  const stop = useCallback(() => {
    session.current = null;
    newSession.current = false;
    setReading(null);
    setPauseUntil(null);
    setRequested(false);
  }, []);
  const pause = (until = Infinity) => {
    session.current = null;
    newSession.current = false;
    setReading(null);
    setPauseUntil(until);
  };

  useEffect(() => { if (!monitored.length) stop(); }, [monitored.length, stop]);
  useEffect(() => { if (!enabled) clearReading(); }, [enabled, clearReading]);
  useEffect(() => {
    if (!Number.isFinite(pauseUntil)) return undefined;
    const timer = window.setTimeout(() => setPauseUntil(null), Math.max(0, pauseUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [pauseUntil]);

  function acceptFix(fix) {
    if (!enabled) return;
    if (session.current?.config !== config) {
      session.current = initialRun(config, newSession.current);
      newSession.current = false;
    }
    const run = session.current;
    if (fix.timestamp <= run.lastFix) return;
    if (Date.now() - run.lastFix >= MAX_FIX_AGE_MS) resetCandidates(run);
    run.lastFix = fix.timestamp;

    const available = monitored.filter(zone => zoneAvailable(zone, fix.timestamp));
    const activeKey = JSON.stringify(available.map(zone => zone.id));
    if (activeKey !== run.activeKey) {
      if (run.activeKey !== null) run.fireOnStart = false;
      run.area = EMPTY_FENCE;
      run.stays.delete(null);
      run.approaches.delete(null);
    }
    run.activeKey = activeKey;
    if (!available.length) {
      run.zones.clear();
      run.stays.clear();
      run.approaches.clear();
      setReading({ config, status: { relation: 'scheduled', measurements: [], fix, scheduledCount: 0 } });
      return;
    }
    // Schedule changes establish a new baseline and never create a crossing.
    const fireOnStart = fence.fireOnStart && run.fireOnStart;
    const measured = checkFence(available, fix, config.profile, { combination, useExclusions: scope === 'all' });
    const selectedReading = scope === 'selected' ? measured.measurements[0] : null;
    const result = advanceFence(run.area, measured.relation, fix.timestamp,
      selectedReading?.enterMs ?? config.enterMs, selectedReading?.exitMs ?? config.exitMs, fireOnStart);
    const zones = advanceZoneFences(run.zones, measured.measurements, fix.timestamp, config.enterMs, config.exitMs, fireOnStart);
    run.zones = zones.states;
    run.area = result.state;

    const zoneId = scope === 'selected' ? available[0].id : null;
    const transitions = scope === 'individual' ? zones.transitions
      : result.transition ? [{ type: result.transition, zoneId }] : [];
    const included = measured.measurements.filter(item => !item.excluded);
    const contacts = scope === 'individual' ? zones.readings : [{
      id: zoneId, relation: measured.relation, confirmed: result.state.confirmed,
      boundaryDistance: (combination === 'every' ? Math.max : Math.min)(...included.map(item => item.boundaryDistance)),
      uncertainty: Math.max(...included.map(item => item.uncertainty)),
    }];
    const nextStays = new Map();
    const nextApproaches = new Map();
    const overrides = new Map(available.map(zone => [zone.id, zone.overrides]));
    for (const contact of contacts) {
      const specific = overrides.get(contact.id);
      const stay = { type: 'stay', zoneId: contact.id };
      if (boundaryRule(settings, stay).action !== 'off') {
        const next = advanceStay(run.stays.get(contact.id) ?? EMPTY_STAY, contact, fix.timestamp,
          (specific?.staySeconds ?? fence.staySeconds) * 1000);
        nextStays.set(contact.id, next.state);
        if (next.transition) transitions.push(stay);
      }
      const approach = { type: 'approach', zoneId: contact.id };
      if (contact.relation === 'outside' && contact.confirmed === 'outside' &&
        Number.isFinite(contact.boundaryDistance) && contact.boundaryDistance >= 0 && boundaryRule(settings, approach).action !== 'off') {
        const outside = contact.boundaryDistance;
        const uncertainty = contact.uncertainty;
        const distance = specific?.approachMeters ?? fence.approachMeters;
        const near = outside + uncertainty < distance ? true
          : outside - uncertainty > distance ? false : run.approaches.get(contact.id);
        if (near !== undefined) nextApproaches.set(contact.id, near);
        if (near && run.approaches.get(contact.id) === false) transitions.push(approach);
      }
    }
    run.stays = nextStays;
    run.approaches = nextApproaches;

    setReading({ config, status: {
      relation: measured.relation, measurements: zones.readings, fix,
      checking: run.area.candidate, scheduledCount: available.length,
    } });
    if (!transitions.length) return;
    const candidates = transitions.map(event => {
      const rule = boundaryRule(settings, event);
      const last = run.lastActions.get(eventKey(event));
      const reason = !automaticCommandAllowed(settings, rule.action) ? 'Automatic command switched off'
        : suppressActions ? 'Distraction-free focus — action suppressed'
        : fence.duringFocus && !focusRunning ? 'Outside a work session'
        : last !== undefined && fix.timestamp - last < (overrides.get(event.zoneId)?.cooldownSeconds ?? fence.cooldownSeconds) * 1000
          ? 'Cooldown' : '';
      return { ...event, at: fix.timestamp, reason, action: rule.label };
    });
    const eligible = candidates.filter(item => !item.reason);
    if (eligible.length) {
      const winner = chooseBoundaryRule(settings, eligible);
      const chosen = eligible.find(item => item.type === winner.type && item.zoneId === winner.zoneId);
      if (chosen) {
        run.lastActions.set(eventKey(chosen), fix.timestamp);
        eligible.forEach(item => { if (item !== chosen) item.reason = 'Higher-priority rule'; });
        onBoundary([chosen]);
        if (fence.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try { new Notification('Office geofencing', { body: EVENT_LABELS[chosen.type] + ' · ' + winner.area }); }
          catch { /* The Office activity log is still available. */ }
        }
      }
    }
    setEvents(previous => [...candidates, ...previous].slice(0, 30));
  }

  return {
    active, enabled, paused, selected, monitoredCount: monitored.length, monitoredIds: monitored.map(zone => zone.id), events, highAccuracy,
    status: enabled && reading?.config === config ? reading.status : null,
    start: () => {
      if (!requested) { newSession.current = true; setRequested(true); }
    },
    stop, pause, resume: () => setPauseUntil(null),
    acceptFix, clearReading, clearEvents: () => setEvents([]),
  };
}
