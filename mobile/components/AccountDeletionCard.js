import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../theme';

export default function AccountDeletionCard({ navigation }) {
  const { deleteAccount } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const mounted = useRef(true);

  function close() {
    if (pending.current) return;
    setOpen(false);
    setConfirmation('');
    setError('');
  }

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = navigation?.addListener('blur', close);
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') close();
    });
    return () => {
      mounted.current = false;
      unsubscribe?.();
      subscription.remove();
    };
  }, [navigation]);

  async function confirmDeletion() {
    if (pending.current || confirmation !== 'DELETE') return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await deleteAccount();
      if (mounted.current) {
        setOpen(false);
        setConfirmation('');
      }
      Alert.alert('Account deleted', result.localCleared
        ? 'Your account was deleted and recurring memberships were stopped. Provider records and retained backups follow their separate retention policies.'
        : 'Your account was deleted. This device could not clear all saved sign-in data, but that account no longer has access. Provider records and retained backups follow their separate retention policies.');
    } catch (failure) {
      if (mounted.current) {
        setError(failure?.response?.status === 401
          ? 'Your session has expired. Sign in again before deleting your account.'
          : 'Account deletion could not be confirmed. Check your connection and try again, or contact support@uficonnect.org.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return <View style={styles.card}>
    <Text style={styles.heading}>Delete account</Text>
    <Text style={styles.body}>Permanently delete your UFIConnect account and its saved content.</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete account" style={styles.outlineButton}
      onPress={() => { setConfirmation(''); setError(''); setOpen(true); }}>
      <Text style={styles.outlineText}>Delete account</Text>
    </TouchableOpacity>
    <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.dialog} contentContainerStyle={styles.dialogContent} keyboardShouldPersistTaps="handled"
          accessibilityViewIsModal>
          <Text accessibilityRole="header" style={styles.heading}>Permanently delete your account?</Text>
          <Text style={styles.body}>This deletes your profile, posts, messages, and saved account content. Recurring memberships will be stopped. Shared groups remain available to other members.</Text>
          <Text style={styles.body}>Payment providers and retained backups follow their separate retention policies. This action cannot be undone.</Text>
          <Text style={styles.label}>Type DELETE to confirm</Text>
          <TextInput accessibilityLabel="Type DELETE to confirm" style={styles.input} value={confirmation}
            onChangeText={setConfirmation} editable={!busy} autoCapitalize="characters" autoCorrect={false}
            autoComplete="off" spellCheck={false} maxLength={6} />
          {!!error && <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text>}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Permanently delete account"
            accessibilityState={{ disabled: busy || confirmation !== 'DELETE', busy }}
            onPress={confirmDeletion} disabled={busy || confirmation !== 'DELETE'}
            style={[styles.deleteButton, (busy || confirmation !== 'DELETE') && styles.disabled]}>
            {busy && <ActivityIndicator color="#fff" />}
            <Text style={styles.deleteText}>{busy ? 'Deleting account…' : 'Permanently delete account'}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel account deletion" onPress={close}
            disabled={busy} style={[styles.cancelButton, busy && styles.disabled]}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginTop: 16 },
  heading: { color: COLORS.text, fontSize: 18, fontWeight: '800', marginBottom: 12 },
  body: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginBottom: 14 },
  outlineButton: { borderWidth: 1, borderColor: COLORS.danger, borderRadius: 10, padding: 14, alignItems: 'center' },
  outlineText: { color: COLORS.danger, fontWeight: '700', fontSize: 15 },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.65)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  dialog: { flexGrow: 0, maxHeight: '90%', width: '100%', maxWidth: 480, backgroundColor: '#fff', borderRadius: 16 },
  dialogContent: { padding: 22 },
  label: { color: COLORS.text, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: 10, padding: 12, fontSize: 16, color: COLORS.text, marginBottom: 14 },
  error: { color: COLORS.danger, fontSize: 14, lineHeight: 21, marginBottom: 14 },
  deleteButton: { backgroundColor: COLORS.danger, borderRadius: 10, padding: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  deleteText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  cancelButton: { padding: 14, alignItems: 'center', marginTop: 6 },
  cancelText: { color: COLORS.primary, fontSize: 15, fontWeight: '700' },
});
