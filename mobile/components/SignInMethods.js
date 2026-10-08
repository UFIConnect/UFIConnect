import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { COLORS } from '../theme';

export default function SignInMethods({ mode = 'login', navigation, disabled = false, onBusyChange }) {
  const auth = useAuth();
  const [methods, setMethods] = useState(null), [checking, setChecking] = useState(true);
  const [error, setError] = useState(''), [phoneOpen, setPhoneOpen] = useState(false);
  const [phone, setPhone] = useState(''), [name, setName] = useState(''), [title, setTitle] = useState('');
  const [code, setCode] = useState(''), [challenge, setChallenge] = useState(null);
  const [working, setWorking] = useState(false), [resendAt, setResendAt] = useState(0), [now, setNow] = useState(Date.now());
  const mounted = useRef(true), request = useRef(0), locked = useRef(false);
  const signup = mode === 'register';
  const accountAction = signup ? 'Sign up' : 'Sign in';
  const websitePath = signup ? '/register' : '/login';
  const providerBusy = auth.providerAuthState?.busy === true;
  const busy = working || providerBusy || disabled;
  const retrySeconds = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function loadMethods() {
    const id = ++request.current;
    setChecking(true); setError('');
    try {
      const result = await auth.getSignInMethods();
      if (mounted.current && id === request.current) setMethods(result);
    } catch {
      if (mounted.current && id === request.current) { setMethods(null); setError('Sign-in options could not load. You can still use email.'); }
    } finally { if (mounted.current && id === request.current) setChecking(false); }
  }
  useEffect(() => {
    mounted.current = true; void loadMethods();
    const unsubscribe = navigation?.addListener('blur', () => {
      request.current++; setCode(''); setPhone(''); setName(''); setTitle(''); setChallenge(null); setPhoneOpen(false);
      void auth.cancelProviderSignIn();
    });
    return () => { mounted.current = false; request.current++; unsubscribe?.(); };
  }, []);
  useEffect(() => { onBusyChange?.(working || providerBusy); return () => onBusyChange?.(false); }, [working, providerBusy]);
  useEffect(() => {
    if (resendAt <= Date.now()) return undefined;
    const timer = setInterval(() => { const time = Date.now(); setNow(time); if (time >= resendAt) clearInterval(timer); }, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state !== 'active') setCode(''); });
    return () => listener.remove();
  }, []);

  async function providerSignIn(provider) {
    if (locked.current || busy) return;
    locked.current = true; setError(''); setCode('');
    try { await auth.startProviderSignIn(provider, mode); }
    catch (failure) { if (mounted.current) setError(failure.message || 'Sign-in could not start. Please try again.'); }
    finally { locked.current = false; }
  }
  async function sendCode() {
    if (locked.current || busy || retrySeconds) return;
    const normalized = phone.replace(/[\s().-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) return setError('Enter your phone number with its country code, such as +14155550123.');
    if (signup && (!name.trim() || !title.trim())) return setError('Enter your full name and professional title.');
    const id = ++request.current;
    locked.current = true; setWorking(true); setError(''); setCode('');
    try {
      const result = await auth.startPhoneSignIn({ phone: normalized, mode, name: name.trim(), title: title.trim() });
      if (mounted.current && id === request.current) {
        setPhone(normalized); setChallenge(result); setNow(Date.now());
        setResendAt(Date.now() + Math.max(30, Number(result.retryAfter) || 60) * 1000);
      }
    } catch (failure) {
      if (mounted.current && id === request.current) {
        setError(failure?.response?.data?.message || failure.message || 'The code could not be sent. Please try again.');
        const retry = Number(failure?.response?.data?.retryAfter);
        if (retry > 0) { setNow(Date.now()); setResendAt(Date.now() + Math.min(3600, retry) * 1000); }
      }
    } finally { locked.current = false; if (mounted.current) setWorking(false); }
  }
  async function verifyCode() {
    if (locked.current || busy) return;
    if (!/^\d{4,10}$/.test(code)) return setError('Enter the verification code from your text message.');
    locked.current = true; setWorking(true); setError('');
    try { await auth.verifyPhoneSignIn({ ...challenge, phone, code, mode, name: name.trim(), title: title.trim() }); }
    catch (failure) { if (mounted.current) setError(failure?.response?.data?.message || failure.message || 'The code could not be verified. Please try again.'); }
    finally { locked.current = false; if (mounted.current) { setCode(''); setWorking(false); } }
  }

  return <View style={styles.section}>
    {checking ? <View style={styles.status}><ActivityIndicator color={COLORS.primary} /><Text style={styles.note}>Checking sign-in options…</Text></View> : <>
      {['google', 'apple'].map(provider => {
        const available = methods?.[provider]?.available === true;
        const label = provider === 'google' ? 'Google' : 'Apple';
        return <View key={provider}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${accountAction} with ${label}`} accessibilityState={{ disabled: !available || busy }}
            style={[styles.outline, (!available || busy) && styles.disabled]} disabled={!available || busy} onPress={() => providerSignIn(provider)}>
            <Text style={styles.outlineText}>{accountAction} with {label}</Text>
          </TouchableOpacity>
          {!available && <Text style={styles.availability}>{methods?.[provider]?.websiteOnly ? `${label} sign-in is available in the installed app and on our website.` : `${label} sign-in is currently unavailable.`}</Text>}
        </View>;
      })}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Continue with phone number" accessibilityState={{ expanded: phoneOpen, disabled: methods?.phone?.available !== true || busy }}
        style={[styles.outline, (methods?.phone?.available !== true || busy) && styles.disabled]} disabled={methods?.phone?.available !== true || busy}
        onPress={() => { setPhoneOpen(value => !value); setError(''); setCode(''); }}>
        <Text style={styles.outlineText}>Continue with phone number</Text>
      </TouchableOpacity>
      {methods?.phone?.available !== true && <Text style={styles.availability}>Phone verification is currently unavailable.</Text>}
    </>}
    {Object.values(methods || {}).some(method => method.websiteOnly) && <TouchableOpacity accessibilityRole="link" style={styles.linkButton}
      onPress={() => Linking.openURL(`https://uficonnect.org${websitePath}`).catch(() => setError(`Open uficonnect.org${websitePath} in your browser.`))}><Text style={styles.link}>{accountAction} on uficonnect.org</Text></TouchableOpacity>}
    {!checking && !methods && <TouchableOpacity accessibilityRole="button" style={styles.linkButton} onPress={loadMethods}><Text style={styles.link}>Retry sign-in options</Text></TouchableOpacity>}
    {(error || auth.providerAuthState?.error) ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error || auth.providerAuthState.error}</Text> : null}
    {providerBusy && <View style={styles.pending}>
      <ActivityIndicator color={COLORS.primary} /><Text style={styles.note}>Complete sign-in in your browser, then return to UFIConnect.</Text>
      {auth.providerAuthState?.phase !== 'finishing' && <TouchableOpacity accessibilityRole="button" onPress={() => auth.cancelProviderSignIn()}><Text style={styles.link}>Cancel sign-in</Text></TouchableOpacity>}
    </View>}
    {phoneOpen && <View style={styles.phone}>
      {signup && <>
        <Text style={styles.label}>Full name</Text>
        <TextInput accessibilityLabel="Phone signup full name" value={name} onChangeText={setName} editable={!busy && !challenge} maxLength={120} autoComplete="name" style={styles.input} />
        <Text style={styles.label}>Professional title</Text>
        <TextInput accessibilityLabel="Phone signup professional title" value={title} onChangeText={setTitle} editable={!busy && !challenge} maxLength={160} style={styles.input} />
      </>}
      <Text style={styles.label}>Phone number, including country code</Text>
      <TextInput accessibilityLabel="Phone number for verification" placeholder="+14155550123" placeholderTextColor={COLORS.muted} value={phone} onChangeText={setPhone}
        editable={!busy && !challenge} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" maxLength={32} style={styles.input} />
      <Text style={styles.note}>We’ll send a verification code by text. Message and data rates may apply.</Text>
      {challenge ? <>
        <Text style={styles.label}>Verification code</Text>
        <TextInput accessibilityLabel="Phone verification code" value={code} onChangeText={value => setCode(value.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad"
          autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'} textContentType="oneTimeCode" editable={!busy} maxLength={10} style={styles.input} />
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Verify phone number" disabled={busy} style={[styles.primary, busy && styles.disabled]} onPress={verifyCode}>
          {working ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{signup ? 'Verify and create account' : 'Verify and sign in'}</Text>}
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={busy || retrySeconds > 0} style={styles.linkButton} onPress={sendCode}>
          <Text style={styles.link}>{retrySeconds ? `Resend code in ${retrySeconds}s` : 'Resend verification code'}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={busy} style={styles.linkButton} onPress={() => { setChallenge(null); setCode(''); setError(''); }}><Text style={styles.link}>Use a different phone number</Text></TouchableOpacity>
      </> : <TouchableOpacity accessibilityRole="button" accessibilityLabel="Send verification code" disabled={busy || retrySeconds > 0} style={[styles.primary, (busy || retrySeconds > 0) && styles.disabled]} onPress={sendCode}>
        {working ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{retrySeconds ? `Try again in ${retrySeconds}s` : 'Send verification code'}</Text>}
      </TouchableOpacity>}
    </View>}
    <Text style={styles.divider}>Or use email</Text>
  </View>;
}

const styles = StyleSheet.create({
  section: { marginBottom: 16 }, outline: { borderWidth: 1, borderColor: COLORS.border, backgroundColor: '#fff', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 10, alignItems: 'center', marginTop: 8 },
  outlineText: { color: COLORS.text, fontSize: 15, fontWeight: '700', textAlign: 'center' }, disabled: { opacity: 0.5 },
  availability: { color: COLORS.muted, fontSize: 12, marginTop: 4 }, status: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  note: { color: COLORS.muted, fontSize: 13, lineHeight: 19, flexShrink: 1, marginBottom: 10 }, error: { color: '#B42318', fontSize: 14, lineHeight: 20, marginTop: 12 },
  pending: { gap: 8, marginTop: 12 }, phone: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: COLORS.border },
  label: { color: COLORS.text, fontSize: 13, fontWeight: '600', marginBottom: 6 }, input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: COLORS.text, marginBottom: 12 },
  primary: { backgroundColor: COLORS.primary, borderRadius: 12, padding: 14, alignItems: 'center' }, primaryText: { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center' },
  linkButton: { paddingVertical: 10, alignItems: 'center' }, link: { color: COLORS.primary, fontSize: 13, fontWeight: '700' }, divider: { textAlign: 'center', color: COLORS.muted, fontSize: 13, marginTop: 20 },
});
