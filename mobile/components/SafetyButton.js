import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useModeration } from '../context/ModerationContext';
import { COLORS } from '../theme';

export default function SafetyButton({ postId, userId, userName }) {
  const { profile, token } = useAuth();
  const { openSafety } = useModeration();
  if (!token || (!postId && !userId) || (userId && userId === profile?.id)) return null;
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={postId ? `Report or block post by ${userName || 'this user'}` : `Report or block ${userName || 'this user'}`} style={s.button} onPress={() => openSafety({ postId, userId, userName })}>
    <Text style={s.text}>Report / block</Text>
  </TouchableOpacity>;
}
const s = StyleSheet.create({ button: { paddingVertical: 10, paddingHorizontal: 6, minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }, text: { color: COLORS.muted, fontSize: 12, fontWeight: '600' } });
