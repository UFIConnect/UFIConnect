import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  RefreshControl, TouchableOpacity, ScrollView,
} from 'react-native';
import axios from 'axios';
import { useAuth, API_BASE } from '../context/AuthContext';
import { COLORS } from '../theme';
import { PLATFORM_META } from '../platforms';
import PostCard from '../components/PostCard';
import { useIsFocused } from '@react-navigation/native';
import { usePreferences } from '../context/PreferencesContext';
import { feedSections } from '../context/dataPreferences';

// ── Social post card ──────────────────────────────────────────────────────────
function SocialAvatar({ initials, color }) {
  return (
    <View style={[soc.avatar, { backgroundColor: color }]}>
      <Text style={soc.avatarText}>{initials}</Text>
    </View>
  );
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatNum(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k`;
  return String(n);
}

function SocialPostCard({ post }) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes);
  const meta = PLATFORM_META[post.platform] || { color: COLORS.primary, emoji: '📌', name: post.platform, bg: COLORS.surface };

  return (
    <View style={soc.card}>
      <View style={soc.header}>
        <SocialAvatar initials={post.avatar} color={meta.color} />
        <View style={soc.headerText}>
          <Text style={soc.author}>{post.author}</Text>
          <Text style={soc.source}>{post.source}</Text>
        </View>
        <View style={[soc.platformBadge, { backgroundColor: meta.bg }]}>
          <Text style={soc.platformBadgeText}>{meta.emoji}</Text>
        </View>
        <Text style={soc.time}>{timeAgo(post.time)}</Text>
      </View>
      <Text style={soc.content}>{post.content}</Text>
      <View style={soc.actions}>
        <TouchableOpacity
          style={soc.action}
          onPress={() => { setLiked(!liked); setLikeCount((c) => c + (liked ? -1 : 1)); }}
        >
          <Text style={soc.actionIcon}>{liked ? '❤️' : '🤍'}</Text>
          <Text style={soc.actionCount}>{formatNum(likeCount)}</Text>
        </TouchableOpacity>
        <View style={soc.action}>
          <Text style={soc.actionIcon}>💬</Text>
          <Text style={soc.actionCount}>{formatNum(post.comments)}</Text>
        </View>
        <View style={soc.action}>
          <Text style={[soc.actionIcon, { fontSize: 13, color: meta.color, fontWeight: '700' }]}>{meta.name}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Job card (Indeed) ─────────────────────────────────────────────────────────
function JobCard({ job }) {
  const posted = (() => {
    const diff = Date.now() - new Date(job.posted).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  })();
  return (
    <View style={job_s.card}>
      <View style={job_s.top}>
        <View>
          <Text style={job_s.title}>{job.title}</Text>
          <Text style={job_s.company}>{job.company} · {job.location}</Text>
        </View>
        <Text style={job_s.posted}>{posted}</Text>
      </View>
      <Text style={job_s.salary}>{job.salary}</Text>
      <View style={job_s.tags}>
        {job.tags.map((t) => (
          <View key={t} style={job_s.tag}><Text style={job_s.tagText}>{t}</Text></View>
        ))}
        <View style={[job_s.tag, { backgroundColor: job_s.typeTag.bg }]}>
          <Text style={[job_s.tagText, { color: COLORS.success }]}>{job.type}</Text>
        </View>
      </View>
      <TouchableOpacity style={job_s.applyBtn} activeOpacity={0.8}>
        <Text style={job_s.applyBtnText}>View on Indeed →</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Tab selector ──────────────────────────────────────────────────────────────
function TabBar({ active, onChange, tabs }) {
  return (
    <View style={tb.bar}>
      {tabs.map((tab) => (
        <TouchableOpacity
          key={tab.id}
          style={[tb.tab, active === tab.id && tb.tabActive]}
          onPress={() => onChange(tab.id)}
          activeOpacity={0.8}
        >
          <Text style={[tb.tabText, active === tab.id && tb.tabTextActive]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function FeedScreen({ navigation }) {
  const { token, profile } = useAuth();
  const { preferences, ready } = usePreferences();
  const isFocused = useIsFocused();
  const [activeTab, setActiveTab] = useState('groups');
  const [groupPosts, setGroupPosts] = useState([]);
  const [socialPosts, setSocialPosts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [connectedPlatforms, setConnectedPlatforms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const selectedSection = preferences.dataSaver ? activeTab : null;
  const fetchAll = useCallback(async (signal) => {
    try {
      const headers = { Authorization: `Bearer ${token}` };
      await Promise.all(feedSections(preferences.dataSaver, selectedSection).map(async section => {
        const path = { groups: '/feed', social: '/social/feed', jobs: '/social/jobs' }[section];
        const { data } = await axios.get(`${API_BASE}${path}`, { headers, signal });
        if (section === 'groups') setGroupPosts(data.posts || []);
        if (section === 'social') {
          setSocialPosts(data.posts || []);
          setConnectedPlatforms(data.connectedPlatforms || []);
        }
        if (section === 'jobs') setJobs(data.jobs || []);
      }));
    } catch (e) {
      if (!axios.isCancel(e)) console.error(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, preferences.dataSaver, selectedSection]);

  useEffect(() => {
    if (!ready || !isFocused) return undefined;
    const controller = new AbortController();
    fetchAll(controller.signal);
    return () => controller.abort();
  }, [fetchAll, ready, isFocused]);

  const onRefresh = () => { setRefreshing(true); fetchAll(); };

  async function handleLike(postId) {
    try {
      const res = await axios.post(`${API_BASE}/feed/${postId}/like`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setGroupPosts((prev) =>
        prev.map((p) => p.id === postId ? { ...p, likedByMe: res.data.likedByMe, likesCount: res.data.likesCount } : p)
      );
    } catch (e) { console.error(e.message); }
  }

  const tabs = [
    { id: 'groups', label: `Groups${groupPosts.length ? ` (${groupPosts.length})` : ''}` },
    { id: 'social', label: `Social${socialPosts.length ? ` (${socialPosts.length})` : ''}` },
    { id: 'jobs',   label: `Jobs${jobs.length ? ` (${jobs.length})` : ''}` },
  ];

  if (loading) {
    return <View style={fs.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  return (
    <View style={fs.screen}>
      <TabBar active={activeTab} onChange={setActiveTab} tabs={tabs} />

      {/* Groups feed */}
      {activeTab === 'groups' && (
        groupPosts.length === 0
          ? (
            <View style={fs.empty}>
              <Text style={fs.emptyIcon}>📭</Text>
              <Text style={fs.emptyTitle}>No posts yet</Text>
              <Text style={fs.emptyText}>Join groups in the Discover tab to see posts here.</Text>
              <TouchableOpacity style={fs.emptyBtn} onPress={() => navigation.navigate('Discover')}>
                <Text style={fs.emptyBtnText}>Discover groups</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={groupPosts}
              keyExtractor={(item) => item.id}
              contentContainerStyle={fs.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
              renderItem={({ item }) => <PostCard post={item} onLike={handleLike} />}
              ListHeaderComponent={
                <Text style={fs.listTitle}>From your {profile?.joinedGroups?.length || 0} groups</Text>
              }
            />
          )
      )}

      {/* Social feed */}
      {activeTab === 'social' && (
        connectedPlatforms.length === 0
          ? (
            <View style={fs.empty}>
              <Text style={fs.emptyIcon}>🔗</Text>
              <Text style={fs.emptyTitle}>No accounts connected</Text>
              <Text style={fs.emptyText}>
                Connect Facebook, Instagram, LinkedIn, X, Reddit, or Indeed to see content from those platforms here.
              </Text>
              <TouchableOpacity
                style={fs.emptyBtn}
                onPress={() => navigation.navigate('Profile')}
              >
                <Text style={fs.emptyBtnText}>Connect accounts</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={socialPosts}
              keyExtractor={(item) => item.id}
              contentContainerStyle={fs.list}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
              renderItem={({ item }) => <SocialPostCard post={item} />}
              ListHeaderComponent={
                <View style={fs.socialHeader}>
                  <Text style={fs.listTitle}>Social feed</Text>
                  <View style={fs.platformPills}>
                    {connectedPlatforms.map((id) => {
                      const meta = PLATFORM_META[id] || {};
                      return (
                        <View key={id} style={[fs.pill, { backgroundColor: meta.bg }]}>
                          <Text style={[fs.pillText, { color: meta.color }]}>{meta.emoji} {meta.name}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              }
            />
          )
      )}

      {/* Jobs */}
      {activeTab === 'jobs' && (
        <FlatList
          data={jobs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={fs.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
          renderItem={({ item }) => <JobCard job={item} />}
          ListHeaderComponent={
            <View style={fs.jobsHeader}>
              <Text style={fs.listTitle}>Recommended jobs</Text>
              <Text style={fs.listSub}>
                {jobs[0]?.relevanceScore > 0
                  ? 'Matched to your skills and profile'
                  : 'Connect Indeed for personalised matches'}
              </Text>
              {!connectedPlatforms.includes('indeed') && (
                <TouchableOpacity
                  style={fs.indeedCta}
                  onPress={() => navigation.navigate('Profile')}
                >
                  <Text style={fs.indeedCtaText}>💼 Connect Indeed for better matches</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const fs = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { padding: 16, paddingBottom: 40 },
  listTitle: { fontSize: 18, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  listSub: { fontSize: 13, color: COLORS.muted, marginBottom: 14 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '800', color: COLORS.text, marginBottom: 8 },
  emptyText: { fontSize: 14, color: COLORS.muted, textAlign: 'center', lineHeight: 22, marginBottom: 24 },
  emptyBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  socialHeader: { marginBottom: 12 },
  platformPills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 8 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  pillText: { fontSize: 12, fontWeight: '600' },
  jobsHeader: { marginBottom: 4 },
  indeedCta: {
    backgroundColor: '#E6ECF8', borderRadius: 12, paddingVertical: 10,
    paddingHorizontal: 14, marginTop: 10, marginBottom: 6,
  },
  indeedCtaText: { color: '#003A9B', fontWeight: '600', fontSize: 13 },
});

const tb = StyleSheet.create({
  bar: {
    flexDirection: 'row', backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: COLORS.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  tabTextActive: { color: COLORS.primary },
});

const soc = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  avatarText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  headerText: { flex: 1 },
  author: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  source: { fontSize: 12, color: COLORS.muted },
  platformBadge: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginRight: 6 },
  platformBadgeText: { fontSize: 15 },
  time: { fontSize: 12, color: COLORS.muted },
  content: { fontSize: 14, color: COLORS.text, lineHeight: 22, marginBottom: 14 },
  actions: { flexDirection: 'row', gap: 20, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  action: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actionIcon: { fontSize: 16 },
  actionCount: { fontSize: 13, color: COLORS.muted, fontWeight: '500' },
});

const job_s = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8,
  },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  title: { fontSize: 16, fontWeight: '800', color: COLORS.text },
  company: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  salary: { fontSize: 14, color: COLORS.success, fontWeight: '700', marginBottom: 10 },
  posted: { fontSize: 12, color: COLORS.muted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  tag: { backgroundColor: COLORS.surface, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  tagText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  typeTag: { bg: '#ECFDF5' },
  applyBtn: {
    borderWidth: 1.5, borderColor: '#003A9B', borderRadius: 10,
    paddingVertical: 9, alignItems: 'center',
  },
  applyBtnText: { color: '#003A9B', fontWeight: '700', fontSize: 14 },
});
