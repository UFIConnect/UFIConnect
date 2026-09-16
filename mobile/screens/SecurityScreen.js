import React, { useState, useEffect } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import PasswordInput from '../components/PasswordInput';
import { useAuth } from '../context/AuthContext';
import { validateNewPassword } from '../security/passwordPolicy';
import { COLORS } from '../theme';

export default function SecurityScreen({ navigation }) {
  const { changePassword, logoutAll } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [concealKey, setConcealKey] = useState(0);
  const [passwordError, setPasswordError] = useState('');

  function clearPasswords() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmation('');
  }

  useEffect(() => navigation.addListener('blur', clearPasswords), [navigation]);

  async function savePassword() {
    setConcealKey(value => value + 1);
    setPasswordError('');
    if (!currentPassword) return setPasswordError('Enter your current password.');
    if (newPassword === currentPassword) return setPasswordError('Choose a new password that is different from your current password.');
    const error = validateNewPassword(newPassword);
    if (error) return setPasswordError(error);
    if (newPassword !== confirmation) return setPasswordError('Passwords do not match. Re-enter your new password.');
    setBusy(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      Alert.alert('Password updated', result.localCleared
        ? 'Your existing sessions have been signed out. Sign in with your new password.'
        : 'Your existing sessions were revoked. This device could not clear its saved sign-in data. Sign in with your new password.');
    } catch (error) {
      setPasswordError(error?.response?.data?.message || 'Could not update password. Please try again when connected.');
    } finally {
      clearPasswords();
      setBusy(false);
    }
  }

  function signOutEverywhere() {
    Alert.alert('Sign out all devices?', 'This ends your existing UFIConnect sessions, including this one.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out all', style: 'destructive', onPress: async () => {
        setBusy(true);
        try {
          const result = await logoutAll();
          if (!result.localCleared) Alert.alert('Sessions signed out', 'Server access was revoked, but this device could not clear its saved sign-in data.');
        } catch {
          Alert.alert('Could not confirm sign-out', 'Please try again when connected.');
        } finally {
          setBusy(false);
        }
      } },
    ]);
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.heading}>Change password</Text>
          <Text style={styles.description}>Choose a unique passphrase with at least 15 characters and no more than 72 UTF-8 bytes. Changing it signs out your existing sessions.</Text>
          <Text style={styles.label}>Current password</Text>
          <PasswordInput style={styles.input} value={currentPassword} onChangeText={value => { setCurrentPassword(value); setPasswordError(''); }}
            accessibilityLabel="Current password" editable={!busy} concealKey={concealKey} />
          <Text style={styles.label}>New password</Text>
          <PasswordInput style={styles.input} value={newPassword} onChangeText={value => { setNewPassword(value); setPasswordError(''); }}
            accessibilityLabel="New password" newPassword editable={!busy} concealKey={concealKey} />
          <Text style={styles.label}>Confirm new password</Text>
          <PasswordInput style={styles.input} value={confirmation} onChangeText={value => { setConfirmation(value); setPasswordError(''); }}
            accessibilityLabel="Confirm new password" newPassword editable={!busy} concealKey={concealKey} />
          {!!passwordError && <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{passwordError}</Text>}
          <TouchableOpacity style={styles.button} onPress={savePassword} disabled={busy} accessibilityRole="button">
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Update password</Text>}
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>Account sessions</Text>
          <Text style={styles.description}>Use this if you lost a device or think someone else has access to your account.</Text>
          <TouchableOpacity style={styles.signOutButton} onPress={signOutEverywhere} disabled={busy} accessibilityRole="button">
            <Text style={styles.signOutText}>Sign out all devices</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>Password protection</Text>
          <Text style={styles.description}>Passwords are hidden by default. Tap Show password to check what you entered; it hides again when you leave the field or submit. Copying stays restricted. Paste and password manager autofill are supported. Two-factor authentication is not available yet.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  container: { padding: 16, paddingBottom: 48 },
  card: { backgroundColor: '#fff', padding: 20, borderRadius: 16, marginBottom: 16 },
  heading: { color: COLORS.text, fontSize: 18, fontWeight: '800', marginBottom: 10 },
  description: { color: COLORS.muted, fontSize: 14, lineHeight: 21, marginBottom: 16 },
  label: { color: COLORS.text, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  error: { color: COLORS.danger, fontSize: 14, lineHeight: 21, marginBottom: 12 },
  input: { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 10, padding: 12, color: COLORS.text, fontSize: 15, marginBottom: 8 },
  button: { backgroundColor: COLORS.primary, alignItems: 'center', padding: 14, borderRadius: 10 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  signOutButton: { padding: 14, borderWidth: 1, borderColor: COLORS.danger, borderRadius: 10, alignItems: 'center' },
  signOutText: { color: COLORS.danger, fontSize: 15, fontWeight: '700' },
});
