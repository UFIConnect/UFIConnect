import { useEffect, useMemo, useReducer, useState } from 'react';
import { MAX_FIX_AGE_MS } from './focus-geofence.mjs';
import { assessTrackingFix } from './focus-tracking.mjs';
import { gridStep } from './focus-grid.mjs';
import {
  advanceMovement, advancePlannedRoute, advanceVehicle, emptyMovement,
  liveMovementFix, matchMessage, movementSettings, MOVEMENT_STORAGE_KEY, nextMessage, startPlannedRoute,
} from './focus-movement.mjs';

function readSettings() {
  try { return movementSettings(JSON.parse(localStorage.getItem(MOVEMENT_STORAGE_KEY))); }
  catch { return movementSettings(null); }
}

function initialState() {
  return { sourceId: '', movement: emptyMovement(), route: null, vehicle: null, trips: {}, schedule: {}, log: [], sequence: 0 };
}

function addLog(state, entries) {
  if (!entries.length) return state;
  const log = entries.map((entry, index) => ({ ...entry, id: state.sequence + index + 1 }));
  return { ...state, sequence: state.sequence + log.length, log: [...log.reverse(), ...state.log].slice(0, 50) };
}

function messages(state, rules, now, events = []) {
  const schedule = {}, delivered = [];
  for (const rule of rules) {
    const trigger = matchMessage(rule, events);
    const result = nextMessage(state.schedule[rule.id], rule, now, trigger);
    if (result.schedule) schedule[rule.id] = result.schedule;
    if (result.notify) delivered.push({ kind: 'message', title: rule.message, at: now, target: rule.id });
  }
  return addLog({ ...state, schedule }, [...events, ...delivered]);
}

function finishVehicle(state) {
  if (!state.vehicle) return state;
  const { profile, distance, peak, stops, startedAt, last } = state.vehicle;
  return { ...state, vehicle: null, trips: { ...state.trips, [profile.id]: { distance, peak, stops, startedAt, last } } };
}

function reducer(state, action) {
  switch (action.type) {
    case 'source':
      return { ...finishVehicle(state), sourceId: action.id, route: null, movement: emptyMovement() };
    case 'grid':
      return { ...state, movement: { ...state.movement, grid: null, crossings: 0, visited: [], cellVisits: [], pendingGrid: null,
        pendingSamples: 0, gridObservation: null } };
    case 'grid-baseline':
      return { ...state, movement: { ...state.movement, grid: null, pendingGrid: null, pendingSamples: 0, gridObservation: null } };
    case 'route':
      return { ...state, route: action.fix ? startPlannedRoute(action.fix, action.stops, action.corridor) : null };
    case 'vehicle': {
      if (!action.profile) return finishVehicle(state);
      const initial = { profile: action.profile, startedAt: action.now, distance: 0, peak: null, stops: 0 };
      const { vehicle } = advanceVehicle(initial, action.fix, action.profile);
      return { ...state, vehicle: { ...vehicle, peak: vehicle.speed ?? null } };
    }
    case 'signal-lost':
      return state.movement.last ? { ...state,
        movement: { ...state.movement, last: null, pendingGrid: null, pendingSamples: 0, gridObservation: null, places: {} },
        route: state.route && { ...state.route, last: null, deviating: false, pendingDeviation: false },
        vehicle: state.vehicle && { ...state.vehicle, last: null, anchor: null, stoppedAt: null, state: 'Waiting for GPS' },
      } : state;
    case 'timer': {
      const { [action.rule.id]: running, ...rest } = state.schedule;
      return { ...state, schedule: running ? rest : { ...rest, [action.rule.id]: {
        at: action.now + action.rule.minutes * 60000, left: action.rule.repeats,
      } } };
    }
    case 'cancel': {
      const schedule = { ...state.schedule };
      delete schedule[action.id];
      return { ...state, schedule };
    }
    case 'allowed-rules': {
      const schedule = Object.fromEntries(Object.entries(state.schedule).filter(([id]) => action.ids.includes(id)));
      return Object.keys(schedule).length === Object.keys(state.schedule).length ? state : { ...state, schedule };
    }
    case 'tick':
      return Object.values(state.schedule).some(schedule => schedule.at <= action.now)
        ? messages(state, action.rules, action.now) : state;
    case 'clear-log':
      return { ...state, log: [] };
    case 'fix': {
      const { fix, now, settings } = action;
      if (state.sourceId !== action.sourceId || !liveMovementFix(fix, now) ||
        state.movement.last?.timestamp >= fix.timestamp) return state;
      if (assessTrackingFix(state.movement.last, fix, 5000, now)) return state;
      const next = advanceMovement(state.movement, fix, settings.places, gridStep(settings), settings.gridOptions);
      const planned = advancePlannedRoute(state.route, fix);
      const previous = state.vehicle;
      const car = previous ? advanceVehicle(previous, fix, previous.profile) : { vehicle: previous, events: [] };
      const vehicle = car.vehicle && { ...car.vehicle,
        peak: car.vehicle.speed == null ? previous.peak : Math.max(previous.peak ?? 0, car.vehicle.speed),
        stops: previous.stops + car.events.length,
      };
      return messages({ ...state, movement: next.movement, route: planned.route, vehicle },
        settings.rules, now, [...next.events, ...planned.events, ...car.events]);
    }
    default:
      return state;
  }
}

export default function useFocusMovement(tracking, devices, commandsEnabled = true) {
  const [settings, setSettings] = useState(readSettings);
  const [storageError, setStorageError] = useState(false);
  const [state, dispatch] = useReducer(reducer, null, initialState);
  const [, expireReading] = useReducer(revision => revision + 1, 0);
  const now = Date.now();
  const remote = devices.sources.find(item => item.id === state.sourceId);
  const reading = state.sourceId ? remote?.fix : tracking.liveFix;
  const fix = tracking.visible && liveMovementFix(reading, now) ? reading : null;
  const activeRules = useMemo(() => commandsEnabled ? settings.rules.filter(rule => rule.enabled !== false) : [], [commandsEnabled, settings.rules]);
  const activeSettings = useMemo(() => ({ ...settings, rules: activeRules }), [settings, activeRules]);
  useEffect(() => { dispatch({ type: 'allowed-rules', ids: activeRules.map(rule => rule.id) }); }, [activeRules]);

  useEffect(() => {
    try {
      localStorage.setItem(MOVEMENT_STORAGE_KEY, JSON.stringify(settings));
      setStorageError(false);
    } catch { setStorageError(true); }
  }, [settings]);

  const expiry = fix ? fix.timestamp + MAX_FIX_AGE_MS : null;
  useEffect(() => {
    if (expiry === null) return undefined;
    const timer = setTimeout(expireReading, Math.max(0, expiry - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [expiry]);

  const nextMessageAt = Math.min(...Object.values(state.schedule).map(schedule => schedule.at));
  useEffect(() => {
    if (!Number.isFinite(nextMessageAt)) return undefined;
    const timer = setTimeout(() => dispatch({ type: 'tick', rules: activeRules, now: Date.now() }),
      Math.max(0, nextMessageAt - Date.now()));
    return () => clearTimeout(timer);
  }, [nextMessageAt, activeRules]);

  useEffect(() => {
    dispatch(fix ? { type: 'fix', fix, settings: activeSettings, sourceId: state.sourceId, now: Date.now() } : { type: 'signal-lost' });
  }, [fix, activeSettings, state.sourceId]);

  function update(changes) {
    setSettings(current => movementSettings({ ...current, ...changes }));
  }

  return { settings, state, now, fix, remote, storageError, dispatch, update, commandsEnabled,
    selectSource: id => dispatch({ type: 'source', id }),
    setGrid: (grid, customStep) => {
      update({ grid, ...(customStep === undefined ? {} : { gridOptions: { ...settings.gridOptions, customStep } }) });
      dispatch({ type: 'grid' });
    },
    updateGridOptions: changes => {
      update({ gridOptions: { ...settings.gridOptions, ...changes } });
      if ('enabled' in changes || 'confirmations' in changes) dispatch({ type: 'grid-baseline' });
      if (changes.enabled === false || changes.events === false) {
        settings.rules.filter(rule => rule.event === 'grid').forEach(rule => dispatch({ type: 'cancel', id: rule.id }));
      }
    },
  };
}
