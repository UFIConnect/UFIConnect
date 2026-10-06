import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import axios from 'axios';
import { useIsFocused } from '@react-navigation/native';
import { useAuth, API_BASE } from '../context/AuthContext';
import { useModeration } from '../context/ModerationContext';
import { filterBlockedUsers } from '../security/moderationService';
import { COLORS } from '../theme';
import PostCard from '../components/PostCard';

export default function FeedScreen({ navigation }) {
  const { token, profile } = useAuth();
  const moderation = useModeration();
  const isFocused = useIsFocused();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const fetchPosts = useCallback(async signal => {
    try {
      const { data } = await axios.get(`${API_BASE}/feed`, { headers: { Authorization: `Bearer ${token}` }, signal, timeout: 15000 });
      setPosts(data.posts || []);
      setError('');
    } catch (e) {
      if (!axios.isCancel(e)) setError('Could not load your feed. Please retry.');
    } finally { setLoading(false); setRefreshing(false); }
  }, [token]);
  useEffect(() => {
    if (!isFocused) return undefined;
    const controller = new AbortController();
    fetchPosts(controller.signal);
    return () => controller.abort();
  }, [fetchPosts, isFocused]);
  async function handleLike(postId) {
    const { data } = await axios.post(`${API_BASE}/feed/${encodeURIComponent(postId)}/like`, {}, { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 });
    setPosts(previous => previous.map(post => post.id === postId ? { ...post, likedByMe: data.likedByMe, likesCount: data.likesCount } : post));
  }
  function refresh() { setRefreshing(true); fetchPosts(); moderation.refreshBlocked(); }
  const visiblePosts = moderation.loaded ? filterBlockedUsers(posts, moderation.blockedIds, post => post.author?.id) : [];
  if (loading || (!moderation.loaded && !moderation.error)) return <View style={s.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  return <FlatList
    style={s.screen} data={visiblePosts} keyExtractor={post => post.id} contentContainerStyle={s.list}
    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.primary} />}
    renderItem={({ item }) => <PostCard post={item} onLike={handleLike} />}
    ListHeaderComponent={<View style={s.header}>
      <Text style={s.title}>Your feed</Text>
      <Text style={s.subtitle}>From your {profile?.joinedGroups?.length || 0} groups</Text>
      {!!error && <View><Text accessibilityRole="alert" style={s.error}>{error}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry feed" onPress={refresh}><Text style={s.link}>Retry</Text></TouchableOpacity></View>}
    </View>}
    ListEmptyComponent={!error && moderation.loaded ? <View style={s.empty}>
      <Text style={s.emptyTitle}>No posts yet</Text>
      <Text style={s.subtitle}>Join groups to see their posts here.</Text>
      <TouchableOpacity accessibilityRole="button" style={s.button} onPress={() => navigation.navigate('Discover')}><Text style={s.buttonText}>Discover groups</Text></TouchableOpacity>
    </View> : null}
  />;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background }, list: { padding: 16, paddingBottom: 30 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.background },
  header: { marginBottom: 16 }, title: { color: COLORS.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: COLORS.muted, fontSize: 14, lineHeight: 22, marginTop: 4 },
  error: { color: COLORS.danger, fontSize: 14, marginTop: 10 }, link: { color: COLORS.primary, fontWeight: '700', paddingVertical: 10 },
  empty: { padding: 24, alignItems: 'center' }, emptyTitle: { color: COLORS.text, fontSize: 20, fontWeight: '700' },
  button: { backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 18 },
  buttonText: { color: '#fff', fontWeight: '700' },
});
