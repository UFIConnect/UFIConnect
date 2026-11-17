import { useCallback, useEffect, useRef, useState } from 'react';
import { locationOptions, readLocationFix } from './focus-geofence.mjs';
import { locationMessage } from './useFocusLocation';

export default function useFocusPinLocation(target) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const activeRequest = useRef(null);

  const stop = useCallback(() => {
    const cleanup = activeRequest.current;
    activeRequest.current = null;
    cleanup?.();
  }, []);

  const cancel = useCallback(() => {
    stop();
    setCapturing(false);
    setError('');
  }, [stop]);

  useEffect(() => {
    cancel();
    if (!target) return undefined;
    const onVisibility = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [target, cancel, stop]);

  function locate(placePin, { maxAccuracy } = {}) {
    if (!target || activeRequest.current || document.hidden) return;
    const device = navigator.geolocation;
    if (!window.isSecureContext || !device) {
      setError('This browser needs a secure connection to use device location.');
      return;
    }
    const options = locationOptions();
    let timer;
    let watchId;
    function cleanup() {
      window.clearTimeout(timer);
      if (watchId !== undefined) device.clearWatch(watchId);
    }
    activeRequest.current = cleanup;
    setCapturing(true);
    setError('');
    function finish(fix, message) {
      if (activeRequest.current !== cleanup || document.hidden) return;
      stop();
      setCapturing(false);
      if (fix) {
        const { latitude, longitude, accuracy } = fix;
        placePin({ latitude, longitude, accuracy });
      } else setError(message);
    }
    function update(position) {
      const fix = readLocationFix(position, Date.now());
      if (maxAccuracy !== undefined && (!fix || fix.accuracy > maxAccuracy)) return;
      finish(fix, locationMessage({ code: 3 }));
    }
    const fail = failure => finish(null, locationMessage(failure));
    try {
      if (maxAccuracy === undefined) {
        device.getCurrentPosition(update, fail, options);
      } else {
        timer = window.setTimeout(() => finish(null, 'GPS took too long. Try again or select Start walk to keep waiting.'), options.timeout);
        watchId = device.watchPosition(update, failure => {
          if (failure?.code === 1) fail(failure);
        }, options);
      }
    } catch (failure) { fail(failure); }
  }

  return { capturing, error, locate, cancel };
}
