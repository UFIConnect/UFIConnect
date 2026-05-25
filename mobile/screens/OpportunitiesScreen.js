import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
  TouchableOpacity, TextInput, ScrollView, RefreshControl, Linking,
} from 'react-native';
import axios from 'axios';
import { useAuth, API_BASE } from '../context/AuthContext';
import { COLORS } from '../theme';

const TYPE_META = {
  all:        { label: 'All',         emoji: '✨', color: COLORS.primary,  bg: COLORS.primaryLight },
  job:        { label: 'Jobs',        emoji: '💼', color: '#2563EB',       bg: '#EFF6FF' },
  gig:        { label: 'Gigs',        emoji: '⚡', color: '#7C3AED',       bg: '#F3EEFF' },
  grant:      { label: 'Grants',      emoji: '🏦', color: '#059669',       bg: '#ECFDF5' },
  event:      { label: 'Events',      emoji: '📅', color: '#D97706',       bg: '#FFFBEB' },
  hackathon:  { label: 'Hackathons',  emoji: '🏆', color: '#DB2777',       bg: '#FDF2F8' },
  opensource: { label: 'Open Source', emoji: '🌐', color: '#EA580C',       bg: '#FFF7ED' },
  learning:   { label: 'Learning',    emoji: '🎓', color: '#0284C7',       bg: '#F0F9FF' },
};

const SOURCE_COLORS = {
  'Indeed': '#003A9B', 'LinkedIn': '#0A66C2', 'AngelList': '#000', 'YC Jobs': '#E47228',
  'Remote.co': '#0EA5E9', 'Toptal': '#204ECF', 'Contra': '#7C3AED', 'Upwork': '#14A800',
  'Gun.io': '#1A1A2E', 'mozilla.org': '#FF4500', 'google.org': '#4285F4',
  'GitHub': '#24292E', 'On Deck': '#6366F1', 'openphilanthropy.org': '#059669',
  'Luma': '#FC6E51', 'Eventbrite': '#F05537', 'Meetup': '#F64060',
  'Devpost': '#003E54', 'MLH': '#FF0066', 'Kaggle': '#20BEFF',
  'fast.ai': '#E44C2E', 'YC': '#E47228', 'fullstackopen.com': '#2563EB', 'Scrimba': '#0B2027',
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'Just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function MatchBadge({ score }) {
  if (score === 0) return null;
  return (
    <View style={card.matchBadge}>
      <Text style={card.matchText}>⭐ {score} match</Text>
    </View>
  );
}

function OpportunityCard({ item }) {
  const meta = TYPE_META[item.type] || TYPE_META.all;
  const srcColor = SOURCE_COLORS[item.source] || COLORS.muted;

  return (
    <View style={card.wrap}>
      {/* Top row: type badge + source + time */}
      <View style={card.topRow}>
        <View style={[card.typeBadge, { backgroundColor: meta.bg }]}>
          <Text style={[card.typeBadgeText, { color: meta.color }]}>{meta.emoji} {meta.label}</Text>
        </View>
        <View style={[card.sourceBadge, { backgroundColor: srcColor + '18' }]}>
          <Text style={[card.sourceText, { color: srcColor }]}>{item.source}</Text>
        </View>
        {item.remote && <View style={card.remoteBadge}><Text style={card.remoteText}>Remote</Text></View>}
        <Text style={card.time}>{timeAgo(item.posted)}</Text>
      </View>

      {/* Title + org */}
      <Text style={card.title}>{item.title}</Text>
      <Text style={card.org}>{item.org}</Text>
      {item.location !== 'Remote' && item.location !== 'Virtual' && item.location !== 'Online' && item.location !== 'Global' && (
        <Text style={card.location}>📍 {item.location}</Text>
      )}

      {/* Pay / prize */}
      <Text style={card.pay}>{item.pay}</Text>

      {/* Tags */}
      <View style={card.tags}>
        {item.tags.map((t) => (
          <View key={t} style={card.tag}><Text style={card.tagText}>{t}</Text></View>
        ))}
        <MatchBadge score={item.matchScore} />
      </View>

      {/* CTA */}
      <TouchableOpacity
        style={[card.cta, { borderColor: meta.color }]}
        onPress={() => Linking.openURL(item.sourceUrl).catch(() => {})}
        activeOpacity={0.8}
      >
        <Text style={[card.ctaText, { color: meta.color }]}>
          {item.type === 'event' ? 'Register' : item.type === 'learning' ? 'Start learning' : item.type === 'hackathon' ? 'Join hackathon' : item.type === 'grant' ? 'Apply for grant' : item.type === 'opensource' ? 'View on GitHub' : 'View opportunity'} →
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function OpportunitiesScreen() {
  const { token, profile } = useAuth();
  const [opportunities, setOpportunities] = useState([]);
  const [activeType, setActiveType] = useState('all');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetch = useCallback(async (type, remote, q) => {
    try {
      const params = new URLSearchParams();
      if (type && type !== 'all') params.set('type', type);
      if (remote) params.set('remote', 'true');
      if (q) params.set('search', q);
      const res = await axios.get(`${API_BASE}/opportunities?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setOpportunities(res.data.opportunities);
    } catch (e) { console.error(e.message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [token]);

  useEffect(() => { fetch(activeType, remoteOnly, search); }, [fetch, activeType, remoteOnly]);

  const onRefresh = () => { setRefreshing(true); fetch(activeType, remoteOnly, search); };

  function handleSearch(text) {
    setSearch(text);
    fetch(activeType, remoteOnly, text);
  }

  const counts = {};
  opportunities.forEach((o) => { counts[o.type] = (counts[o.type] || 0) + 1; });

  if (loading) {
    return <View style={scr.center}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }

  return (
    <View style={scr.screen}>
      {/* Search bar */}
      <View style={scr.searchWrap}>
        <TextInput
          style={scr.search}
          placeholder="Search jobs, gigs, grants, events..."
          placeholderTextColor={COLORS.muted}
          value={search}
          onChangeText={handleSearch}
          returnKeyType="search"
        />
        <TouchableOpacity
          style={[scr.remoteToggle, remoteOnly && scr.remoteToggleOn]}
          onPress={() => setRemoteOnly(!remoteOnly)}
        >
          <Text style={[scr.remoteToggleText, remoteOnly && scr.remoteToggleTextOn]}>🌍 Remote</Text>
        </TouchableOpacity>
      </View>

      {/* Type filter strip */}
      <View style={scr.filterWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={scr.filterRow}>
          {Object.entries(TYPE_META).map(([key, meta]) => {
            const isActive = activeType === key;
            const count = key === 'all' ? opportunities.length : (counts[key] || 0);
            return (
              <TouchableOpacity
                key={key}
                style={[scr.chip, isActive && { backgroundColor: meta.color }]}
                onPress={() => setActiveType(key)}
                activeOpacity={0.8}
              >
                <Text style={[scr.chipText, isActive && { color: '#fff' }]}>
                  {meta.emoji} {meta.label}
                  {count > 0 ? ` (${count})` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* List */}
      <FlatList
        data={opportunities}
        keyExtractor={(item) => item.id}
        contentContainerStyle={scr.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
        renderItem={({ item }) => <OpportunityCard item={item} />}
        ListHeaderComponent={
          <View style={scr.listHeader}>
            <Text style={scr.listTitle}>
              {activeType === 'all' ? 'All opportunities' : TYPE_META[activeType]?.label}
            </Text>
            <Text style={scr.listSub}>
              {opportunities.length} found · sorted by relevance to your profile
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={scr.empty}>
            <Text style={scr.emptyIcon}>🔍</Text>
            <Text style={scr.emptyText}>No opportunities match your filters.</Text>
          </View>
        }
      />
    </View>
  );
}

const scr = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  searchWrap: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  search: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border },
  remoteToggle: { backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center' },
  remoteToggleOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  remoteToggleText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  remoteToggleTextOn: { color: '#fff' },
  filterWrap: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  filterRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: COLORS.surface, marginRight: 6 },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  list: { padding: 16, paddingBottom: 40 },
  listHeader: { marginBottom: 14 },
  listTitle: { fontSize: 20, fontWeight: '900', color: COLORS.text },
  listSub: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { color: COLORS.muted, fontSize: 15 },
});

const card = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 2,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  typeBadgeText: { fontSize: 12, fontWeight: '700' },
  sourceBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  sourceText: { fontSize: 11, fontWeight: '600' },
  remoteBadge: { backgroundColor: '#ECFDF5', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  remoteText: { fontSize: 11, fontWeight: '600', color: '#059669' },
  time: { fontSize: 11, color: COLORS.muted, marginLeft: 'auto' },
  title: { fontSize: 17, fontWeight: '800', color: COLORS.text, marginBottom: 3 },
  org: { fontSize: 13, color: COLORS.muted, marginBottom: 2 },
  location: { fontSize: 12, color: COLORS.muted, marginBottom: 4 },
  pay: { fontSize: 15, fontWeight: '700', color: COLORS.success, marginBottom: 10 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  tag: { backgroundColor: COLORS.surface, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  tagText: { fontSize: 12, fontWeight: '600', color: COLORS.muted },
  matchBadge: { backgroundColor: '#FFFBEB', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  matchText: { fontSize: 12, fontWeight: '700', color: '#D97706' },
  cta: { borderWidth: 1.5, borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  ctaText: { fontWeight: '700', fontSize: 14 },
});
