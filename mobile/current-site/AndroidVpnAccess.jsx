import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthContext } from '../context/AuthContext';
import VpnLaunchBridge from '../native-vpn/VpnLaunchBridge';
import VpnScreen from '../native-vpn/VpnScreen';

// Existing one-time Android connection links open the native VPN disclosure
// and permission flow without replacing the shared website navigation.
export default function AndroidVpnAccess({ session, ready, onVisibilityChange }) {
  const [route, setRoute] = useState(null);
  const navigationRef = useRef({ navigate: (_name, options) => setRoute(options?.params?.params || {}) });
  useEffect(() => { setRoute(null); }, [session?.token]);
  useEffect(() => { onVisibilityChange?.(Boolean(route)); return () => onVisibilityChange?.(false); }, [route, onVisibilityChange]);
  const value = { token: session?.token || null, profile: session?.profile || null,
    loading: !ready, onboardingComplete: Boolean(session?.profile?.id) };
  return <AuthContext.Provider value={value}>
    <VpnLaunchBridge navigationRef={navigationRef} navigationReady={ready} />
    <Modal visible={Boolean(route)} animationType="slide" onRequestClose={() => setRoute(null)}>
      <SafeAreaView style={styles.page}>
        <View style={styles.header}><Pressable accessibilityRole="button" onPress={() => setRoute(null)}><Text style={styles.close}>Back to UFIConnect</Text></Pressable></View>
        {route && <VpnScreen route={{ params: route }} />}
      </SafeAreaView>
    </Modal>
  </AuthContext.Provider>;
}
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: '#fff' }, header: { padding: 16 }, close: { color: '#102A6B', fontWeight: '700', padding: 8 } });
