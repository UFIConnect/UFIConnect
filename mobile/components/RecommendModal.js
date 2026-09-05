import React, { useState } from 'react';
import {
  Modal, View, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator,
} from 'react-native';
import axios from 'axios';
import { API_BASE } from '../context/AuthContext';
import { COLORS, CATEGORY_COLORS, CATEGORY_ICONS } from '../theme';

function formatMembers(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k`;
  return String(n);
}

export default function RecommendModal({ visible, onClose, triggerGroup, recommendations, token, onJoined }) {
  const [joining, setJoining] = useState(null);
  const [joined, setJoined] = useState({});

  if (!visible || !triggerGroup) return null;

  async function joinGroup(groupId) {
    const group = recommendations.find(candidate => candidate?.id === groupId);
    if (!group || group.isExternal || group.canJoin === false) return;
    setJoining(groupId);
    try {
      const res = await axios.post(
        `${API_BASE}/groups/${groupId}/join`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setJoined((j) => ({ ...j, [groupId]: true }));
      onJoined && onJoined(res.data.joinedGroups);
    } catch (e) {
      console.error(e.message);
    } finally {
      setJoining(null);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {/* Handle bar */}
          <View style={styles.handle} />

          <Text style={styles.heading}>You might also like</Text>
          <Text style={styles.subheading}>
            Based on joining <Text style={styles.triggerName}>{triggerGroup.name}</Text>
          </Text>

          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {recommendations.map((group) => {
              if (!group) return null;
              const cc = CATEGORY_COLORS[group.category] || { bg: COLORS.surface, text: COLORS.muted };
              const isJoined = joined[group.id];
              return (
                <View key={group.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={[styles.catBadge, { backgroundColor: cc.bg }]}>
                      <Text style={[styles.catBadgeText, { color: cc.text }]}>
                        {CATEGORY_ICONS[group.category]} {group.category}
                      </Text>
                    </View>
                    <Text style={styles.members}>{formatMembers(group.members)} members</Text>
                  </View>
                  <Text style={styles.groupName}>{group.name}</Text>
                  <Text style={styles.groupDesc}>{group.description}</Text>
                  {!group.isExternal && group.canJoin !== false && <TouchableOpacity
                    style={[styles.joinBtn, isJoined && styles.joinedBtn]}
                    onPress={() => !isJoined && joinGroup(group.id)}
                    disabled={joining === group.id || isJoined}
                    activeOpacity={0.8}
                  >
                    {joining === group.id ? (
                      <ActivityIndicator size="small" color={isJoined ? COLORS.primary : '#fff'} />
                    ) : (
                      <Text style={[styles.joinBtnText, isJoined && styles.joinedBtnText]}>
                        {isJoined ? '✓ Joined' : '+ Join'}
                      </Text>
                    )}
                  </TouchableOpacity>}
                </View>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={styles.doneBtn} onPress={onClose}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12,
    maxHeight: '80%',
  },
  handle: { width: 40, height: 4, borderRadius: 4, backgroundColor: COLORS.border, alignSelf: 'center', marginBottom: 16 },
  heading: { fontSize: 22, fontWeight: '900', color: COLORS.text, marginBottom: 4 },
  subheading: { fontSize: 14, color: COLORS.muted, marginBottom: 20 },
  triggerName: { color: COLORS.primary, fontWeight: '700' },
  list: { flexGrow: 0 },
  card: {
    backgroundColor: COLORS.surface, borderRadius: 16, padding: 14, marginBottom: 12,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  catBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  catBadgeText: { fontSize: 12, fontWeight: '600' },
  members: { fontSize: 12, color: COLORS.muted, fontWeight: '500' },
  groupName: { fontSize: 16, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  groupDesc: { fontSize: 13, color: COLORS.muted, lineHeight: 18, marginBottom: 12 },
  joinBtn: { backgroundColor: COLORS.primary, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  joinedBtn: { backgroundColor: COLORS.primaryLight, borderWidth: 1.5, borderColor: COLORS.primary },
  joinBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  joinedBtnText: { color: COLORS.primary },
  doneBtn: {
    marginTop: 16, borderRadius: 12, paddingVertical: 14, alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  doneBtnText: { fontWeight: '700', color: COLORS.muted, fontSize: 15 },
});
