import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Linking } from 'react-native';
import axios from 'axios';
import { useAuth, API_BASE } from '../context/AuthContext';
import { COLORS } from '../theme';
import { PLATFORM_META } from '../platforms';
import ACCOUNT_DIRECTORY from '../../backend/account-directory.json';
import { accountSections, selectedAccountSections } from '../../shared/accountCategories.js';
import { normalizeConnectedAccounts, nativeAccountReadiness, nativeAccountWebsite } from '../connectedAccounts.js';

async function openWebsite(url) {
  try { await Linking.openURL(url); }
  catch { Alert.alert('Could not open the website', 'Try opening the website in your browser.'); }
}

function PlatformCard({ platform, busy, onDisconnect }) {
  const meta = PLATFORM_META[platform.id] || { emoji: platform.name.slice(0, 2), color: COLORS.primary, bg: COLORS.surface };
  const authorization = nativeAccountReadiness(platform), website = nativeAccountWebsite(platform);
  return <View style={styles.card}>
    <View style={styles.cardHeader}>
      <View style={[styles.iconWrap, { backgroundColor: meta.bg }]}><Text style={styles.icon}>{meta.emoji}</Text></View>
      <View style={styles.cardBody}>
        <Text style={styles.cardName}>{platform.name}</Text>
        {!!platform.description && <Text style={styles.cardDescription}>{platform.description}</Text>}
        {platform.connected === true && <Text style={styles.connected}>Connected</Text>}
      </View>
    </View>
    <View style={styles.actions}>
      <TouchableOpacity style={[styles.iconButton, authorization.ready && styles.connectButton]}
        accessibilityRole="button" accessibilityLabel={'Connect ' + platform.name + ' on UFIConnect website'}
        accessibilityHint={authorization.reason} accessibilityState={{ disabled: busy || !authorization.ready }}
        disabled={busy || !authorization.ready} onPress={() => openWebsite('https://uficonnect.org/connected-accounts')}>
        <Text style={[styles.actionIcon, authorization.ready && styles.connectIcon]}>↔</Text>
      </TouchableOpacity>
      {website && <TouchableOpacity style={styles.iconButton} accessibilityRole="link" accessibilityLabel={'Open ' + platform.name + ' website'} onPress={() => openWebsite(website)}>
        <Text style={styles.actionIcon}>↗</Text>
      </TouchableOpacity>}
      {platform.connected === true && platform.connectionMode !== 'external' && <TouchableOpacity style={styles.iconButton}
        accessibilityRole="button" accessibilityLabel={'Disconnect ' + platform.name} disabled={busy}
        accessibilityState={{ disabled: busy }} onPress={() => onDisconnect(platform.id)}><Text style={styles.actionIcon}>×</Text></TouchableOpacity>}
    </View>
    {!authorization.ready && platform.connected !== true && <Text style={styles.reason}>{authorization.reason}</Text>}
  </View>;
}

export default function ConnectedAccountsScreen() {
  const { token, updateProfileLocally, profile } = useAuth();
  const business = profile?.plan === 'business';
  const current = useRef({}); current.current = { id: profile?.id, token, business };
  const generation = useRef(0);
  const [platforms, setPlatforms] = useState([]), [loading, setLoading] = useState(true);
  const [catalogOwner, setCatalogOwner] = useState(null), [error, setError] = useState('');
  const [category, setCategory] = useState('social'), [busy, setBusy] = useState(false);
  const sameOwner = owner => owner && current.current.id === owner.id && current.current.token === owner.token && current.current.business === owner.business;

  const fetchPlatforms = useCallback(async ({ signal } = {}) => {
    const request = ++generation.current, owner = { id: profile?.id, token, business };
    const active = () => sameOwner(owner) && request === generation.current && !signal?.aborted;
    setLoading(true); setError(''); setPlatforms([]); setCatalogOwner(null);
    try {
      if (!token || !owner.id) throw new Error('Sign in is required.');
      const { data } = await axios.get(API_BASE + '/social/platforms', { signal, headers: { Authorization: 'Bearer ' + token } });
      if (!active()) return;
      if (!data?.platforms || typeof data.platforms !== 'object') throw new Error('Catalog unavailable.');
      setPlatforms(normalizeConnectedAccounts(data, { business, directory: ACCOUNT_DIRECTORY }));
    } catch {
      if (active()) setError('Could not load account connections. Sign-in remains locked.');
    } finally {
      if (active()) { setCatalogOwner(owner); setLoading(false); }
    }
  }, [profile?.id, token, business]);

  useEffect(() => {
    const controller = new AbortController();
    setCategory('social'); setBusy(false); fetchPlatforms({ signal: controller.signal });
    return () => { controller.abort(); generation.current++; };
  }, [fetchPlatforms]);

  function handleDisconnect(id) {
    const owner = { ...current.current }, platform = platforms.find(([key]) => key === id)?.[1];
    if (!sameOwner(catalogOwner) || platform?.connected !== true || busy) return;
    Alert.alert('Disconnect account', 'Remove your ' + platform.name + ' connection?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: async () => {
        if (!sameOwner(owner)) return;
        setBusy(true);
        try {
          await axios.delete(API_BASE + '/social/connect/' + id, { headers: { Authorization: 'Bearer ' + token } });
          if (!sameOwner(owner)) return;
          updateProfileLocally({ connectedPlatforms: (profile?.connectedPlatforms || []).filter(key => key !== id) });
          await fetchPlatforms();
        } catch { if (sameOwner(owner)) Alert.alert('Could not disconnect', 'Try again when your connection is available.'); }
        finally { if (sameOwner(owner)) setBusy(false); }
      } },
    ]);
  }

  if (loading || !sameOwner(catalogOwner)) return <View style={styles.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  const sections = accountSections(platforms, { business }), visibleSections = selectedAccountSections(sections, category);
  const active = sections.some(section => section.id === category) ? category : sections[0]?.id;
  const categories = sections;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
    <Text style={styles.title} accessibilityRole="header">{business ? 'Business career connections' : 'Connected accounts'}</Text>
    <Text style={styles.subtitle}>Browse by category. Supported account connections finish on uficonnect.org.</Text>
    {error ? <View><Text style={styles.reason} accessibilityRole="alert">{error}</Text><TouchableOpacity style={styles.retry} accessibilityRole="button" accessibilityLabel="Retry account connections" onPress={() => fetchPlatforms()}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View> : <>
      <Text style={styles.categoryLegend}>Categories</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.categoryList} accessibilityLabel="Account categories">
        {categories.map(item => <TouchableOpacity key={item.id} accessibilityRole="button" accessibilityLabel={item.label + ' ' + item.total}
          accessibilityState={{ selected: active === item.id }} style={[styles.categoryButton, active === item.id && styles.categoryActive]} onPress={() => setCategory(item.id)}>
          <Text style={[styles.categoryText, active === item.id && styles.categoryActiveText]}>{item.label} ({item.total})</Text>
        </TouchableOpacity>)}
      </ScrollView>
      {visibleSections.map(section => <View key={section.id} style={styles.section}>
        <Text style={styles.sectionTitle} accessibilityRole="header">{section.label}</Text>
        {section.items.map(([id, platform]) => <PlatformCard key={id} platform={platform} busy={busy} onDisconnect={handleDisconnect} />)}
      </View>)}
      {!visibleSections.length && <Text style={styles.subtitle}>No account connections are available yet.</Text>}
    </>}
    <View style={styles.legalBox}><Text style={styles.legalTitle}>Account permissions</Text><Text style={styles.legalText}>The connect icon opens UFIConnect’s website to complete supported authorization. The arrow opens the source’s website. Your source passwords stay with the provider.</Text></View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background }, container: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: COLORS.text }, subtitle: { fontSize: 14, color: COLORS.muted, marginTop: 5, marginBottom: 18, lineHeight: 20 },
  categoryLegend: { fontSize: 13, fontWeight: '600', color: COLORS.muted, marginBottom: 8 },
  categoryList: { gap: 8, paddingBottom: 10 }, categoryButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  categoryActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary }, categoryText: { fontSize: 13, color: COLORS.text }, categoryActiveText: { color: '#fff' },
  section: { marginTop: 16 }, sectionTitle: { fontSize: 17, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  card: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, iconWrap: { width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center' }, icon: { fontSize: 19 },
  cardBody: { flex: 1, minWidth: 0 }, cardName: { fontSize: 15, fontWeight: '700', color: COLORS.text }, cardDescription: { fontSize: 12, color: COLORS.muted, lineHeight: 18, marginTop: 3 }, connected: { fontSize: 12, color: COLORS.success, marginTop: 5 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 }, iconButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.background },
  connectButton: { backgroundColor: COLORS.primary, borderColor: COLORS.primary }, actionIcon: { fontSize: 24, color: COLORS.muted }, connectIcon: { color: '#fff' },
  reason: { fontSize: 12, lineHeight: 18, color: COLORS.muted, marginTop: 10 }, retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 }, retryText: { color: COLORS.primary, fontWeight: '700' },
  legalBox: { marginTop: 20, backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, borderLeftWidth: 3, borderLeftColor: COLORS.primary }, legalTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 6 }, legalText: { fontSize: 12, color: COLORS.muted, lineHeight: 18 },
});
