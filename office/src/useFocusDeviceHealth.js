import { useEffect, useRef, useState } from 'react';
import { addPageStalls, deviceBattery, deviceConnection, diagnosticOptions, DIAGNOSTIC_OPTIONS_KEY, requestDiagnosticResponse, storageEstimate } from './focus-device-health.mjs';

export default function useFocusDeviceHealth(active, visible, transport) {
  const [options, setOptions] = useState(() => {
    try { return diagnosticOptions(JSON.parse(localStorage.getItem(DIAGNOSTIC_OPTIONS_KEY))); }
    catch { return diagnosticOptions(); }
  });
  const [optionsError, setOptionsError] = useState('');
  const [connection, setConnection] = useState(null);
  const [battery, setBattery] = useState(null);
  const [batteryError, setBatteryError] = useState('');
  const [performanceError, setPerformanceError] = useState('');
  const [stalls, setStalls] = useState({ count: 0, totalMs: 0, worstMs: 0 });
  const [loop, setLoop] = useState({ delayed: 0, worstMs: 0 });
  const [storage, setStorage] = useState(null);
  const [storageError, setStorageError] = useState('');
  const [errors, setErrors] = useState({ script: 0, promise: 0, lastAt: null });
  const [revision, setRevision] = useState(0);
  const [probeResult, setProbeResult] = useState(null);
  const probe = useRef(null);
  const storageSupported = Boolean(navigator.storage?.estimate);
  const connectionApi = navigator.connection ?? navigator.mozConnection ?? navigator.webkitConnection;
  const performanceSupported = Boolean(globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask'));
  useEffect(() => {
    try { localStorage.setItem(DIAGNOSTIC_OPTIONS_KEY, JSON.stringify(diagnosticOptions(options))); setOptionsError(''); }
    catch { setOptionsError('Diagnostic choices could not be saved in this browser.'); }
  }, [options]);
  useEffect(() => {
    if (!active || !visible || !options.network) return undefined;
    const update = () => setConnection(deviceConnection(connectionApi));
    update();
    connectionApi?.addEventListener?.('change', update);
    return () => connectionApi?.removeEventListener?.('change', update);
  }, [active, visible, options.network, connectionApi, revision]);
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
  }, [active, visible, options.battery, revision]);
  useEffect(() => {
    if (!active || !visible || !options.performance || !performanceSupported) return undefined;
    setPerformanceError('');
    try {
      const observer = new globalThis.PerformanceObserver(list => setStalls(current => addPageStalls(current, list.getEntries())));
      observer.observe({ type: 'longtask', buffered: false });
      return () => observer.disconnect();
    } catch {
      setPerformanceError('This browser did not allow page performance observation.');
      return undefined;
    }
  }, [active, visible, options.performance, performanceSupported]);
  useEffect(() => {
    if (!active || !visible || !options.performance) return undefined;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), delay = Math.max(0, now - previous - 1000);
      previous = now;
      if (delay >= 50) setLoop(current => ({ delayed: current.delayed + 1, worstMs: Math.max(current.worstMs, Math.round(delay)) }));
    }, 1000);
    return () => clearInterval(timer);
  }, [active, visible, options.performance]);
  useEffect(() => {
    let live = true;
    if (!active || !visible || !options.storage || !storageSupported) return undefined;
    setStorageError('');
    Promise.resolve().then(async () => {
      const estimate = await navigator.storage.estimate();
      const persisted = await navigator.storage.persisted?.().catch(() => null);
      if (live) {
        const result = storageEstimate(estimate, persisted);
        setStorage(result);
        if (!result) setStorageError('The browser did not provide a usable site storage estimate.');
      }
    }).catch(() => { if (live) { setStorage(null); setStorageError('The browser did not provide a site storage estimate.'); } });
    return () => { live = false; };
  }, [active, visible, options.storage, storageSupported, revision]);
  useEffect(() => {
    if (!active || !visible || !options.errors) return undefined;
    const record = kind => setErrors(current => ({ ...current, [kind]: current[kind] + 1, lastAt: Date.now() }));
    // Keep counts only; error text, URLs and stacks may contain private data.
    const script = () => record('script'), promise = () => record('promise');
    window.addEventListener('error', script);
    window.addEventListener('unhandledrejection', promise);
    return () => { window.removeEventListener('error', script); window.removeEventListener('unhandledrejection', promise); };
  }, [active, visible, options.errors]);
  useEffect(() => () => {
    if (probe.current) {
      probe.current.abort(); probe.current = null;
      setProbeResult({ state: 'Cancelled', status: null, latency: null, at: Date.now() });
    }
  }, [active, visible, transport?.url]);

  async function testConnection() {
    if (!active || !visible || !transport?.request || probe.current) return;
    const controller = new AbortController();
    probe.current = controller;
    const start = performance.now();
    setProbeResult({ state: 'Checking', status: null, latency: null, at: Date.now() });
    try {
      const response = await requestDiagnosticResponse(transport.request, transport.url, { signal: controller.signal });
      void response.body?.cancel().catch(() => {});
      if (probe.current === controller) setProbeResult({ state: response.ok ? 'Reachable' : 'HTTP error',
        status: response.status, latency: Math.max(0, Math.round(performance.now() - start)), at: Date.now() });
    } catch {
      if (probe.current === controller) setProbeResult({ state: 'No response', status: null, latency: null, at: Date.now() });
    } finally { if (probe.current === controller) probe.current = null; }
  }
  return { options, setOptions, optionsError, connection, battery, batteryError, stalls, loop, storage, storageError,
    errors, probeResult, testConnection, probeSupported: Boolean(transport?.request && transport?.url),
    sampling: active && visible, storageSupported, refresh: () => setRevision(value => value + 1),
    performanceSupported: performanceSupported && !performanceError, performanceError,
    networkSupported: Boolean(connectionApi), batterySupported: Boolean(navigator.getBattery),
    clearStalls: () => { setStalls({ count: 0, totalMs: 0, worstMs: 0 }); setLoop({ delayed: 0, worstMs: 0 }); },
    clearErrors: () => setErrors({ script: 0, promise: 0, lastAt: null }) };
}
