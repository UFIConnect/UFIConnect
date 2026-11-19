import { useCallback, useEffect, useState } from 'react';

export default function useFocusPhoneDiagnostics(active, visible) {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  const [permissions, setPermissions] = useState({ geolocation: 'unknown', camera: 'unknown', microphone: 'unknown', notifications: 'unknown' });
  const [events, setEvents] = useState([]);
  const [keepAwake, setKeepAwake] = useState(false);
  const [awake, setAwake] = useState(false);
  const [wakeError, setWakeError] = useState('');
  const wakeSupported = Boolean(navigator.wakeLock?.request);
  const record = useCallback((code, message) => {
    const at = Date.now();
    setEvents(current => current[0]?.code === code && current[0]?.message === message && at - current[0].at < 5000
      ? current : [{ code, message, at }, ...current].slice(0, 30));
  }, []);

  useEffect(() => {
    const update = () => {
      const connected = navigator.onLine !== false;
      setOnline(connected);
      record(connected ? 'NETWORK_ONLINE' : 'NETWORK_OFFLINE', connected
        ? 'Device reports a network connection. Office connectivity still requires a successful request.'
        : 'Device reports offline. Local GPS may continue; shared updates need a connection.');
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [record]);

  useEffect(() => {
    let live = true;
    const cleanup = [];
    for (const name of ['geolocation', 'camera', 'microphone', 'notifications']) {
      Promise.resolve().then(() => navigator.permissions?.query({ name })).then(status => {
        if (!status || !live) return;
        const update = () => {
          if (!live) return;
          setPermissions(current => ({ ...current, [name]: status.state }));
          record('PERMISSION_STATUS', `${name} permission reported by browser: ${status.state}.`);
        };
        update();
        status.addEventListener?.('change', update);
        cleanup.push(() => status.removeEventListener?.('change', update));
      }).catch(() => {});
    }
    return () => { live = false; cleanup.forEach(remove => remove()); };
  }, [record]);

  useEffect(() => { if (!active) setKeepAwake(false); }, [active]);
  useEffect(() => {
    let live = true, lock;
    if (!active || !visible || !keepAwake || !wakeSupported) return undefined;
    setWakeError('');
    Promise.resolve().then(() => navigator.wakeLock.request('screen')).then(result => {
      if (!live) { void result.release().catch(() => {}); return; }
      lock = result;
      setAwake(!result.released);
      record('SCREEN_AWAKE', 'Screen wake lock acquired while tracking is visible.');
      result.addEventListener('release', () => {
        if (!live) return;
        setAwake(false);
        record('SCREEN_RELEASED', 'The browser released the screen wake lock.');
      });
    }).catch(() => {
      if (!live) return;
      setAwake(false);
      setWakeError('The browser could not keep the screen awake.');
      record('SCREEN_LOCK_UNAVAILABLE', 'Screen wake lock request failed.');
    });
    return () => { live = false; setAwake(false); void lock?.release().catch(() => {}); };
  }, [active, visible, keepAwake, wakeSupported, record]);

  return { online, permission: permissions.geolocation, permissions, events, record, clear: () => setEvents([]),
    keepAwake, setKeepAwake, awake, wakeSupported, wakeError };
}
