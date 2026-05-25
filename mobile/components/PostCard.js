import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, CATEGORY_COLORS, CATEGORY_ICONS } from '../theme';

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Avatar({ name, size = 40 }) {
  const initials = name
    ? name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : '?';
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.35 }]}>{initials}</Text>
    </View>
  );
}

export default function PostCard({ post, onLike }) {
  const [liked, setLiked] = useState(post.likedByMe);
  const [count, setCount] = useState(post.likesCount);
  const cc = post.group ? (CATEGORY_COLORS[post.group.category] || { bg: COLORS.surface, text: COLORS.muted }) : { bg: COLORS.surface, text: COLORS.muted };
  const icon = post.group ? (CATEGORY_ICONS[post.group.category] || '📌') : '';

  function handleLike() {
    const next = !liked;
    setLiked(next);
    setCount((c) => c + (next ? 1 : -1));
    onLike && onLike(post.id);
  }

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <Avatar name={post.author?.name} />
        <View style={styles.headerText}>
          <Text style={styles.authorName}>{post.author?.name}</Text>
          <Text style={styles.authorMeta}>
            {post.author?.title}{post.author?.organization ? ` · ${post.author.organization}` : ''}
          </Text>
        </View>
        <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
      </View>

      {/* Group badge */}
      {post.group && (
        <View style={[styles.groupBadge, { backgroundColor: cc.bg }]}>
          <Text style={[styles.groupBadgeText, { color: cc.text }]}>
            {icon} {post.group.name}
          </Text>
        </View>
      )}

      {/* Content */}
      <Text style={styles.content}>{post.content}</Text>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.action} onPress={handleLike} activeOpacity={0.7}>
          <Text style={[styles.actionIcon, liked && styles.actionIconLiked]}>
            {liked ? '❤️' : '🤍'}
          </Text>
          <Text style={[styles.actionCount, liked && styles.actionCountLiked]}>{count}</Text>
        </TouchableOpacity>
        <View style={styles.action}>
          <Text style={styles.actionIcon}>💬</Text>
          <Text style={styles.actionCount}>{post.commentsCount}</Text>
        </View>
        <TouchableOpacity style={styles.action} activeOpacity={0.7}>
          <Text style={styles.actionIcon}>↗️</Text>
          <Text style={styles.actionCount}>Share</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  avatar: { backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  avatarText: { color: '#fff', fontWeight: '800' },
  headerText: { flex: 1 },
  authorName: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  authorMeta: { fontSize: 12, color: COLORS.muted, marginTop: 1 },
  time: { fontSize: 12, color: COLORS.muted },
  groupBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginBottom: 10 },
  groupBadgeText: { fontSize: 12, fontWeight: '600' },
  content: { fontSize: 14, color: COLORS.text, lineHeight: 22, marginBottom: 14 },
  actions: { flexDirection: 'row', gap: 20, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionIcon: { fontSize: 16 },
  actionIconLiked: {},
  actionCount: { fontSize: 13, color: COLORS.muted, fontWeight: '500' },
  actionCountLiked: { color: COLORS.danger },
});
