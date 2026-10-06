import React, { useState, useEffect } from 'react';
import {
  View, Text, Image, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import PasswordInput from '../components/PasswordInput';
import { COLORS } from '../theme';

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [concealKey, setConcealKey] = useState(0);
  useEffect(() => navigation.addListener('blur', () => setPassword('')), [navigation]);

  async function handleLogin() {
    setConcealKey(value => value + 1);
    if (!email.trim() || !password) {
      return Alert.alert('Missing fields', 'Please enter your email and password.');
    }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err) {
      Alert.alert('Login failed', err?.response?.data?.message || 'Check your credentials and try again.');
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
          <Text style={styles.tagline}>Your communities and conversations.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor={COLORS.muted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoCorrect={false}
          />

          <Text style={styles.label}>Password</Text>
          <PasswordInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={COLORS.muted}
            value={password}
            onChangeText={setPassword}
            accessibilityLabel="Password"
            editable={!loading}
            concealKey={concealKey}
          />

          <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Register')}>
              <Text style={styles.link}>Create one</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate('Privacy')} style={{ marginTop: 20, alignItems: 'center' }}>
            <Text style={styles.link}>Data & privacy</Text>
          </TouchableOpacity>
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
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 16,
    elevation: 4,
  },
  title: { fontSize: 24, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  subtitle: { fontSize: 14, color: COLORS.muted, marginBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: COLORS.text, marginBottom: 6 },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: COLORS.text,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  footerText: { color: COLORS.muted, fontSize: 14 },
  link: { color: COLORS.primary, fontWeight: '700', fontSize: 14 },
});
