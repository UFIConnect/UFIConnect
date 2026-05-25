import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView, RefreshControl,
} from 'react-native';
import axios from 'axios';
import { useAuth, API_BASE } from '../context/AuthContext';
import { COLORS, CATEGORY_COLORS, CATEGORY_ICONS } from '../theme';
import RecommendModal from '../components/RecommendModal';

function formatMembers(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k`;
  return String(n);
}

function CategoryChip({ label, selected, onPress }) {
  const cc = CATEGORY_COLORS[label] || { bg: COLORS.surface, text: COLORS.muted };
  const icon = CATEGORY_ICONS[label] || '📌';
  return (
    <TouchableOpacity
      style={[styles.chip, selected && { backgroundColor: cc.text }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <Text style={[styles.chipText, selected && { color: '#fff' }]}>
        {icon} {label}
      </Text>
    </TouchableOpacity>
  );
}

function GroupCard({ group, joined, onToggle, toggling, onPress }) {
  const cc = CATEGORY_COLORS[group.category] || { bg: COLORS.surface, text: COLORS.muted };
  const icon = CATEGORY_ICONS[group.category] || '📌';
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.92}>
      <View style={styles.cardTop}>
        <View style={[styles.catBadge, { backgroundColor: cc.bg }]}>
          <Text style={[styles.catBadgeText, { color: cc.text }]}>{icon} {group.category}</Text>
        </View>
        <Text style={styles.memberCount}>{formatMembers(group.members)} members</Text>
      </View>
      <Text style={styles.groupName}>{group.name}</Text>
      <Text style={styles.groupDesc}>{group.description}</Text>
      <View style={styles.cardFooter}>
        <TouchableOpacity
          style={[styles.joinBtn, joined && styles.joinedBtn]}
          onPress={(e) => { e.stopPropagation && e.stopPropagation(); onToggle(group, joined); }}
          disabled={toggling === group.id}
          activeOpacity={0.8}
        >
          {toggling === group.id ? (
            <ActivityIndicator size="small" color={joined ? COLORS.primary : '#fff'} />
          ) : (
            <Text style={[styles.joinBtnText, joined && styles.joinedBtnText]}>
              {joined ? '✓ Joined' : 'Join group'}
            </Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.viewBtn} onPress={onPress} activeOpacity={0.8}>
          <Text style={styles.viewBtnText}>View →</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

export default function GroupsScreen({ navigation }) {
  const { token, profile, updateProfileLocally } = useAuth();
  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toggling, setToggling] = useState(null);

  // Recommendation modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [triggerGroup, setTriggerGroup] = useState(null);
  const [recommendations, setRecommendations] = useState([]);

  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const fetchAll = useCallback(async () => {
    try {
      const [gRes, cRes] = await Promise.all([
        axios.get(`${API_BASE}/groups`),
        axios.get(`${API_BASE}/groups/categories`),
      ]);
      setGroups(gRes.data.groups);
      setCategories(cRes.data.categories);
    } catch (e) {
      console.error(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const onRefresh = () => { setRefreshing(true); fetchAll(); };

  async function toggleJoin(group, isJoined) {
    if (!token) return;
    setToggling(group.id);
    try {
      if (isJoined) {
        // Leave — no recommendations on leave
        const res = await axios.delete(`${API_BASE}/groups/${group.id}/join`, { headers });
        updateProfileLocally({ ...profile, joinedGroups: res.data.joinedGroups });
        setGroups((prev) =>
          prev.map((g) => g.id === group.id ? { ...g, members: g.members - 1 } : g)
        );
      } else {
        // Join — get recommendations back from the server
        const res = await axios.post(`${API_BASE}/groups/${group.id}/join`, {}, { headers });
        updateProfileLocally({ ...profile, joinedGroups: res.data.joinedGroups });
        setGroups((prev) =>
          prev.map((g) => g.id === group.id ? { ...g, members: g.members + 1 } : g)
        );
        // Show recommendations modal if there are suggestions
        if (res.data.recommended?.length > 0) {
          setTriggerGroup(group);
          setRecommendations(res.data.recommended);
          setModalVisible(true);
        }
      }
    } catch (e) {
      console.error(e.message);
    } finally {
      setToggling(null);
    }
  }

  function handleModalJoined(newJoinedGroups) {
    updateProfileLocally({ ...profile, joinedGroups: newJoinedGroups });
    setGroups((prev) =>
      prev.map((g) =>
        newJoinedGroups.includes(g.id) && !profile.joinedGroups?.includes(g.id)
          ? { ...g, members: g.members + 1 }
          : g
      )
    );
  }

  const filtered = selectedCategory
    ? groups.filter((g) => g.category === selectedCategory)
    : groups;

  const joinedGroups = profile?.joinedGroups || [];

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {/* Category filter strip */}
      <View style={styles.filterWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <TouchableOpacity
            style={[styles.chip, !selectedCategory && styles.chipAll]}
            onPress={() => setSelectedCategory(null)}
            activeOpacity={0.75}
          >
            <Text style={[styles.chipText, !selectedCategory && { color: '#fff' }]}>All</Text>
          </TouchableOpacity>
          {categories.map((cat) => (
            <CategoryChip
              key={cat}
              label={cat}
              selected={selectedCategory === cat}
              onPress={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
            />
          ))}
        </ScrollView>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        renderItem={({ item }) => (
          <GroupCard
            group={item}
            joined={joinedGroups.includes(item.id)}
            onToggle={toggleJoin}
            toggling={toggling}
            onPress={() => navigation.navigate('GroupDetail', { group: item })}
          />
        )}
        ListHeaderComponent={
          <Text style={styles.listHeader}>
            {selectedCategory
              ? `${CATEGORY_ICONS[selectedCategory] || ''} ${selectedCategory}`
              : '✨ All groups'}{' '}
            <Text style={styles.listCount}>({filtered.length})</Text>
          </Text>
        }
        ListEmptyComponent={<Text style={styles.empty}>No groups in this category yet.</Text>}
      />

      <RecommendModal
        visible={modalVisible}
        onClose={() => { setModalVisible(false); setTriggerGroup(null); setRecommendations([]); }}
        triggerGroup={triggerGroup}
        recommendations={recommendations}
        token={token}
        onJoined={handleModalJoined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  filterWrap: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  filterRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: COLORS.surface, marginRight: 8,
  },
  chipAll: { backgroundColor: COLORS.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  list: { padding: 16, paddingBottom: 32 },
  listHeader: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 16 },
  listCount: { color: COLORS.muted, fontWeight: '400' },
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8, elevation: 2,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  catBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  catBadgeText: { fontSize: 12, fontWeight: '600' },
  memberCount: { fontSize: 12, color: COLORS.muted, fontWeight: '500' },
  groupName: { fontSize: 17, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  groupDesc: { fontSize: 14, color: COLORS.muted, lineHeight: 20, marginBottom: 14 },
  joinBtn: {
    backgroundColor: COLORS.primary, borderRadius: 10,
    paddingVertical: 10, alignItems: 'center',
  },
  joinedBtn: { backgroundColor: COLORS.primaryLight, borderWidth: 1.5, borderColor: COLORS.primary },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  joinedBtnText: { color: COLORS.primary },
  cardFooter: { flexDirection: 'row', gap: 10 },
  viewBtn: {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center',
  },
  viewBtnText: { color: COLORS.muted, fontWeight: '600', fontSize: 14 },
  empty: { textAlign: 'center', color: COLORS.muted, marginTop: 40 },
});
