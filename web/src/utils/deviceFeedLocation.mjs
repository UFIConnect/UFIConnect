const MAX_AGE_MS = 15 * 60 * 1000;
let location = null, generation = 0;

export function clearDeviceFeedLocation() { generation++; location = null; }
export function deviceFeedLocationHeader(token, now = Date.now()) {
  if (!token || location?.token !== token || now - location.timestamp > MAX_AGE_MS) return null;
  return JSON.stringify([location.lat, location.lon, location.accuracy, location.timestamp]);
}
export function deviceFeedLocationKey(now = Date.now()) {
  return location && now - location.timestamp <= MAX_AGE_MS ? `${Math.round(location.lat * 100)}:${Math.round(location.lon * 100)}` : '';
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
export function startDeviceFeedLocation({ token, onChange, navigator: browser, document: page, schedule = setInterval, unschedule = clearInterval, now = Date.now }) {
  const ownGeneration = ++generation;
  location = null;
  let active = true, pending = false, permission, timer;
  const current = () => active && generation === ownGeneration;
  const clear = () => { if (current()) { location = null; onChange(); } };
  const permissionChanged = () => { if (permission?.state === 'denied') clear(); else refresh(); };
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
      if (permission?.state === 'denied') { clear(); pending = false; return; }
      browser.geolocation.getCurrentPosition(position => {
        if (!current()) return;
        pending = false;
        if (permission?.state === 'denied') { clear(); return; }
        const { latitude: lat, longitude: lon, accuracy } = position.coords || {};
        const timestamp = position.timestamp;
        if (![lat, lon, accuracy, timestamp].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180
          || accuracy < 0 || accuracy > 9920 || timestamp > now() + 60000 || now() - timestamp > MAX_AGE_MS) { clear(); return; }
        // About 100 m precision is enough for a 100-mile recommendation area.
        // Include rounding uncertainty in the boundary test on the server.
        location = { token, lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000,
          accuracy: Math.ceil(accuracy + 80), timestamp };
        onChange();
      }, () => { if (current()) { pending = false; clear(); } }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    } catch { pending = false; clear(); }
  }
  const visible = () => { if (!page?.hidden) refresh(); };
  page?.addEventListener?.('visibilitychange', visible);
  timer = schedule(refresh, 5 * 60 * 1000);
  refresh();
  return () => {
    active = false;
    unschedule(timer);
    page?.removeEventListener?.('visibilitychange', visible);
    permission?.removeEventListener?.('change', permissionChanged);
    if (generation === ownGeneration) { generation++; location = null; }
  };
}
