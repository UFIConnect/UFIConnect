import React, { useEffect, useState } from 'react';
import { AppState, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { createBackgroundFocus } from './focusBackground.cjs';

const key = field => `ufi.focus.${field}`;
const storageOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const focus = createBackgroundFocus(Location, TaskManager, {
  read: async field => JSON.parse(await SecureStore.getItemAsync(key(field), storageOptions)),
  write: (field, value) => SecureStore.setItemAsync(key(field), JSON.stringify(value), storageOptions),
  remove: field => SecureStore.deleteItemAsync(key(field), storageOptions),
}, Platform.OS);

function Action({ label, onPress, disabled = false }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={[styles.button, disabled && styles.disabled]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}

function FocusSettings({ close }) {
  const [state, setState] = useState(null);
  const [zone, setZone] = useState({ latitude: '', longitude: '', radius: '250' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    let initialized = false;
    async function refresh() {
      if (AppState.currentState === 'background') return;
      try {
        const value = await focus.snapshot();
        if (!active) return;
        setState(value);
        if (!initialized && value.zone) setZone({
          latitude: String(value.zone.latitude), longitude: String(value.zone.longitude), radius: String(value.zone.radius),
        });
        initialized = true;
      } catch {
        if (active) setError('Could not read Focus location settings.');
      }
    }
    void refresh();
    const subscription = AppState.addEventListener('change', refresh);
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); subscription.remove(); };
  }, []);

  async function run(operation) {
    setBusy(true);
    setError('');
    try {
      await operation();
      setState(await focus.snapshot());
    } catch (failure) {
      setError(failure.message || 'Could not update Focus location settings.');
    } finally { setBusy(false); }
  }

  const disabled = busy || !state;
  const formatTime = timestamp => new Date(timestamp).toLocaleString();
  return <SafeAreaView style={styles.screen}>
    <ScrollView contentContainerStyle={styles.panel}>
      <Action label="Done" onPress={close} disabled={busy} />
      <Text accessibilityRole="header" style={styles.title}>Focus location</Text>
      <Text style={styles.body}>Both options are off until you turn them on. UFIConnect keeps the latest reading and zone event on this device.</Text>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.heading}>Background Live Location</Text>
        <Text style={styles.body}>Update your last location while you use another app or lock your device.</Text>
        <Action label={state?.live ? 'Stop live location' : 'Start live location'} disabled={disabled}
          onPress={() => void run(() => focus.live(!state.live))} />
        {state?.fix && <Text style={styles.body}>
          {state.fix.latitude.toFixed(6)}, {state.fix.longitude.toFixed(6)} · {formatTime(state.fix.timestamp)}
        </Text>}
      </View>
      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.heading}>Background Geofencing</Text>
        <Text style={styles.body}>Monitor arrivals and exits for a circular zone while Focus is closed.</Text>
        <Action label="Use my location for zone" disabled={disabled || state?.monitoring}
          onPress={() => void run(async () => {
            const coords = await focus.current();
            setZone(current => ({ ...current, latitude: String(coords.latitude), longitude: String(coords.longitude) }));
          })} />
        {Object.entries({ latitude: 'Latitude', longitude: 'Longitude', radius: 'Radius in meters' }).map(([field, label]) =>
          <View key={field} style={styles.field}>
            <Text style={styles.body}>{label}</Text>
            <TextInput accessibilityLabel={label} style={styles.input} value={zone[field]}
              editable={!disabled && !state?.monitoring} keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              onChangeText={value => setZone(current => ({ ...current, [field]: value }))} />
          </View>)}
        <Action label={state?.monitoring ? 'Stop geofencing' : 'Start geofencing'} disabled={disabled}
          onPress={() => void run(() => focus.geofence(!state.monitoring,
            Object.fromEntries(Object.entries(zone).map(([field, value]) => [field, value.trim() ? Number(value) : NaN]))))} />
        {state?.event && <Text style={styles.body}>
          {state.event.inside ? 'Last reported inside' : 'Last reported outside'} · {formatTime(state.event.timestamp)}
        </Text>}
      </View>
      {(state?.live || state?.monitoring) && !state.available &&
        <Text accessibilityRole="alert" style={styles.error}>Background permission or location services are off.</Text>}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </ScrollView>
  </SafeAreaView>;
}

export default function NativeFocus({ onVisibilityChange }) {
  const [open, setOpen] = useState(false);
  function show(visible) { setOpen(visible); onVisibilityChange(visible); }
  return <View style={styles.launcher}>
    <Action label="Focus location" onPress={() => show(true)} />
    {open && <Modal visible onRequestClose={() => show(false)}><FocusSettings close={() => show(false)} /></Modal>}
  </View>;
}

const styles = StyleSheet.create({
  launcher: { alignItems: 'center', paddingVertical: 4 },
  screen: { flex: 1, backgroundColor: '#0d1529' },
  panel: { padding: 20, gap: 16, maxWidth: 680, alignSelf: 'center', width: '100%' },
  title: { fontSize: 29, fontWeight: '800', color: '#f4f7ff' },
  heading: { fontSize: 19, fontWeight: '700', color: '#f4f7ff' },
  body: { color: '#c8d6ef', lineHeight: 21 },
  card: { padding: 16, gap: 12, borderRadius: 14, backgroundColor: '#16233d' },
  button: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', alignSelf: 'flex-start', borderRadius: 9, backgroundColor: '#29457c' },
  buttonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  field: { gap: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: '#627ba4', color: '#fff', borderRadius: 9, paddingHorizontal: 10 },
  error: { color: '#ffb8ab' },
});
