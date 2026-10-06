import React, { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  TouchableOpacity, ScrollView, Linking, Alert,
} from 'react-native';
import axios from 'axios';
import { useAuth, API_BASE } from '../context/AuthContext';
import { COLORS, CATEGORY_COLORS, CATEGORY_ICONS } from '../theme';
import MemberCard from '../components/MemberCard';
import { useModeration } from '../context/ModerationContext';
import { filterBlockedUsers } from '../security/moderationService';

function formatMembers(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k`;
  return String(n);
}

export default function GroupDetailScreen({ route, navigation }) {
  const { group } = route.params;
  const { token, profile, updateProfileLocally } = useAuth();
  const moderation = useModeration();
  const [members, setMembers] = useState([]);
  const [totalMembers, setTotalMembers] = useState(group.members);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  const joinedGroups = profile?.joinedGroups || [];
  const canJoin = !group.isExternal && group.canJoin !== false;
  const isJoined = canJoin && joinedGroups.includes(group.id);
  const cc = CATEGORY_COLORS[group.category] || { bg: COLORS.surface, text: COLORS.muted };
  const icon = CATEGORY_ICONS[group.category] || '📌';

  useEffect(() => {
    if (group.isExternal) {
      setMembers([]);
      setLoading(false);
      return;
    }
    axios.get(`${API_BASE}/groups/${group.id}/members`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => { setMembers(r.data.members); setTotalMembers(r.data.total); })
      .catch((e) => console.error(e.message))
      .finally(() => setLoading(false));
  }, [group.id, group.isExternal, token]);

  async function toggleJoin() {
    if (!canJoin || joining) return;
    setJoining(true);
    try {
      if (isJoined) {
        const res = await axios.delete(`${API_BASE}/groups/${group.id}/join`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        updateProfileLocally({ ...profile, joinedGroups: res.data.joinedGroups });
        setTotalMembers((n) => n - 1);
      } else {
        const res = await axios.post(`${API_BASE}/groups/${group.id}/join`, {}, {
          headers: { Authorization: `Bearer ${token}` },
        });
        updateProfileLocally({ ...profile, joinedGroups: res.data.joinedGroups });
        setTotalMembers((n) => n + 1);
      }
    } catch (e) {
      console.error(e.message);
    } finally {
      setJoining(false);
    }
  }

  return (
    <FlatList
      style={styles.screen}
      data={moderation.loaded ? filterBlockedUsers(members, moderation.blockedIds, member => member.id) : []}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View>
          {/* Group hero */}
          <View style={styles.hero}>
            <View style={[styles.heroBadge, { backgroundColor: cc.bg }]}>
              <Text style={[styles.heroBadgeText, { color: cc.text }]}>{icon} {group.category}</Text>
            </View>
            <Text style={styles.heroName}>{group.name}</Text>
            <Text style={styles.heroDesc}>{group.description}</Text>
            <Text style={styles.heroMembers}>{formatMembers(totalMembers)} members</Text>

            {canJoin && <TouchableOpacity
              style={[styles.joinBtn, isJoined && styles.joinedBtn]}
              onPress={toggleJoin}
              disabled={joining}
              activeOpacity={0.8}
            >
              {joining ? (
                <ActivityIndicator color={isJoined ? COLORS.primary : '#fff'} />
              ) : (
                <Text style={[styles.joinBtnText, isJoined && styles.joinedBtnText]}>
                  {isJoined ? '✓ Joined' : 'Join group'}
                </Text>
              )}
            </TouchableOpacity>}
            {group.isExternal && /^https?:\/\//i.test(group.externalUrl || '') && (
              <TouchableOpacity style={styles.joinBtn} onPress={() => Linking.openURL(group.externalUrl).catch(() => Alert.alert('Could not open this group', 'Please try again.'))}>
                <Text style={styles.joinBtnText}>Visit original group</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Members header */}
          {!group.isExternal && <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Members</Text>
            {(loading || moderation.loading) && <ActivityIndicator size="small" color={COLORS.primary} />}
          </View>}
        </View>
      }
      renderItem={({ item }) => (
        <MemberCard member={item} token={token} />
      )}
      ListEmptyComponent={
        !loading && moderation.loaded && !group.isExternal ? <Text style={styles.empty}>No members to show yet.</Text> : null
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  list: { padding: 16, paddingBottom: 40 },
  hero: {
    backgroundColor: '#fff', borderRadius: 20, padding: 20, marginBottom: 20,
    shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 3 }, shadowRadius: 12, elevation: 3,
  },
  heroBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginBottom: 10 },
  heroBadgeText: { fontSize: 13, fontWeight: '600' },
  heroName: { fontSize: 24, fontWeight: '900', color: COLORS.text, marginBottom: 8, lineHeight: 30 },
  heroDesc: { fontSize: 14, color: COLORS.muted, lineHeight: 22, marginBottom: 12 },
  heroMembers: { fontSize: 13, color: COLORS.muted, fontWeight: '600', marginBottom: 16 },
  joinBtn: {
    backgroundColor: COLORS.primary, borderRadius: 12,
    paddingVertical: 12, alignItems: 'center',
  },
  joinedBtn: { backgroundColor: COLORS.primaryLight, borderWidth: 1.5, borderColor: COLORS.primary },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  joinedBtnText: { color: COLORS.primary },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text },
  empty: { color: COLORS.muted, textAlign: 'center', marginTop: 20 },
});
