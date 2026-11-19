const finite = value => Number.isFinite(value) && value >= 0 ? value : null;
export const DIAGNOSTIC_OPTIONS_KEY = 'ufi-office-diagnostics-v1';
export function diagnosticOptions(input) {
  return Object.fromEntries(['network', 'battery', 'performance', 'storage', 'errors'].map(key =>
    [key, typeof input?.[key] === 'boolean' ? input[key] : key === 'network']));
}
export function storageEstimate(estimate, persisted, now = Date.now()) {
  const usage = finite(estimate?.usage), quota = finite(estimate?.quota);
  if (usage === null || quota === null || !quota || usage > quota) return null;
  return { usage, quota, percent: Math.round(usage / quota * 100),
    persisted: typeof persisted === 'boolean' ? persisted : null, observedAt: now };
}
export function deviceConnection(connection, now = Date.now()) {
  if (!connection) return null;
  return { type: ['slow-2g', '2g', '3g', '4g'].includes(connection.effectiveType) ? connection.effectiveType : 'Unavailable',
    downlink: finite(connection.downlink), rtt: finite(connection.rtt), saveData: connection.saveData === true, observedAt: now };
}
export function deviceBattery(battery, now = Date.now()) {
  if (!battery || !Number.isFinite(battery.level) || battery.level < 0 || battery.level > 1) return null;
  return { percent: Math.round(battery.level * 100), charging: battery.charging === true, observedAt: now };
}
export function addPageStalls(previous, entries) {
  const durations = entries.map(entry => entry.duration).filter(value => Number.isFinite(value) && value >= 50);
  return { count: previous.count + durations.length,
    totalMs: previous.totalMs + durations.reduce((sum, value) => sum + value, 0),
    worstMs: Math.max(previous.worstMs, ...durations) };
}

export function diagnosticReport(tracking, devices, health, now = Date.now()) {
  return {
    generatedAt: new Date(now).toISOString(), scope: 'This Office browser session',
    location: { active: tracking.active === true, paused: tracking.paused === true, continuous: tracking.continuous === true, visible: tracking.visible === true,
      lastAcceptedAt: tracking.lastAcceptedAt ?? null, rejectedReadings: tracking.rejectedReadings ?? 0 },
    permissions: Object.fromEntries(['geolocation', 'camera', 'microphone', 'notifications'].map(name =>
      [name, tracking.diagnostics?.permissions?.[name] ?? 'unknown'])),
    deviceReportsOnline: tracking.diagnostics?.online ?? null,
    sharing: Boolean(devices?.sharing), viewingSharedDevices: devices?.viewing === true,
    officeConnection: devices?.connection ? {
      status: devices.connection.status, latencyMs: devices.connection.latency,
      lastAttemptAt: devices.connection.attemptedAt, lastSuccessAt: devices.connection.successAt,
    } : null,
    browserNetworkEstimate: health?.options.network && health.connection ? {
      type: health.connection.type, downlink: health.connection.downlink, rtt: health.connection.rtt,
      saveData: health.connection.saveData, observedAt: health.connection.observedAt,
    } : null,
    batteryReport: health?.options.battery && health.battery ? {
      percent: health.battery.percent, charging: health.battery.charging, observedAt: health.battery.observedAt,
    } : null,
    pagePerformance: health?.options.performance ? { count: health.stalls.count, totalMs: health.stalls.totalMs,
      worstMs: health.stalls.worstMs, supported: health.performanceSupported } : null,
    pageResponsiveness: health?.options.performance && health.loop ? {
      delayed: health.loop.delayed, worstMs: health.loop.worstMs,
    } : null,
    siteStorage: health?.options.storage && health.storage ? {
      usage: health.storage.usage, quota: health.storage.quota, percent: health.storage.percent,
      persisted: health.storage.persisted, observedAt: health.storage.observedAt,
    } : null,
    pageErrors: health?.options.errors && health.errors ? {
      script: health.errors.script, promise: health.errors.promise, lastAt: health.errors.lastAt,
    } : null,
    connectionTest: health?.probeResult ? {
      status: health.probeResult.status, latencyMs: health.probeResult.latency,
      state: health.probeResult.state, at: health.probeResult.at,
    } : null,
    events: (tracking.diagnostics?.events ?? []).slice(0, 30).map(({ at, code, message }) => ({ at, code, message })),
    boundaryEvents: (tracking.boundaryEvents ?? []).slice(0, 30).map(({ at, type, action, reason }) => ({ at, type, action, reason })),
    limitations: ['Device labels do not verify a person’s identity.', 'No activity from other apps or vehicle hardware is inspected.',
      'GPS and connection failures do not establish their cause.', 'Hidden tabs and screen lock can pause browser GPS.'],
  };
}
