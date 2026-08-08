import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../theme';

export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!name.trim() || !email.trim() || !password.trim() || !title.trim()) {
      return Alert.alert('Missing fields', 'Please fill in all fields.');
    }
    if (password.length < 6) {
      return Alert.alert('Weak password', 'Password must be at least 6 characters.');
    }
    setLoading(true);
    try {
      await register(name.trim(), email.trim().toLowerCase(), password, title.trim());
    } catch (err) {
      Alert.alert('Registration failed', err?.response?.data?.message || 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.logo}>UFconnect</Text>
          <Text style={styles.tagline}>Join your professional community</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Free forever. No ads, ever.</Text>

          <Text style={styles.label}>Full name</Text>
          <TextInput style={styles.input} placeholder="Alex Kim" placeholderTextColor={COLORS.muted}
            value={name} onChangeText={setName} autoCapitalize="words" />

          <Text style={styles.label}>Professional title</Text>
          <TextInput style={styles.input} placeholder="Software Engineer" placeholderTextColor={COLORS.muted}
            value={title} onChangeText={setTitle} autoCapitalize="words" />

          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} placeholder="you@example.com" placeholderTextColor={COLORS.muted}
            value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />

          <Text style={styles.label}>Password</Text>
          <TextInput style={styles.input} placeholder="Min. 6 characters" placeholderTextColor={COLORS.muted}
            value={password} onChangeText={setPassword} secureTextEntry />

          <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Create account</Text>}
          </TouchableOpacity>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
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
