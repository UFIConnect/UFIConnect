const ZONE_ACTIONS = [
  { id: 'status', label: 'Show status', priority: 0 },
  { id: 'start', label: 'Start or resume timer', priority: 3 },
  { id: 'resume', label: 'Resume timer', priority: 3 },
  { id: 'startWithSound', label: 'Start or resume timer with soundscape', priority: 3 },
  { id: 'pauseTimer', label: 'Pause timer only', priority: 8 },
  { id: 'pause', label: 'Pause timer and sound', priority: 9 },
  { id: 'resetTimer', label: 'Reset timer', priority: 8 },
  { id: 'bodyReset', label: 'Start a one-minute reset', priority: 8 },
  { id: 'endReset', label: 'End body reset', priority: 1 },
  { id: 'playSound', label: 'Play the soundscape', priority: 2 },
  { id: 'stopSound', label: 'Stop soundscape', priority: 7 },
  { id: 'muteSound', label: 'Mute the soundscape', priority: 6 },
  { id: 'unmuteSound', label: 'Unmute the soundscape', priority: 2 },
  { id: 'duckSound', label: 'Duck the soundscape briefly', priority: 4 },
  { id: 'holdSound', label: 'Hold soundscape ducking', priority: 5 },
  { id: 'restoreSound', label: 'Restore soundscape volume', priority: 2 },
  { id: 'quietOff', label: 'Turn off Quiet Mode', priority: 1 },
  { id: 'stopTracking', label: 'Stop Geofencing', priority: 8 },
];

export const ENTRY_ACTIONS = [...ZONE_ACTIONS, { id: 'quiet', label: 'Turn on Quiet Mode', priority: 10 }];
export const EXIT_ACTIONS = [...ZONE_ACTIONS, { id: 'quiet', label: 'Pause and turn on Quiet Mode', priority: 10 }];
export const FOCUS_DURATIONS = [15, 25, 45, 60];
export const ACTION_MAX_AGE = 120_000;
export const FIX_MAX_AGE = 900_000;
export const LEASE_DURATION = 86_400_000;
export const ZONE_LIMITS = { ios: 20, android: 100 };

export function allowedAction(type, action) {
  return (type === 'enter' ? ENTRY_ACTIONS : EXIT_ACTIONS).find(item => item.id === action);
}

export function boundaryAction(settings, { type, zoneId }) {
  const zone = settings.zones.find(item => item.id === zoneId);
  const actions = type === 'enter' ? ENTRY_ACTIONS : EXIT_ACTIONS;
  const { id, label, priority } = allowedAction(type, zone?.rules?.[type] ?? settings.fence[type]) ?? actions[0];
  return { type, zoneId, action: id, label, priority, zonePriority: zone?.priority ?? 0 };
}

export function chooseFocusAction(settings, events) {
  const score = ({ priority, zonePriority, type }) =>
    (priority === 10 ? 1000 : 20 * zonePriority + 2 * priority) + (type === 'exit' ? 1 : 0);
  return events.map(event => boundaryAction(settings, event))
    .reduce((chosen, rule) => score(rule) > score(chosen) ? rule : chosen);
}

export function focusRegions({ zones, activeZoneId, fence }) {
  return zones.filter(zone => zone.enabled && (fence.scope !== 'selected' || zone.id === activeZoneId));
}

export function focusTransitions(config, registered, previous, report) {
  const allowed = new Set(registered);
  const ids = focusRegions(config).map(zone => zone.id).filter(id => allowed.has(id));
  const next = { ...previous };
  for (const [id, inside] of Object.entries(report.states)) {
    if (allowed.has(id)) next[id] = inside;
  }
  if (report.baseline) return { next, events: [] };
  if (config.fence.scope === 'all') {
    // Use a complete observation to settle overlapping zones as one area.
    if (ids.length !== focusRegions(config).length || !ids.length
        || !ids.every(id => typeof report.states[id] === 'boolean')) return { next: previous, events: [] };
    const area = states => ids.some(id => states[id] === true) ? true
      : ids.every(id => states[id] === false) ? false : null;
    const before = area(previous), after = area(next);
    return { next, events: before === null || after === before ? [] : [{ zoneId: null, type: after ? 'enter' : 'exit' }] };
  }
  const events = ids.filter(id => typeof previous[id] === 'boolean' && typeof report.states[id] === 'boolean'
      && previous[id] !== report.states[id])
    .sort().map(id => ({ zoneId: id, type: report.states[id] ? 'enter' : 'exit' }));
  return { next, events };
}

export function applyFocusAction(session, rule, minutes, now) {
  const action = rule.action;
  const next = { ...session };
  if (next.deadline && next.deadline <= now) {
    next.deadline = null;
    next.remaining = 0;
    next.started = false;
  }
  const running = next.deadline > now;
  const resting = next.breakDeadline > now;
  let audio = null;
  if (['start', 'resume', 'startWithSound'].includes(action) && !running && !resting
      && (action !== 'resume' || (next.started && next.remaining > 0))) {
    next.remaining = next.remaining || minutes * 60;
    next.deadline = now + next.remaining * 1000;
    next.started = true;
    if (action === 'startWithSound') audio = 'playSound';
  }
  if (running && (['pause', 'pauseTimer', 'bodyReset'].includes(action) || (action === 'quiet' && rule.type === 'exit'))) {
    next.remaining = Math.ceil((next.deadline - now) / 1000);
    next.deadline = null;
  }
  if (action === 'resetTimer') Object.assign(next, { remaining: minutes * 60, deadline: null, started: false });
  if (action === 'bodyReset' && !resting) next.breakDeadline = now + 60_000;
  if (action === 'endReset') next.breakDeadline = null;
  if (action === 'quiet' || action === 'quietOff') next.quiet = action === 'quiet';
  if (['playSound', 'stopSound', 'muteSound', 'unmuteSound', 'duckSound', 'holdSound', 'restoreSound'].includes(action)) audio = action;
  if (action === 'pause') audio = 'stopSound';
  return { session: next, audio };
}
