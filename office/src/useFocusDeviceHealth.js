import { useEffect, useState } from 'react';
import { addPageStalls, deviceBattery, deviceConnection } from './focus-device-health.mjs';

export default function useFocusDeviceHealth(active, visible) {
  const [options, setOptions] = useState({ network: true, battery: false, performance: false });
  const [connection, setConnection] = useState(null);
  const [battery, setBattery] = useState(null);
  const [batteryError, setBatteryError] = useState('');
  const [performanceError, setPerformanceError] = useState('');
  const [stalls, setStalls] = useState({ count: 0, totalMs: 0, worstMs: 0 });
  const connectionApi = navigator.connection ?? navigator.mozConnection ?? navigator.webkitConnection;
  const performanceSupported = Boolean(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask'));
  useEffect(() => {
    if (!active || !visible || !options.network) return undefined;
    const update = () => setConnection(deviceConnection(connectionApi));
    update();
    connectionApi?.addEventListener?.('change', update);
    return () => connectionApi?.removeEventListener?.('change', update);
  }, [active, visible, options.network, connectionApi]);
  useEffect(() => {
    let live = true, source;
    if (!active || !visible || !options.battery || !navigator.getBattery) return undefined;
    const update = () => { if (live) setBattery(deviceBattery(source)); };
    setBatteryError('');
    Promise.resolve().then(() => navigator.getBattery()).then(result => {
      if (!live) return;
      source = result;
      update();
      source.addEventListener('levelchange', update);
      source.addEventListener('chargingchange', update);
    }).catch(() => { if (live) setBatteryError('The browser did not provide battery data.'); });
    return () => {
      live = false;
      source?.removeEventListener('levelchange', update);
      source?.removeEventListener('chargingchange', update);
    };
  }, [active, visible, options.battery]);
  useEffect(() => {
    if (!active || !visible || !options.performance || !performanceSupported) return undefined;
    try {
      const observer = new globalThis.PerformanceObserver(list => setStalls(current => addPageStalls(current, list.getEntries())));
      observer.observe({ type: 'longtask', buffered: false });
      return () => observer.disconnect();
    } catch {
      setPerformanceError('This browser did not allow page performance observation.');
      return undefined;
    }
  }, [active, visible, options.performance, performanceSupported]);
  return { options, setOptions, connection, battery, batteryError, stalls,
    performanceSupported: performanceSupported && !performanceError, performanceError,
    networkSupported: Boolean(connectionApi), batterySupported: Boolean(navigator.getBattery),
    clearStalls: () => setStalls({ count: 0, totalMs: 0, worstMs: 0 }) };
}
