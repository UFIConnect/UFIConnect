import { useCallback, useEffect, useRef, useState } from 'react';
import { locationOptions, readLocationFix } from './focus-geofence.mjs';
import { locationMessage } from './useFocusLocation';

export default function useFocusPinLocation(target) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');
  const currentRequest = useRef(0);

  const cancel = useCallback(() => {
    currentRequest.current++;
    setCapturing(false);
    setError('');
  }, []);

  useEffect(() => {
    cancel();
    if (!target) return undefined;
    const onVisibility = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      currentRequest.current++;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [target, cancel]);

  function locate(placePin) {
    if (!target || capturing || document.hidden) return;
    if (!window.isSecureContext || !navigator.geolocation) {
      setError('This browser needs a secure connection to use device location.');
      return;
    }
    const request = ++currentRequest.current;
    setCapturing(true);
    setError('');
    const finish = (position, failure) => {
      if (currentRequest.current !== request || document.hidden) return;
      setCapturing(false);
      const fix = readLocationFix(position, Date.now());
      if (!fix) { setError(locationMessage(failure ?? { code: 3 })); return; }
      const { latitude, longitude, accuracy } = fix;
      placePin({ latitude, longitude, accuracy });
    };
    try {
      navigator.geolocation.getCurrentPosition(position => finish(position), failure => finish(null, failure), locationOptions());
    } catch (failure) { finish(null, failure); }
  }

  return { capturing, error, locate, cancel };
}
