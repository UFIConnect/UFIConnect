// Explicitly configured staging traffic only; no production defaults or tokens.
import fs from 'node:fs/promises';
import { createHistogram, performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const env = process.env;
const number = (name, fallback, min, max) => {
  const value = env[name] === undefined ? fallback : Number(env[name]);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
};
if (env.VIDEO_LOAD_STAGING !== '1') throw new Error('Set VIDEO_LOAD_STAGING=1 for a prepared staging environment.');
const base = new URL(env.VIDEO_LOAD_BASE_URL || '');
const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
if ((!localhost && base.protocol !== 'https:') || !['https:', 'http:'].includes(base.protocol)
    || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
  throw new Error('VIDEO_LOAD_BASE_URL must be a staging HTTPS origin (HTTP is allowed only for loopback).');
}
if (base.hostname === 'uficonnect.org' || base.hostname.endsWith('.uficonnect.org')
    || ['uficonnect-api-708r.onrender.com', 'uficonnect-pipeline-708r.onrender.com'].includes(base.hostname)) {
  throw new Error('Production UFIconnect hosts are not accepted by this staging runner.');
}
if (env.VIDEO_LOAD_HOST_CONFIRMATION !== base.hostname) throw new Error('VIDEO_LOAD_HOST_CONFIRMATION must exactly match the staging hostname.');
const records = JSON.parse(await fs.readFile(env.VIDEO_LOAD_USERS_FILE || '', 'utf8'));
if (!Array.isArray(records) || !records.length || records.some(record => typeof record.token !== 'string'
    || !record.token.trim() || !['videos', 'music'].includes(record.surface))) {
  throw new Error('The private users file must contain token and surface (videos/music) records.');
}
if (new Set(records.map(record => record.token)).size !== records.length) throw new Error('Use distinct staging account sessions, not repeated tokens.');
const users = records.map(record => ({ ...record, cursor: '', inFlight: false }));
const config = {
  origin: base.origin, accounts: users.length,
  rps: number('VIDEO_LOAD_RPS', 5, 1, 2000),
  seconds: number('VIDEO_LOAD_SECONDS', 60, 1, 3600),
  rampSeconds: number('VIDEO_LOAD_RAMP_SECONDS', 10, 0, 600),
  concurrency: Math.floor(number('VIDEO_LOAD_CONCURRENCY', 16, 1, 1024)),
};
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({ dryRun: true, ...config }));
} else {
  const latency = createHistogram();
  const pending = new Set();
  const statuses = {};
  let nextUser = 0, attempted = 0, completed = 0, emptyPages = 0, networkErrors = 0, dropped = 0, peakActive = 0;
  let stopping = false;
  process.once('SIGINT', () => { stopping = true; });
  const started = performance.now();
  let lastTick = started, credits = 0;

  async function requestPage(user) {
    const began = performance.now();
    const url = new URL(`/office/feed/${user.surface}`, base);
    url.searchParams.set('limit', '10');
    if (user.cursor) url.searchParams.set('cursor', user.cursor);
    try {
      const result = await fetch(url, { headers: { Authorization: `Bearer ${user.token}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      statuses[result.status] = (statuses[result.status] || 0) + 1;
      const body = await result.json().catch(() => null);
      if (result.ok) {
        if (!body?.posts?.length) emptyPages++;
        user.cursor = typeof body?.cursor === 'string' ? body.cursor : '';
      }
    } catch { networkErrors++; }
    finally {
      completed++;
      latency.record(Math.max(1, Math.round((performance.now() - began) * 1e6)));
      user.inFlight = false;
    }
  }

  while (!stopping && performance.now() - started < config.seconds * 1000) {
    const now = performance.now();
    const ramp = config.rampSeconds ? Math.min(1, (now - started) / (config.rampSeconds * 1000)) : 1;
    credits += ((now - lastTick) / 1000) * config.rps * ramp;
    lastTick = now;
    while (credits >= 1) {
      credits--;
      if (pending.size >= Math.min(config.concurrency, users.length)) { dropped++; continue; }
      let user;
      for (let i = 0; i < users.length; i++) {
        const candidate = users[nextUser++ % users.length];
        if (!candidate.inFlight) { user = candidate; break; }
      }
      if (!user) { dropped++; continue; }
      user.inFlight = true;
      attempted++;
      const task = requestPage(user);
      pending.add(task);
      task.finally(() => pending.delete(task));
      peakActive = Math.max(peakActive, pending.size);
    }
    await delay(25);
  }
  const arrivalSeconds = (performance.now() - started) / 1000;
  await Promise.all(pending);
  const totalSeconds = (performance.now() - started) / 1000;
  console.log(JSON.stringify({ ...config, interrupted: stopping, attempted, completed, statuses, networkErrors, emptyPages,
    generatorDropped: dropped, peakActive,
    attemptedPerSecond: +(attempted / arrivalSeconds).toFixed(2), completedPerSecond: +(completed / totalSeconds).toFixed(2),
    latencyMs: { p50: +(latency.percentile(50) / 1e6).toFixed(2), p95: +(latency.percentile(95) / 1e6).toFixed(2), p99: +(latency.percentile(99) / 1e6).toFixed(2) },
  }, null, 2));
  if (networkErrors || Object.keys(statuses).some(status => Number(status) >= 400) || dropped) process.exitCode = 1;
}
