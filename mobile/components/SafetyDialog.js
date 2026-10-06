import React, { useState } from 'react';
import { Modal, View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { COLORS } from '../theme';
import { REPORT_REASONS } from '../security/moderationService';

export default function SafetyDialog({ target, onClose, onReport, onBlock }) {
  const [mode, setMode] = useState('choose');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const busyRef = React.useRef(false);

  async function submit() {
    if (busyRef.current) return;
    if (mode !== 'block' && !reason) { setError('Choose a reason for your report.'); return; }
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      if (mode === 'block') {
        await onBlock(target.userId);
        setDone('User blocked. Their posts, group member entries, and conversations are hidden. You cannot message them while blocked.');
      } else {
        await onReport({ targetType: mode, targetId: mode === 'post' ? target.postId : target.userId, reason, details });
        setDone('Report submitted. Thank you for letting us know.');
      }
    } catch {
      setError(mode === 'block' ? 'Could not block this user. Please try again.' : 'Could not submit your report. Please try again.');
    } finally { busyRef.current = false; setBusy(false); }
  }
  function close() { if (!busyRef.current) onClose(); }
  function choose(next) { setMode(next); setError(''); }
  function button(label, onPress, disabled = false, secondary = false) {
    return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} style={[s.button, secondary && s.secondary, disabled && s.disabled]} disabled={disabled} onPress={onPress}>
      <Text style={[s.buttonText, secondary && s.secondaryText]}>{label}</Text>
    </TouchableOpacity>;
  }
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={s.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.panel} accessibilityViewIsModal>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
            <Text style={s.heading} accessibilityRole="header">{done ? 'Safety update' : mode === 'choose' ? 'Report or block' : mode === 'block' ? 'Block this user?' : `Report ${mode}`}</Text>
            {done ? <>
              <Text style={s.body} accessibilityRole="alert">{done}</Text>
              {button('Done', close)}
            </> : <>
              {mode === 'choose' ? <>
                <Text style={s.body}>Choose an action for {target.userName || 'this content'}.</Text>
                {target.postId && button('Report post', () => choose('post'))}
                {target.userId && button('Report user', () => choose('user'))}
                {target.userId && button('Block user', () => choose('block'), false, true)}
              </> : mode === 'block' ? <Text style={s.body}>Blocking {target.userName || 'this user'} hides their posts and conversations and prevents messages between you. Existing follows and connections are removed.</Text> : <>
                <Text style={s.body}>Choose a reason. You can add details below.</Text>
                {REPORT_REASONS.map(item => <TouchableOpacity key={item.value} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{ checked: reason === item.value, disabled: busy }} disabled={busy} onPress={() => setReason(item.value)} style={[s.reason, reason === item.value && s.selected]}>
                  <Text style={s.reasonText}>{reason === item.value ? '● ' : '○ '}{item.label}</Text>
                </TouchableOpacity>)}
                <TextInput accessibilityLabel="Report details" style={s.input} multiline maxLength={1000} editable={!busy} value={details} onChangeText={setDetails} placeholder="Additional details (optional)" placeholderTextColor={COLORS.muted} />
              </>}
              {error ? <Text style={s.error} accessibilityRole="alert">{error}</Text> : null}
              {busy && <ActivityIndicator accessibilityLabel="Submitting safety request" color={COLORS.primary} />}
              {mode !== 'choose' && button(mode === 'block' ? 'Confirm block' : 'Submit report', submit, busy || (mode !== 'block' && !reason))}
              {button('Cancel', close, busy, true)}
            </>}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  panel: { backgroundColor: '#fff', borderRadius: 18, maxWidth: 480, width: '100%', maxHeight: '90%' },
  content: { padding: 22, gap: 10 }, heading: { color: COLORS.text, fontSize: 22, fontWeight: '800' },
  body: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginVertical: 4 },
  button: { borderRadius: 10, padding: 13, backgroundColor: COLORS.primary, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  secondary: { backgroundColor: COLORS.surface }, secondaryText: { color: COLORS.primary }, disabled: { opacity: 0.45 },
  reason: { padding: 12, borderWidth: 1, borderColor: COLORS.border, borderRadius: 9 },
  selected: { backgroundColor: COLORS.primaryLight, borderColor: COLORS.primary }, reasonText: { color: COLORS.text, fontSize: 14 },
  input: { minHeight: 88, textAlignVertical: 'top', borderWidth: 1, borderColor: COLORS.border, borderRadius: 9, padding: 12, color: COLORS.text, fontSize: 14 },
  error: { color: COLORS.danger, fontSize: 14, lineHeight: 20 },
});
