const MAX_AGE_MS = 15 * 60 * 1000;
let location = null, generation = 0;

export function clearDeviceFeedLocation() { generation++; location = null; }
function currentLocation(token, now) {
  return token && location?.token === token && now - location.timestamp <= MAX_AGE_MS ? location : null;
}
export function deviceFeedLocationHeader(token, now = Date.now()) {
  const point = currentLocation(token, now);
  return point ? JSON.stringify([point.lat, point.lon, point.accuracy, point.timestamp]) : null;
}
export function deviceFeedLocationAccuracy(token, now = Date.now()) {
  return currentLocation(token, now)?.accuracy ?? null;
}
export function deviceFeedLocationKey(now = Date.now(), { precision = 100, maxAccuracy = Infinity } = {}) {
  return location && now - location.timestamp <= MAX_AGE_MS && location.accuracy <= maxAccuracy
    ? `${Math.round(location.lat * precision)}:${Math.round(location.lon * precision)}` : '';
}

export function deviceFeedRequestHeader(config, token, now = Date.now()) {
  const path = String(config?.url || '').split('?')[0];
  // Only feed reads and the exact local-account recommendation endpoint need
  // this session location. OAuth, account settings and other social calls do not.
  const locatedRead = /^\/(?:office\/)?feed(?:\/(?:location|music|videos(?:\/following)?))?$/.test(path)
    || path === '/social/platforms/location';
  if (!token || config?.headers?.Authorization !== `Bearer ${token}`
    || String(config.method || 'get').toLowerCase() !== 'get'
    || !locatedRead) return null;
  return deviceFeedLocationHeader(token, now);
}

// The browser owns permission. Location stays in memory for this signed-in
// session and is never written to storage or to the member's public profile.
export function startDeviceFeedLocation({ token, onChange, navigator: browser, document: page, allowAutomaticPrompt = false,
  schedule = setInterval, unschedule = clearInterval, now = Date.now }) {
  const ownGeneration = ++generation;
  location = null;
  let active = true, pending = false, located = false, permission, timer, requested, automaticRequest;
  const current = () => active && generation === ownGeneration;
  const clear = () => { if (current() && location) { location = null; onChange(); } };
  function finishRequest(available) {
    const request = requested;
    requested = null;
    request?.resolve(available);
  }
  function unavailable() {
    pending = false;
    clear();
    finishRequest(false);
  }
  const permissionChanged = () => {
    if (permission?.state === 'denied') { clear(); finishRequest(false); }
    else refresh();
  };
  async function refresh() {
    if (!current() || pending || page?.hidden || !browser?.geolocation) return;
    pending = true;
    try {
      if (!permission && browser.permissions?.query) {
        try {
          permission = await browser.permissions.query({ name: 'geolocation' });
          if (!current()) return;
          permission.addEventListener?.('change', permissionChanged);
        } catch { /* Some browsers expose geolocation without Permissions API. */ }
      }
      if (!current()) return;
      if (permission?.state === 'denied') { unavailable(); return; }
      const canLocate = requested || allowAutomaticPrompt || permission?.state === 'granted' || (!permission && located);
      if (!canLocate) { pending = false; return; }
      browser.geolocation.getCurrentPosition(position => {
        if (!current()) return;
        pending = false;
        if (permission?.state === 'denied') { unavailable(); return; }
        const { latitude: lat, longitude: lon, accuracy } = position.coords || {};
        const timestamp = position.timestamp;
        if (![lat, lon, accuracy, timestamp].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180
          || accuracy < 0 || accuracy > 9920 || timestamp > now() + 60000 || now() - timestamp > MAX_AGE_MS) { unavailable(); return; }
        // About 100 m precision is enough for a 100-mile recommendation area.
        // Include rounding uncertainty in the boundary test on the server.
        location = { token, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000,
          accuracy: Math.ceil(accuracy + 80), timestamp };
        located = true;
        onChange();
        finishRequest(true);
      }, error => {
        if (!current()) return;
        if (error?.code === 1) located = false;
        unavailable();
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    } catch { if (current()) unavailable(); }
  }
  const visible = () => { if (!page?.hidden) refresh(); };
  page?.addEventListener?.('visibilitychange', visible);
  timer = schedule(refresh, 5 * 60 * 1000);
  refresh();
  function stop() {
    active = false;
    unschedule(timer);
    page?.removeEventListener?.('visibilitychange', visible);
    permission?.removeEventListener?.('change', permissionChanged);
    if (generation === ownGeneration) { generation++; location = null; }
    finishRequest(false);
  }
  function requestLocation() {
    if (!current() || !browser?.geolocation) return Promise.resolve(false);
    if (requested) return requested.promise;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    requested = { promise, resolve };
    void refresh();
    return promise;
  }
  function requestLocationOnce() {
    if (currentLocation(token, now())) return Promise.resolve(true);
    automaticRequest ??= requestLocation();
    return automaticRequest;
  }
  return { stop, requestLocation, requestLocationOnce };
}
