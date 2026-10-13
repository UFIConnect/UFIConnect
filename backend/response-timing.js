'use strict';

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE']);
const roundMs = value => Math.round(value * 1000) / 1000;
const boundedInteger = (value, fallback, min, max) => Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback;

function routeIdentity(req) {
  const method = METHODS.has(req.method) ? req.method : 'OTHER';
  // Express supplies this pattern from registered application code. Never
  // retain originalUrl, baseUrl (which can contain IDs), params, or queries.
  const pattern = req.route?.path;
  const route = typeof pattern === 'string' && pattern.startsWith('/')
    ? pattern.slice(0, 180)
    : pattern ? '[route pattern]' : '[unmatched]';
  return { method, route };
}

function addTimingHeader(res, args, metric) {
  const index = typeof args[1] === 'string' ? 2 : 1;
  const headers = args[index];
  let previous = res.getHeader('Server-Timing');
  const join = value => [Array.isArray(value) ? value.join(', ') : value, metric].filter(Boolean).join(', ');
  if (Array.isArray(headers)) {
    const updated = [];
    const explicit = [];
    for (let i = 0; i < headers.length; i += 2) {
      if (String(headers[i]).toLowerCase() === 'server-timing') explicit.push(headers[i + 1]);
      else updated.push(headers[i], headers[i + 1]);
    }
    if (explicit.length) previous = explicit.join(', ');
    updated.push('Server-Timing', join(previous));
    args[index] = updated;
  } else if (headers && typeof headers === 'object') {
    const updated = { ...headers };
    for (const name of Object.keys(updated)) {
      if (name.toLowerCase() !== 'server-timing') continue;
      previous = updated[name];
      delete updated[name];
    }
    updated['Server-Timing'] = join(previous);
    args[index] = updated;
  } else {
    res.setHeader('Server-Timing', join(previous));
  }
}

function createResponseTiming({ targetMs = 45, maxRoutes = 128, samplesPerRoute = 128,
  aggregateSamples = 1024, now = process.hrtime.bigint } = {}) {
  const target = Number.isFinite(targetMs) && targetMs > 0 ? targetMs : 45;
  const routeLimit = boundedInteger(maxRoutes, 128, 2, 512);
  const routeSamples = boundedInteger(samplesPerRoute, 128, 1, 1024);
  const totalSamples = boundedInteger(aggregateSamples, 1024, 1, 8192);
  const routes = new Map();
  const bucket = capacity => ({ capacity, samples: [], count: 0, max: 0, overTarget: 0 });
  const overall = bucket(totalSamples);

  function record(entry, duration) {
    entry.samples[entry.count % entry.capacity] = duration;
    entry.count += 1;
    entry.max = Math.max(entry.max, duration);
    if (duration > target) entry.overTarget += 1;
  }
  function recordRoute(req, duration) {
    record(overall, duration);
    let identity = routeIdentity(req);
    let key = `${identity.method} ${identity.route}`;
    if (!routes.has(key) && routes.size >= routeLimit - 1) {
      identity = { method: 'MULTIPLE', route: '[additional routes]' };
      key = 'overflow';
    }
    if (!routes.has(key)) routes.set(key, { ...identity, ...bucket(routeSamples) });
    record(routes.get(key), duration);
  }

  function middleware(req, res, next) {
    const startedAt = now();
    const writeHead = res.writeHead;
    let measured = false;
    res.writeHead = function timedWriteHead(...args) {
      if (measured) return writeHead.apply(this, args);
      let duration;
      try {
        duration = Math.max(0, Number(now() - startedAt) / 1e6);
        if (Number.isFinite(duration)) addTimingHeader(this, args, `api;dur=${duration.toFixed(3)}`);
        else duration = undefined;
      } catch {
        // Diagnostics must not stop an otherwise valid response.
        duration = undefined;
      }
      const result = writeHead.apply(this, args);
      measured = true;
      if (duration !== undefined) recordRoute(req, duration);
      return result;
    };
    next();
  }

  function summarize(entry) {
    const sorted = [...entry.samples].sort((a, b) => a - b);
    const percentile = quantile => sorted.length ? roundMs(sorted[Math.ceil(sorted.length * quantile) - 1]) : null;
    return {
      count: entry.count,
      sampleCount: sorted.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: entry.count ? roundMs(entry.max) : null,
      overTargetCount: entry.overTarget,
    };
  }
  function snapshot() {
    return {
      targetMs: target,
      measurement: 'request start to first response headers',
      includes: 'Server work and awaited I/O, including database or inline upstream calls',
      excludes: ['Client network transit', 'Response streaming duration', 'Background source collection'],
      percentileWindow: { aggregateSamples: totalSamples, samplesPerRoute: routeSamples, maxRoutes: routeLimit },
      overall: summarize(overall),
      routes: [...routes.values()].map(entry => ({ method: entry.method, route: entry.route, ...summarize(entry) })),
    };
  }
  return { middleware, snapshot };
}

module.exports = { createResponseTiming };
