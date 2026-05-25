import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import axios from 'axios';
import { API_BASE } from '../context/AuthContext';
import { COLORS } from '../theme';

function Avatar({ name, size = 44 }) {
  const initials = name
    ? name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
    : '?';
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.33 }]}>{initials}</Text>
    </View>
  );
}

const CONNECT_LABELS = {
  none:             { label: 'Connect',   bg: COLORS.primary,      fg: '#fff',          border: COLORS.primary },
  pending_sent:     { label: 'Pending',   bg: COLORS.surface,      fg: COLORS.muted,    border: COLORS.border },
  pending_received: { label: 'Accept',    bg: COLORS.success,      fg: '#fff',          border: COLORS.success },
  connected:        { label: 'Connected', bg: COLORS.primaryLight, fg: COLORS.primary,  border: COLORS.primary },
};

export default function MemberCard({ member, token }) {
  const [status, setStatus] = useState(member.connectionStatus || 'none');
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    if (status === 'connected' || status === 'pending_sent') return;
    setLoading(true);
    try {
      const res = await axios.post(
        `${API_BASE}/users/${member.id}/connect`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setStatus(res.data.connectionStatus);
    } catch (e) {
      console.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  const btn = CONNECT_LABELS[status] || CONNECT_LABELS.none;

  return (
    <View style={styles.card}>
      <Avatar name={member.name} />
      <View style={styles.info}>
        <Text style={styles.name}>{member.name}</Text>
        <Text style={styles.title}>{member.title}{member.organization ? ` · ${member.organization}` : ''}</Text>
        {member.skills?.length > 0 && (
          <Text style={styles.skills} numberOfLines={1}>{member.skills.slice(0, 3).join(' · ')}</Text>
        )}
      </View>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: btn.bg, borderColor: btn.border }]}
        onPress={handleConnect}
        disabled={loading || status === 'connected' || status === 'pending_sent'}
        activeOpacity={0.8}
      >
        {loading ? (
          <ActivityIndicator size="small" color={btn.fg} />
        ) : (
          <Text style={[styles.btnText, { color: btn.fg }]}>{btn.label}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#fff', borderRadius: 14, padding: 12, marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 1 }, shadowRadius: 6, elevation: 1,
  },
  avatar: { backgroundColor: COLORS.secondary, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarText: { color: '#fff', fontWeight: '800' },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '700', color: COLORS.text },
  title: { fontSize: 12, color: COLORS.muted, marginTop: 1 },
  skills: { fontSize: 11, color: COLORS.primary, marginTop: 3, fontWeight: '500' },
  btn: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1.5, marginLeft: 8,
  },
  btnText: { fontSize: 13, fontWeight: '700' },
});
