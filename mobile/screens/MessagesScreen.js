import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  TouchableOpacity, RefreshControl,
} from 'react-native';
import axios from 'axios';
import { useAuth, API_BASE } from '../context/AuthContext';
import { COLORS } from '../theme';

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function Avatar({ name, size = 48 }) {
  const initials = name
    ? name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : '?';
  return (
    <View style={[av.wrap, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[av.text, { fontSize: size * 0.33 }]}>{initials}</Text>
    </View>
  );
}

function ConversationRow({ item, onPress }) {
  const hasUnread = item.unreadCount > 0;
  return (
    <TouchableOpacity style={[s.row, hasUnread && s.rowUnread]} onPress={onPress} activeOpacity={0.8}>
      <View style={s.avatarWrap}>
        <Avatar name={item.participant?.name} />
        {hasUnread && <View style={s.unreadDot} />}
      </View>
      <View style={s.rowBody}>
        <View style={s.rowTop}>
          <Text style={[s.name, hasUnread && s.nameBold]}>{item.participant?.name}</Text>
          <Text style={s.time}>{timeAgo(item.lastMessage?.createdAt)}</Text>
        </View>
        <Text style={s.meta}>{item.participant?.title}{item.participant?.organization ? ` · ${item.participant.organization}` : ''}</Text>
        <Text style={[s.preview, hasUnread && s.previewBold]} numberOfLines={1}>
          {item.lastMessage?.isMe ? 'You: ' : ''}{item.lastMessage?.content || 'No messages yet'}
        </Text>
      </View>
      {hasUnread && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{item.unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function MessagesScreen({ navigation }) {
  const { token } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchConvs = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/messages`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setConversations(res.data.conversations);
    } catch (e) { console.error(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetchConvs(); }, [fetchConvs]);

  const totalUnread = conversations.reduce((n, c) => n + c.unreadCount, 0);

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  return (
    <FlatList
      style={s.screen}
      data={conversations}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchConvs} tintColor={COLORS.primary} />}
      renderItem={({ item }) => (
        <ConversationRow
          item={item}
          onPress={() => navigation.navigate('Conversation', { userId: item.participant?.id, participant: item.participant })}
        />
      )}
      ItemSeparatorComponent={() => <View style={s.divider} />}
      ListHeaderComponent={
        <View style={s.header}>
          <Text style={s.headerTitle}>Messages</Text>
          {totalUnread > 0 && <View style={s.unreadChip}><Text style={s.unreadChipText}>{totalUnread} unread</Text></View>}
        </View>
      }
      ListEmptyComponent={
        <View style={s.empty}>
          <Text style={s.emptyIcon}>💬</Text>
          <Text style={s.emptyTitle}>No messages yet</Text>
          <Text style={s.emptyText}>Connect with people in your groups and start a conversation.</Text>
        </View>
      }
    />
  );
}

const av = StyleSheet.create({
  wrap: { backgroundColor: COLORS.secondary, justifyContent: 'center', alignItems: 'center' },
  text: { color: '#fff', fontWeight: '800' },
});

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  headerTitle: { fontSize: 26, fontWeight: '900', color: COLORS.text },
  unreadChip: { backgroundColor: COLORS.primary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  unreadChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  rowUnread: { backgroundColor: COLORS.primaryLight + '50' },
  avatarWrap: { marginRight: 12, position: 'relative' },
  unreadDot: { position: 'absolute', top: 0, right: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: COLORS.primary, borderWidth: 2, borderColor: '#fff' },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  nameBold: { fontWeight: '800' },
  meta: { fontSize: 12, color: COLORS.muted, marginTop: 1, marginBottom: 2 },
  time: { fontSize: 12, color: COLORS.muted },
  preview: { fontSize: 13, color: COLORS.muted },
  previewBold: { color: COLORS.text, fontWeight: '600' },
  badge: { backgroundColor: COLORS.primary, width: 22, height: 22, borderRadius: 11, justifyContent: 'center', alignItems: 'center', marginLeft: 8 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  divider: { height: 1, backgroundColor: COLORS.border, marginLeft: 76 },
  empty: { padding: 40, alignItems: 'center', marginTop: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 8 },
  emptyText: { fontSize: 14, color: COLORS.muted, textAlign: 'center', lineHeight: 22 },
});
