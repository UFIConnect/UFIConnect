import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createMobileAnalytics } from './analyticsClient';
import { createScreenTracker } from './screenPolicy';
import { COLORS } from '../theme';

const AnalyticsContext = createContext({ trackScreen: () => {} });
export const useAnalytics = () => useContext(AnalyticsContext);

export default function AnalyticsProvider({ children }) {
  const controllerRef = useRef(null);
  const latestScreenRef = useRef(null);
  const [available, setAvailable] = useState(false);
  const [consent, setConsent] = useState(null);
  const [persistenceError, setPersistenceError] = useState(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    // Strict Mode may set up, clean up, and set up this effect again. Give each
    // lifetime a fresh controller; never reuse one whose frame was disposed.
    const controller = createMobileAnalytics();
    controllerRef.current = controller;
    setAvailable(controller.available);
    const refresh = () => {
      setConsent(controller.getConsent());
      setPersistenceError(controller.getPersistenceError?.() || null);
    };
    refresh();
    const unsubscribe = controller.subscribe(refresh);
    createScreenTracker(controller)(latestScreenRef.current?.name, latestScreenRef.current?.navigationKey);
    return () => { controllerRef.current = null; unsubscribe(); controller.dispose(); };
  }, []);
  const context = useMemo(() => ({ available, consent, persistenceError, openPreferences: () => setPreferencesOpen(true), trackScreen(name, navigationKey) {
    latestScreenRef.current = { name, navigationKey };
    if (controllerRef.current) createScreenTracker(controllerRef.current)(name, navigationKey);
  } }), [available, consent, persistenceError]);
  function choose(value) {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.setConsent(value);
    setConsent(controller.getConsent());
    setPersistenceError(controller.getPersistenceError?.() || null);
    setPreferencesOpen(false);
  }
  const showPrompt = available && (preferencesOpen || !['granted', 'denied'].includes(consent));
  return (
    <AnalyticsContext.Provider value={context}>
      <View style={styles.application}>
      <View style={styles.application}>{children}</View>
      {available && !!persistenceError && <Text accessibilityRole="alert" style={styles.error}>{persistenceError}</Text>}
      {available && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Analytics preferences"
          style={[styles.preferences, { paddingBottom: Math.max(8, insets.bottom) }]} onPress={() => setPreferencesOpen(true)}>
          <Text style={styles.preferencesText}>Analytics preferences</Text>
        </TouchableOpacity>
      )}
      <Modal visible={showPrompt} transparent animationType="fade" onRequestClose={() => choose('denied')}>
        <View style={styles.backdrop}>
          <View style={styles.dialog} accessibilityViewIsModal accessibilityLabel="Analytics preferences">
            <Text style={styles.heading} accessibilityRole="header">Optional usage analytics</Text>
            <Text style={styles.description}>Allow Google Analytics to count visits to general app screens so we can improve UFIConnect? We send fixed screen categories, without names, emails, passwords, messages, search text, or account IDs. Google also receives connection and device information.</Text>
            <Text style={styles.description}>Analytics stays off until you allow it. You can change your choice here at any time.</Text>
            <Text style={styles.description}>Required service metrics and aggregate screen counts remain active. Manage data use and optional error counts in Data & privacy.</Text>
            {!!persistenceError && <Text accessibilityRole="alert" style={styles.error}>{persistenceError}</Text>}
            <View style={styles.actions}>
              <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => choose('denied')}>
                <Text style={styles.buttonText}>Decline analytics</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => choose('granted')}>
                <Text style={styles.buttonText}>Allow analytics</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </View>
    </AnalyticsContext.Provider>
  );
}

const styles = StyleSheet.create({
  application: { flex: 1 },
  preferences: { alignItems: 'center', borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', paddingHorizontal: 8, paddingTop: 8 },
  preferencesText: { color: COLORS.muted, fontSize: 11 },
  error: { color: COLORS.danger, backgroundColor: '#fff', fontSize: 12, lineHeight: 18, padding: 10 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  dialog: { width: '100%', maxWidth: 480, padding: 24, borderRadius: 16, backgroundColor: '#fff' },
  heading: { color: COLORS.text, fontSize: 20, fontWeight: '800', marginBottom: 12 },
  description: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginBottom: 14 },
  actions: { gap: 10 },
  button: { padding: 14, alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary, borderRadius: 8 },
  buttonText: { color: COLORS.primary, fontSize: 15, fontWeight: '700' },
});
