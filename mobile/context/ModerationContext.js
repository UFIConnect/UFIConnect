import React, { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import axios from 'axios';
import { API_BASE, useAuth } from './AuthContext';
import { COLORS } from '../theme';
import { createModerationStore } from '../security/moderationService';
import SafetyDialog from '../components/SafetyDialog';

const ModerationContext = createContext(null);
export default function ModerationProvider({ children }) {
  const { token, profile } = useAuth();
  const [target, setTarget] = useState(null);
  const store = useMemo(() => createModerationStore({ client: axios, apiBase: API_BASE, token, viewerId: profile?.id }), [token, profile?.id]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { setTarget(null); store.resume(); store.refresh(); return () => store.dispose(); }, [store]);
  const activeTarget = target?.store === store ? target : null;
  return <ModerationContext.Provider value={{ ...state, refreshBlocked: store.refresh, isBlocked: id => state.blockedIds.includes(id), openSafety: next => setTarget({ ...next, store }) }}>
    {state.error && token ? <View style={s.banner}>
      <Text style={s.error} accessibilityRole="alert">{state.error}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry blocked accounts" onPress={store.refresh} disabled={state.loading}><Text style={s.retry}>Retry</Text></TouchableOpacity>
    </View> : null}
    {children}
    {activeTarget && <SafetyDialog key={`${activeTarget.postId || ''}:${activeTarget.userId || ''}`} target={activeTarget} onClose={() => setTarget(null)} onReport={store.report} onBlock={store.block} />}
  </ModerationContext.Provider>;
}
export function useModeration() { return useContext(ModerationContext); }
const s = StyleSheet.create({
  banner: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FEF2F2' },
  error: { flex: 1, fontSize: 13, color: COLORS.danger }, retry: { padding: 8, fontWeight: '700', color: COLORS.primary },
});
