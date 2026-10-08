import React, { useState, useEffect } from 'react';
import {
  View, Text, Image, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';
import SignInMethods from '../components/SignInMethods';
import { validateNewPassword } from '../security/passwordPolicy';
import { COLORS } from '../theme';

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [alternativeBusy, setAlternativeBusy] = useState(false);
  const [concealKey, setConcealKey] = useState(0);
  useEffect(() => navigation.addListener('blur', () => setPassword('')), [navigation]);

  async function handleRegister() {
    setConcealKey(value => value + 1);
    if (!name.trim() || !email.trim() || !password || !title.trim()) {
      return Alert.alert('Missing fields', 'Please fill in the required fields.');
    }
    const passwordError = validateNewPassword(password);
    if (passwordError) return Alert.alert('Check password', passwordError);
    setLoading(true);
    try {
      await register(name.trim(), email.trim().toLowerCase(), password, title.trim(), phone.trim());
    } catch (err) {
      Alert.alert('Registration failed', err?.response?.data?.message || 'Please try again.');
    } finally {
      setPassword('');
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.brand}><Image source={require('../assets/icon.png')} style={styles.brandIcon} accessible={false} /><Text style={styles.logo}>UFIconnect</Text></View>
          <Text style={styles.tagline}>Join your professional community</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Connect with your communities.</Text>

          <SignInMethods mode="register" navigation={navigation} disabled={loading} onBusyChange={setAlternativeBusy} />

          <Text style={styles.label}>Full name</Text>
          <TextInput style={styles.input} placeholder="Alex Kim" placeholderTextColor={COLORS.muted}
            value={name} onChangeText={setName} autoCapitalize="words" />

          <Text style={styles.label}>Professional title</Text>
          <TextInput style={styles.input} placeholder="Software Engineer" placeholderTextColor={COLORS.muted}
            value={title} onChangeText={setTitle} autoCapitalize="words" />

          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} placeholder="you@example.com" placeholderTextColor={COLORS.muted}
            value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />

          <Text style={styles.label}>Phone number (optional)</Text>
          <TextInput style={styles.input} placeholder="+1 555 123 4567" placeholderTextColor={COLORS.muted}
            value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />

          <Text style={styles.label}>Password</Text>
          <PasswordInput style={styles.input} placeholder="At least 12 characters" placeholderTextColor={COLORS.muted}
            value={password} onChangeText={setPassword} newPassword accessibilityLabel="New password" editable={!loading && !alternativeBusy} concealKey={concealKey} />

          <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading || alternativeBusy}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create account</Text>}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity disabled={loading || alternativeBusy} onPress={() => navigation.popTo('Login')}>
              <Text style={styles.link}>Sign in</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: COLORS.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  header: { alignItems: 'center', marginBottom: 32 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandIcon: { width: 48, height: 48, borderRadius: 11 },
  logo: { fontSize: 36, fontWeight: '900', color: COLORS.primary, letterSpacing: -1 },
  tagline: { marginTop: 6, fontSize: 15, color: COLORS.muted },
  card: {
    backgroundColor: '#fff', borderRadius: 20, padding: 24,
    shadowColor: '#000', shadowOpacity: 0.07, shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16, elevation: 4,
  },
  title: { fontSize: 24, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  subtitle: { fontSize: 14, color: COLORS.muted, marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.surface, borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 15, color: COLORS.text, marginBottom: 16,
    borderWidth: 1, borderColor: COLORS.border,
  },
  button: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  footerText: { color: COLORS.muted, fontSize: 14 },
  link: { color: COLORS.primary, fontWeight: '700', fontSize: 14 },
});
