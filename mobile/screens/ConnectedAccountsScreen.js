import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, Alert,
} from 'react-native';
import axios from 'axios';
import { useAuth, API_BASE } from '../context/AuthContext';
import { COLORS } from '../theme';
import { PLATFORM_META, PLATFORM_ORDER } from '../platforms';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

// ── OAuth permission modal ────────────────────────────────────────────────────
function OAuthModal({ platform, onConfirm, onCancel, loading }) {
  if (!platform) return null;
  const meta = PLATFORM_META[platform.id] || {};
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCancel}>
      <View style={ms.backdrop}>
        <View style={ms.sheet}>
          <View style={ms.handle} />

          {/* Platform header */}
          <View style={[ms.platformHeader, { backgroundColor: meta.bg }]}>
            <Text style={ms.platformEmoji}>{meta.emoji}</Text>
            <View style={ms.platformHeaderText}>
              <Text style={[ms.platformName, { color: meta.color }]}>{platform.name}</Text>
              <Text style={ms.platformDesc}>{platform.description}</Text>
            </View>
          </View>

          {/* Permissions */}
          <Text style={ms.sectionLabel}>Permissions requested</Text>
          <View style={ms.scopeList}>
            {platform.scopes.map((scope) => (
              <View key={scope} style={ms.scopeRow}>
                <Text style={ms.scopeCheck}>✓</Text>
                <Text style={ms.scopeText}>{scope}</Text>
              </View>
            ))}
          </View>

          {/* Review notice */}
          {platform.reviewRequired && (
            <View style={ms.notice}>
              <Text style={ms.noticeText}>⚠️ {platform.note}</Text>
            </View>
          )}

          {/* What happens */}
          <View style={ms.infoBox}>
            <Text style={ms.infoTitle}>Demo connection</Text>
            <Text style={ms.infoText}>
              This preview does not authorise access to {platform.name} or ask for your password.
              Real account connections are not available from this screen.
            </Text>
          </View>

          <TouchableOpacity
            style={[ms.authoriseBtn, { backgroundColor: meta.color }]}
            onPress={() => onConfirm(platform.id)}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={ms.authoriseBtnText}>Connect {platform.name} (Demo)</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={ms.cancelBtn} onPress={onCancel}>
            <Text style={ms.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Platform card ─────────────────────────────────────────────────────────────
function PlatformCard({ platform, onConnect, onDisconnect }) {
  const meta = PLATFORM_META[platform.id] || {};
  return (
    <View style={[cs.card, platform.connected && cs.cardConnected]}>
      <View style={[cs.iconWrap, { backgroundColor: meta.bg }]}>
        <Text style={cs.icon}>{meta.emoji}</Text>
      </View>
      <View style={cs.cardBody}>
        <View style={cs.cardTop}>
          <Text style={cs.cardName}>{platform.name}</Text>
          {platform.connected && (
            <View style={cs.connectedBadge}>
              <Text style={cs.connectedBadgeText}>Connected</Text>
            </View>
          )}
        </View>
        <Text style={cs.cardDesc}>{platform.description}</Text>
        {platform.connected && platform.username && (
          <Text style={cs.username}>
            @{platform.username}  ·  {timeAgo(platform.connectedAt)}
          </Text>
        )}
      </View>
      <TouchableOpacity
        style={[cs.btn, platform.connected ? cs.disconnectBtn : { backgroundColor: meta.color }]}
        onPress={() => platform.connected ? onDisconnect(platform.id) : onConnect(platform)}
        activeOpacity={0.8}
      >
        <Text style={[cs.btnText, platform.connected && cs.disconnectBtnText]}>
          {platform.connected ? 'Disconnect' : 'Connect'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function ConnectedAccountsScreen() {
  const { token, updateProfileLocally, profile } = useAuth();
  const [platforms, setPlatforms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalPlatform, setModalPlatform] = useState(null);
  const [connecting, setConnecting] = useState(false);

  const fetchPlatforms = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/social/platforms`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Sort by PLATFORM_ORDER
      const sorted = PLATFORM_ORDER.map((id) => res.data.platforms.find((p) => p.id === id)).filter(Boolean);
      setPlatforms(sorted);
    } catch (e) {
      console.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchPlatforms(); }, [fetchPlatforms]);

  async function handleConnect(platformId) {
    setConnecting(true);
    try {
      const res = await axios.post(
        `${API_BASE}/social/connect`,
        { platform: platformId, mockUsername: `${profile?.name?.split(' ')[0]?.toLowerCase() || 'user'}_${platformId}` },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setPlatforms((prev) =>
        prev.map((p) => p.id === platformId
          ? { ...p, connected: true, username: res.data.username, connectedAt: new Date().toISOString() }
          : p
        )
      );
      updateProfileLocally({
        ...profile,
        connectedPlatforms: [...(profile?.connectedPlatforms || []), platformId],
      });
    } catch (e) {
      Alert.alert('Error', 'Failed to connect. Please try again.');
    } finally {
      setConnecting(false);
      setModalPlatform(null);
    }
  }

  async function handleDisconnect(platformId) {
    Alert.alert(
      'Disconnect account',
      `Remove your ${PLATFORM_META[platformId]?.name} connection?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect', style: 'destructive', onPress: async () => {
            try {
              await axios.delete(`${API_BASE}/social/connect/${platformId}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              setPlatforms((prev) =>
                prev.map((p) => p.id === platformId ? { ...p, connected: false, username: null } : p)
              );
              updateProfileLocally({
                ...profile,
                connectedPlatforms: (profile?.connectedPlatforms || []).filter((id) => id !== platformId),
              });
            } catch (e) {
              Alert.alert('Error', 'Failed to disconnect.');
            }
          },
        },
      ]
    );
  }

  const connectedCount = platforms.filter((p) => p.connected).length;

  if (loading) {
    return <View style={ss.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  return (
    <ScrollView style={ss.screen} contentContainerStyle={ss.container}>
      <View style={ss.header}>
        <Text style={ss.headerTitle}>Connected accounts</Text>
        <Text style={ss.headerSub}>
          {connectedCount > 0
            ? `${connectedCount} of ${platforms.length} platforms connected`
            : 'Connect your accounts to enrich your feed and get job recommendations.'}
        </Text>
      </View>

      {platforms.map((platform) => (
        <PlatformCard
          key={platform.id}
          platform={platform}
          onConnect={setModalPlatform}
          onDisconnect={handleDisconnect}
        />
      ))}

      <View style={ss.legalBox}>
        <Text style={ss.legalTitle}>About permissions</Text>
        <Text style={ss.legalText}>
          Connections on this screen are demonstrations. They do not verify ownership
          of an external account or grant access to it. Do not enter external account
          passwords here. You can remove a demo connection at any time.
        </Text>
      </View>

      <OAuthModal
        platform={modalPlatform}
        onConfirm={handleConnect}
        onCancel={() => setModalPlatform(null)}
        loading={connecting}
      />
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  container: { padding: 16, paddingBottom: 48 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { marginBottom: 20 },
  headerTitle: { fontSize: 22, fontWeight: '900', color: COLORS.text },
  headerSub: { fontSize: 14, color: COLORS.muted, marginTop: 4, lineHeight: 20 },
  legalBox: {
    marginTop: 20, backgroundColor: COLORS.surface, borderRadius: 14,
    padding: 16, borderLeftWidth: 3, borderLeftColor: COLORS.primary,
  },
  legalTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  legalText: { fontSize: 12, color: COLORS.muted, lineHeight: 18 },
});

const cs = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 16, padding: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: COLORS.border,
    shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 2 }, shadowRadius: 6,
  },
  cardConnected: { borderColor: COLORS.success + '60' },
  iconWrap: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  icon: { fontSize: 22 },
  cardBody: { flex: 1 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  cardName: { fontSize: 15, fontWeight: '700', color: COLORS.text },
  connectedBadge: { backgroundColor: '#ECFDF5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  connectedBadgeText: { fontSize: 11, fontWeight: '700', color: COLORS.success },
  cardDesc: { fontSize: 12, color: COLORS.muted, lineHeight: 17 },
  username: { fontSize: 12, color: COLORS.primary, marginTop: 3, fontWeight: '500' },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, marginLeft: 8 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  disconnectBtn: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  disconnectBtnText: { color: COLORS.muted },
});

const ms = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 40, maxHeight: '85%',
  },
  handle: { width: 40, height: 4, borderRadius: 4, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16 },
  platformHeader: { flexDirection: 'row', alignItems: 'center', borderRadius: 14, padding: 14, marginBottom: 20 },
  platformEmoji: { fontSize: 32, marginRight: 14 },
  platformHeaderText: { flex: 1 },
  platformName: { fontSize: 18, fontWeight: '800' },
  platformDesc: { fontSize: 13, color: COLORS.muted, marginTop: 2, lineHeight: 18 },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  scopeList: { marginBottom: 14, gap: 6 },
  scopeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scopeCheck: { color: COLORS.success, fontWeight: '700', fontSize: 14, width: 18 },
  scopeText: { fontSize: 14, color: COLORS.text, fontFamily: 'monospace' },
  notice: { backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12, marginBottom: 14, borderLeftWidth: 3, borderLeftColor: '#F59E0B' },
  noticeText: { fontSize: 12, color: '#92400E', lineHeight: 18 },
  infoBox: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 20 },
  infoTitle: { fontSize: 13, fontWeight: '700', color: COLORS.text, marginBottom: 6 },
  infoText: { fontSize: 12, color: COLORS.muted, lineHeight: 18 },
  authoriseBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  authoriseBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: { alignItems: 'center', paddingVertical: 10 },
  cancelBtnText: { color: COLORS.muted, fontWeight: '600', fontSize: 14 },
});
