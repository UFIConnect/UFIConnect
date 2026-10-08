import React, { useState, useEffect } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useServiceMetrics } from '../analytics/ServiceMetricsProvider';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput, Platform,
} from 'react-native';
import axios from 'axios';
import { useAuth, API_BASE } from '../context/AuthContext';
import AccountDeletionCard from '../components/AccountDeletionCard';
import { COLORS, CATEGORY_COLORS, CATEGORY_ICONS } from '../theme';

const SUGGESTED_SKILLS = [
  'Python', 'React', 'TypeScript', 'Node.js', 'SQL', 'Figma', 'Product Strategy',
  'Data Analysis', 'Machine Learning', 'Growth', 'SEO', 'Content', 'Leadership',
  'Fundraising', 'Go-to-Market', 'DevOps', 'Kubernetes', 'AWS', 'UX Research',
  'Brand', 'Community', 'Sales', 'Finance', 'Blockchain', 'Swift', 'Kotlin',
];

function Avatar({ name, size = 72 }) {
  const initials = name
    ? name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : '?';
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[s.avatarText, { fontSize: size * 0.36 }]}>{initials}</Text>
    </View>
  );
}

function TabBar({ active, onChange }) {
  const tabs = ['Overview', 'Skills', 'Groups'];
  return (
    <View style={s.tabBar}>
      {tabs.map((t) => (
        <TouchableOpacity
          key={t}
          style={[s.tab, active === t && s.tabActive]}
          onPress={() => onChange(t)}
          activeOpacity={0.8}
        >
          <Text style={[s.tabText, active === t && s.tabTextActive]}>{t}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────
function OverviewTab({ profile, navigation, onLogout, loggingOut }) {
  return (
    <View>
      <TouchableOpacity style={s.section} onPress={() => navigation.navigate('Security')} activeOpacity={0.85}>
        <Text style={s.sectionTitle}>Security</Text>
        <Text style={s.sub}>Change your password and manage account sessions</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.section} onPress={() => navigation.navigate('VPN')} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="VPN">
        <Text style={s.sectionTitle}>VPN</Text>
        <Text style={s.sub}>{Platform.OS === 'ios' ? 'Set up your profile in official WireGuard' : 'Connect or disconnect this device'}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={s.section} onPress={() => navigation.navigate('Privacy')} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Data & privacy">
        <Text style={s.sectionTitle}>Data & privacy</Text>
        <Text style={s.sub}>Service metrics and optional performance insights</Text>
      </TouchableOpacity>

      <View style={s.section}>
        <Text style={s.sectionTitle}>Account</Text>
        <View style={s.infoRow}>
          <Text style={s.infoLabel}>Email</Text>
          <Text style={s.infoValue}>{profile.email}</Text>
        </View>
        <View style={s.infoRow}>
          <Text style={s.infoLabel}>Title</Text>
          <Text style={s.infoValue}>{profile.title}</Text>
        </View>
        {profile.organization ? (
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Organization</Text>
            <Text style={s.infoValue}>{profile.organization}</Text>
          </View>
        ) : null}
        <View style={[s.infoRow, { borderBottomWidth: 0 }]}>
          <Text style={s.infoLabel}>Member ID</Text>
          <Text style={s.infoValue}>{profile.id}</Text>
        </View>
      </View>

      <TouchableOpacity style={s.logoutBtn} onPress={onLogout} disabled={loggingOut}>
        {loggingOut
          ? <ActivityIndicator color={COLORS.danger} />
          : <Text style={s.logoutText}>Sign out</Text>
        }
      </TouchableOpacity>
      <AccountDeletionCard navigation={navigation} />
    </View>
  );
}

// ── Skills tab ────────────────────────────────────────────────────────────────
function SkillsTab({ profile, token, onUpdate }) {
  const [skills, setSkills] = useState(profile.skills || []);
  const [newSkill, setNewSkill] = useState('');
  const [saving, setSaving] = useState(false);

  const suggestions = SUGGESTED_SKILLS.filter((sk) => !skills.includes(sk)).slice(0, 12);

  async function saveSkills(updated) {
    setSaving(true);
    try {
      const res = await axios.patch(
        `${API_BASE}/profile`,
        { skills: updated },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSkills(res.data.profile.skills);
      onUpdate(res.data.profile);
    } catch (e) { console.error(e.message); }
    finally { setSaving(false); }
  }

  function addSkill(skill) {
    const clean = skill.trim();
    if (!clean || skills.includes(clean)) return;
    saveSkills([...skills, clean]);
    setNewSkill('');
  }

  function removeSkill(skill) {
    saveSkills(skills.filter((s) => s !== skill));
  }

  return (
    <View>
      {/* Current skills */}
      <View style={s.section}>
        <View style={s.sectionRowHeader}>
          <Text style={s.sectionTitle}>Your skills ({skills.length})</Text>
          {saving && <ActivityIndicator size="small" color={COLORS.primary} />}
        </View>
        {skills.length === 0 ? (
          <Text style={s.empty}>No skills added yet. Add some below.</Text>
        ) : (
          <View style={s.chipRow}>
            {skills.map((sk) => (
              <TouchableOpacity
                key={sk}
                style={s.skillChip}
                onPress={() => Alert.alert('Remove skill', `Remove "${sk}"?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Remove', style: 'destructive', onPress: () => removeSkill(sk) },
                ])}
                activeOpacity={0.8}
              >
                <Text style={s.skillChipText}>{sk}</Text>
                <Text style={s.skillRemove}> ×</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Add custom skill */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Add a skill</Text>
        <View style={s.addRow}>
          <TextInput
            style={s.addInput}
            placeholder="e.g. Swift, Copywriting, SQL..."
            placeholderTextColor={COLORS.muted}
            value={newSkill}
            onChangeText={setNewSkill}
            returnKeyType="done"
            onSubmitEditing={() => addSkill(newSkill)}
          />
          <TouchableOpacity
            style={[s.addBtn, !newSkill.trim() && { opacity: 0.4 }]}
            onPress={() => addSkill(newSkill)}
            disabled={!newSkill.trim()}
          >
            <Text style={s.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Suggestions */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Suggested skills</Text>
        <Text style={s.sub}>Tap to add</Text>
        <View style={[s.chipRow, { marginTop: 10 }]}>
          {suggestions.map((sk) => (
            <TouchableOpacity
              key={sk}
              style={s.suggestChip}
              onPress={() => addSkill(sk)}
              activeOpacity={0.8}
            >
              <Text style={s.suggestChipText}>+ {sk}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

// ── Groups tab ────────────────────────────────────────────────────────────────
function GroupsTab({ profile }) {
  const [allGroups, setAllGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API_BASE}/groups`)
      .then((r) => setAllGroups(r.data.groups))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const joined = allGroups.filter((g) => profile.joinedGroups?.includes(g.id));

  if (loading) return <ActivityIndicator color={COLORS.primary} style={{ marginTop: 24 }} />;

  return (
    <View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Joined groups ({joined.length})</Text>
        {joined.length === 0 ? (
          <Text style={s.empty}>No groups joined yet. Explore the Groups tab!</Text>
        ) : (
          <View style={s.groupList}>
            {joined.map((group) => {
              const cc = CATEGORY_COLORS[group.category] || { bg: COLORS.surface, text: COLORS.muted };
              return (
                <View key={group.id} style={s.groupRow}>
                  <View style={[s.groupIcon, { backgroundColor: cc.bg }]}>
                    <Text style={{ fontSize: 16 }}>{CATEGORY_ICONS[group.category]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.groupName}>{group.name}</Text>
                    <Text style={[s.groupCat, { color: cc.text }]}>{group.category}</Text>
                  </View>
                  <Text style={s.groupMembers}>{(group.members / 1000).toFixed(1)}k</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function ProfileScreen({ navigation }) {
  const { token, profile, logout, updateProfileLocally } = useAuth();
  const [activeTab, setActiveTab] = useState('Overview');
  const metrics = useServiceMetrics();
  const focused = useIsFocused();
  useEffect(() => { if (focused) metrics?.trackTab(`Profile${activeTab}`); }, [activeTab, focused]);
  const [loggingOut, setLoggingOut] = useState(false);

  function handleLogout() {
    Alert.alert('Sign out', Platform.OS === 'ios' ? 'Sign out of UFIConnect? A connection in WireGuard keeps running. Disconnect it in WireGuard when needed.' : 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => {
        setLoggingOut(true);
        const result = await logout();
        if (!result.localCleared || !result.serverRevoked || result.vpnDisconnected === false) {
          Alert.alert('Sign-out needs attention', result.vpnDisconnected === false
            ? 'Disconnect UFIConnect VPN in device VPN settings to finish signing out.'
            : !result.serverRevoked
            ? 'The server could not confirm sign-out. When connected, sign in and use Security > Sign out all devices.'
            : 'Server access was revoked, but this device could not clear its saved sign-in data.');
        }
      } },
    ]);
  }

  if (!profile) return null;

  const joinedCount = profile.joinedGroups?.length || 0;
  const skillCount = profile.skills?.length || 0;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.container}>
      {/* Header card */}
      <View style={s.headerCard}>
        <Avatar name={profile.name} />
        <Text style={s.name}>{profile.name}</Text>
        <Text style={s.titleText}>{profile.title}</Text>
        {profile.organization ? <Text style={s.org}>{profile.organization}</Text> : null}
        {profile.bio ? <Text style={s.bio}>{profile.bio}</Text> : null}

        <View style={s.statsRow}>
          {[
            { value: joinedCount, label: 'Groups' },
            { value: skillCount,  label: 'Skills' },
          ].map((stat, i) => (
            <React.Fragment key={stat.label}>
              {i > 0 && <View style={s.statDiv} />}
              <View style={s.stat}>
                <Text style={s.statValue}>{stat.value}</Text>
                <Text style={s.statLabel}>{stat.label}</Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      </View>

      {/* Tab bar */}
      <TabBar active={activeTab} onChange={setActiveTab} />

      {/* Tab content */}
      {activeTab === 'Overview' && (
        <OverviewTab profile={profile} navigation={navigation} onLogout={handleLogout} loggingOut={loggingOut} />
      )}
      {activeTab === 'Skills' && (
        <SkillsTab profile={profile} token={token} onUpdate={updateProfileLocally} />
      )}
      {activeTab === 'Groups' && (
        <GroupsTab profile={profile} />
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  container: { padding: 16, paddingBottom: 48 },
  headerCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 4,
    shadowColor: '#000', shadowOpacity: 0.06, shadowOffset: { width: 0, height: 3 }, shadowRadius: 12, elevation: 3,
  },
  avatar: { backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  avatarText: { color: '#fff', fontWeight: '800' },
  name: { fontSize: 24, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  titleText: { fontSize: 15, color: COLORS.primary, fontWeight: '600', marginBottom: 2 },
  org: { fontSize: 14, color: COLORS.muted, marginBottom: 4 },
  bio: { fontSize: 14, color: COLORS.muted, textAlign: 'center', lineHeight: 20, marginTop: 4 },
  statsRow: { flexDirection: 'row', marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border, width: '100%' },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '800', color: COLORS.text },
  statLabel: { fontSize: 11, color: COLORS.muted, marginTop: 2 },
  statDiv: { width: 1, backgroundColor: COLORS.border },
  // Tab bar
  tabBar: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, marginVertical: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
  tabActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: COLORS.muted },
  tabTextActive: { color: '#fff' },
  // Shared section
  section: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 1,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: COLORS.text, marginBottom: 10 },
  sectionRowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  arrow: { fontSize: 18, color: COLORS.muted },
  sub: { fontSize: 13, color: COLORS.muted },
  empty: { fontSize: 14, color: COLORS.muted, lineHeight: 20 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  infoLabel: { fontSize: 14, color: COLORS.muted },
  infoValue: { fontSize: 14, color: COLORS.text, fontWeight: '500', maxWidth: '60%', textAlign: 'right' },
  logoutBtn: { borderWidth: 1.5, borderColor: COLORS.danger, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  logoutText: { color: COLORS.danger, fontWeight: '700', fontSize: 15 },
  // Skills
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  skillChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primaryLight, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  skillChipText: { color: COLORS.primary, fontWeight: '600', fontSize: 13 },
  skillRemove: { color: COLORS.primary, fontWeight: '800', fontSize: 14 },
  suggestChip: { backgroundColor: COLORS.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: COLORS.border },
  suggestChipText: { color: COLORS.muted, fontWeight: '600', fontSize: 13 },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  addInput: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border },
  addBtn: { backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  // Groups tab
  groupList: { gap: 10 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  groupIcon: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  groupName: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  groupCat: { fontSize: 12, fontWeight: '600', marginTop: 1 },
  groupMembers: { fontSize: 12, color: COLORS.muted, fontWeight: '500' },
});
