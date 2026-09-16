import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_PREFERENCES, PREFERENCES_KEY, parsePreferences, sanitizePreferences } from './dataPreferences';

const PreferencesContext = createContext(null);
export const usePreferences = () => useContext(PreferencesContext);

export default function PreferencesProvider({ children }) {
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState('');
  const current = useRef(DEFAULT_PREFERENCES);
  const readyRef = useRef(false);
  const listeners = useRef(new Set());
  const writes = useRef(Promise.resolve());
  const publish = useCallback(next => {
    current.current = next;
    // Stop optional collection synchronously, before painting a disabled switch.
    listeners.current.forEach(listener => listener(next, readyRef.current));
    setPreferences(next);
  }, []);
  const subscribe = useCallback(listener => {
    listeners.current.add(listener);
    listener(current.current, readyRef.current);
    return () => listeners.current.delete(listener);
  }, []);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(PREFERENCES_KEY).then(raw => {
      if (!active) return;
      publish(parsePreferences(raw));
    }).catch(() => {
      if (active) setStorageError('Saved preferences could not be loaded. Default settings are active.');
    }).finally(() => {
      if (active) {
        readyRef.current = true;
        publish(current.current);
        setReady(true);
      }
    });
    return () => { active = false; };
  }, [publish]);
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const changed = event => {
      if (event.storageArea !== globalThis.localStorage || (event.key !== null && event.key !== PREFERENCES_KEY)) return;
      publish(parsePreferences(event.newValue));
    };
    globalThis.addEventListener('storage', changed);
    return () => globalThis.removeEventListener('storage', changed);
  }, [publish]);

  function updatePreference(key, value) {
    if (!readyRef.current || !Object.hasOwn(DEFAULT_PREFERENCES, key) || typeof value !== 'boolean') return;
    const next = sanitizePreferences({ ...current.current, [key]: value });
    publish(next);
    // Preserve write order when controls are changed rapidly.
    writes.current = writes.current.catch(() => {}).then(() => AsyncStorage.setItem(PREFERENCES_KEY, JSON.stringify(next)))
      .then(() => setStorageError(''))
      .catch(() => setStorageError('This change applies now, but could not be saved on this device.'));
  }
  return <PreferencesContext.Provider value={{ preferences, ready, storageError, updatePreference, subscribe }}>{children}</PreferencesContext.Provider>;
}
