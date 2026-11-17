const { randomUUID } = require('node:crypto');

const PATH = '/office/focus/live';
const POSITION_LIFETIME_MS = 25_000;
const SESSION_LIFETIME_MS = 90_000;
const SOURCE_CAPACITY = 40;
const SOURCE_TYPES = new Set(['phone', 'equipment', 'bicycle', 'vehicle']);
const VEHICLE_TYPES = new Set(['sedan', 'hatchback', 'coupe', 'wagon', 'suv', 'pickup', 'van', 'truck', 'motorcycle', 'other']);
const between = (value, minimum, maximum) => Number.isFinite(value) && value >= minimum && value <= maximum;

function sourceDetails(input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const { kind, type } = input ?? {};
  if (!name || name.length > 80 || !SOURCE_TYPES.has(kind) || kind === 'vehicle' && !VEHICLE_TYPES.has(type)) return null;
  return { name, kind, type: kind === 'vehicle' ? type : '' };
}

function readPosition(input, now) {
  const { latitude, longitude, accuracy, speed, heading, age } = input ?? {};
  if (!between(latitude, -90, 90) || !between(longitude, -180, 180) ||
    !between(accuracy, 0, 5000) || !between(age, 0, POSITION_LIFETIME_MS - 1)) return null;
  return { latitude, longitude, accuracy, timestamp: now - age,
    speed: between(speed, 0, 120) ? speed : null, heading: between(heading, 0, 359.9999) ? heading : null };
}

function registerOfficeFocusLive(app, { requireOfficeToken, api, json, now = Date.now }) {
  const sessions = new Map();
  let cleanup;
  const removeExpired = time => {
    for (const [id, source] of sessions) {
      if (time - source.updatedAt >= SESSION_LIFETIME_MS) sessions.delete(id);
      else if (source.fix && time - source.fix.timestamp >= POSITION_LIFETIME_MS) source.fix = null;
    }
    if (!sessions.size) { clearInterval(cleanup); cleanup = undefined; }
  };
  const noStore = (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!api) return res.status(404).json({ error: 'Live devices are available from the Office API.' });
    next();
  };
  const parse = json({ limit: '1kb', strict: true });
  const invalidBody = (error, _req, res, _next) =>
    res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid live device request.' });
  const publisher = (req, res, next) => {
    removeExpired(now());
    const source = sessions.get(req.params.id);
    if (!source || req.get('x-focus-publisher') !== source.publisher) {
      return res.status(404).json({ error: 'This location sharing session has ended.' });
    }
    req.focusPublisher = source;
    next();
  };
  app.get(PATH, noStore, requireOfficeToken, (_req, res) => {
    const time = now();
    removeExpired(time);
    const sources = [...sessions].flatMap(([id, source]) => {
      if (!source.fix) return [];
      const { timestamp, ...coords } = source.fix;
      return [{ id, ...source.details, observedAt: timestamp, fix: { ...coords, age: time - timestamp } }];
    });
    res.json({ sources });
  });
  app.post(PATH, noStore, requireOfficeToken, parse, invalidBody, (req, res) => {
    const time = now();
    const details = sourceDetails(req.body);
    if (!details) return res.status(400).json({ error: 'Provide a name and a supported tracking type.' });
    removeExpired(time);
    if (sessions.size >= SOURCE_CAPACITY) return res.status(429).json({ error: 'Too many active sharing sessions.' });
    const id = randomUUID(), publisher = randomUUID();
    sessions.set(id, { publisher, details, updatedAt: time, fix: null });
    if (!cleanup) {
      cleanup = setInterval(() => removeExpired(now()), 5000);
      cleanup.unref();
    }
    res.status(201).json({ id, publisher });
  });
  app.put(PATH + '/:id', noStore, requireOfficeToken, publisher, parse, invalidBody, (req, res) => {
    const time = now();
    const fix = readPosition(req.body, time);
    if (!fix) return res.status(400).json({ error: 'A fresh GPS reading is required.' });
    const source = req.focusPublisher;
    // A stop or expiry can happen while Express is still parsing the PUT.
    if (sessions.get(req.params.id) !== source || time - source.updatedAt >= SESSION_LIFETIME_MS) {
      return res.status(404).json({ error: 'This location sharing session has ended.' });
    }
    if (source.fix && fix.timestamp <= source.fix.timestamp) return res.status(204).end();
    if (source.fix && time - source.updatedAt < 1000) return res.status(429).json({ error: 'Wait for the next GPS update.' });
    source.fix = fix;
    source.updatedAt = time;
    res.status(204).end();
  });
  app.delete(PATH + '/:id', noStore, requireOfficeToken, publisher, (req, res) => {
    sessions.delete(req.params.id);
    removeExpired(now());
    res.status(204).end();
  });
}

module.exports = { registerOfficeFocusLive };
