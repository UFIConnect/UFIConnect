import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import * as Location from 'expo-location';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import { fetch as nativeFetch } from 'expo/fetch';
import Website from './Website';
import NativeYouTubeLayer from './NativeYouTubeLayer';
import { createSessionStorage } from '../security/sessionStorage';
import { parseProviderCallback, validAuthorizationUrl } from '../security/providerSignIn';
import { MAX_BYTES, bytesToBase64, base64Bytes, safeFileName, createNativeApiBridge, allowDocumentNavigation, externalUrl, assertNativeCapability } from './nativeBridge.cjs';
import { resolveBundledDocument, documentLoadError } from './documentLoader.cjs';
import { nativeAppearance } from './nativeAppearance.cjs';
import { createVpnSessionStore } from './vpnSessionStore.cjs';
import { disconnectVpnSession } from '../native-vpn/client';
import { vpnLaunch } from '../native-vpn/launchClient';
import AndroidVpnAccess from './AndroidVpnAccess';

const API = 'https://api.uficonnect.org';
const CALLBACK = 'uficonnect://auth/callback';
const PENDING_KEY = 'uficonnect.current-site.provider';
const KEY_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const OPAQUE = /^[A-Za-z0-9_-]{32,256}$/;
const sessionStore = createVpnSessionStore({ platform: Platform.OS, disconnect: disconnectVpnSession,
  store: createSessionStorage({ platform: Platform.OS, secureStore: SecureStore, legacyStorage: AsyncStorage }) });

async function multipart(data) {
  const form = new FormData(), files = [];
  const cleanup = async () => { for (const file of files) { try { file.delete(); } catch {} } };
  try {
    for (const field of data.fields) {
      if (!field.file) { form.append(field.name, field.value); continue; }
      const file = new File(Paths.cache, `ufi-upload-${Date.now()}-${Math.random().toString(36).slice(2)}-${safeFileName(field.file.name)}`);
      files.push(file);
      await FileSystem.writeAsStringAsync(file.uri, field.file.base64, { encoding: 'base64' });
      form.append(field.name, { uri: file.uri, name: safeFileName(field.file.name), type: field.file.type || 'application/octet-stream' });
    }
    return { body: form, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

function NativeSite() {
  const [initialSession, setInitialSession] = useState(null);
  const [bundledDocument, setBundledDocument] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [providerBusy, setProviderBusy] = useState(false);
  const [browserOperations, setBrowserOperations] = useState(0);
  const mounted = useRef(true);
  const [nativeAppActive, setNativeAppActive] = useState(AppState.currentState === 'active');
  const [vpnSession, setVpnSession] = useState(null);
  const [vpnOpen, setVpnOpen] = useState(false);
  const issuedVpnSession = useRef(null);
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  const youtubeLayer = useRef(null);
  const [appearance, setAppearance] = useState(useColorScheme() === 'dark' ? 'dark' : 'light');
  const chrome = nativeAppearance(appearance);
  const activeProvider = useRef(false);
  const initialUrlRead = useRef(false);
  const capability = useRef(null);
  if (!capability.current) capability.current = bytesToBase64(Crypto.getRandomBytes(32));
  const documentUrl = useRef(null);
  const bridge = useRef(null);
  if (!bridge.current) bridge.current = createNativeApiBridge({ apiBase: API, fetch: nativeFetch, store: sessionStore, multipart });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const runBrowserOperation = useCallback(async operation => {
    // Safari sheets can leave AppState active. iOS resolves these promises
    // after dismissal; Android browser opening resolves before the tab closes.
    if (Platform.OS !== 'ios') return operation();
    if (!mounted.current) throw new Error('Return to UFIConnect to open your browser.');
    setBrowserOperations(value => value + 1);
    try { return await operation(); }
    finally { if (mounted.current) setBrowserOperations(value => Math.max(0, value - 1)); }
  }, []);

  const onApiRequest = useCallback(async input => {
    const result = await bridge.current.request(input);
    if (Platform.OS === 'android' && /^\/auth\//.test(input?.url || '') && result.data?.token && result.data?.profile?.id) {
      issuedVpnSession.current = { token: result.data.token, profile: result.data.profile };
    }
    return result;
  }, []);
  const onPersistSession = useCallback(async token => {
    if (Platform.OS === 'android') setVpnSession(null);
    await bridge.current.persistSession(token);
    if (Platform.OS !== 'android' || !token || bridge.current.getToken() !== token) return;
    const generation = bridge.current.getGeneration();
    const issued = issuedVpnSession.current;
    issuedVpnSession.current = null;
    if (issued?.token === token) { setVpnSession(issued); return; }
    // Provider replies normally supply the profile; restore it from the same
    // authenticated bridge when a caller persisted only its issued token.
    try {
      const result = await bridge.current.request({ url: '/profile', headers: { Authorization: `Bearer ${token}` } });
      const profile = result.data?.profile || result.data;
      if (generation === bridge.current.getGeneration() && result.status === 200 && profile?.id) setVpnSession({ token, profile });
    } catch { /* The shared account remains usable; a new VPN link can retry. */ }
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setNativeAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const finishProvider = useCallback(async (url, expectedGeneration) => {
    const callback = parseProviderCallback(url);
    if (!callback) throw new Error('Invalid sign-in return link.');
    const raw = await SecureStore.getItemAsync(PENDING_KEY, KEY_OPTIONS);
    await SecureStore.deleteItemAsync(PENDING_KEY, KEY_OPTIONS);
    const pending = raw ? JSON.parse(raw) : null;
    if (!pending || !OPAQUE.test(pending.verifier || '') || !Number.isFinite(pending.createdAt) || !['login', 'signup', 'link'].includes(pending.mode)
      || !['google', 'apple'].includes(pending.provider) || Date.now() - pending.createdAt > 600000 || Date.now() < pending.createdAt
      || expectedGeneration !== bridge.current.getGeneration()) throw new Error('Sign-in expired. Please start again.');
    if (callback.error) throw new Error('Sign-in did not finish. Please try again.');
    if (pending.mode === 'link' && pending.accountToken !== bridge.current.getToken()) throw new Error('The account changed. Please start again.');
    const result = await bridge.current.request({ url: '/auth/providers/finish', method: 'POST', data: { code: callback.code, verifier: pending.verifier } });
    if (result.status !== 200 || !result.data?.token) throw new Error(result.data?.message || 'Sign-in did not finish. Please try again.');
    if (expectedGeneration !== bridge.current.getGeneration()) {
      await nativeFetch(API + '/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${result.data.token}`, 'Content-Type': 'application/json' }, body: '{}', redirect: 'error', credentials: 'omit' }).catch(() => {});
      throw new Error('The account changed. Please start again.');
    }
    if (Platform.OS === 'android') issuedVpnSession.current = { token: result.data.token, profile: result.data.profile };
    return result.data;
  }, []);

  useEffect(() => {
    let active = true;
    capability.current = bytesToBase64(Crypto.getRandomBytes(32));
    documentUrl.current = null;
    setError(''); setReady(false);
    (async () => {
      const document = resolveBundledDocument({ development: __DEV__, platform: Platform.OS,
        openDirectory: () => new Directory(Paths.bundle, 'www.bundle'), isFile: entry => entry instanceof File });
      if (active) setBundledDocument(document);
      let session = await bridge.current.restore();
      const incoming = initialUrlRead.current ? null : await Linking.getInitialURL();
      initialUrlRead.current = true;
      if (parseProviderCallback(incoming)) {
        session = await finishProvider(incoming, bridge.current.getGeneration());
        await bridge.current.persistSession(session.token);
      }
      if (active) { setInitialSession(session); if (Platform.OS === 'android') setVpnSession(session); setReady(true); }
    })().catch(failure => { if (active) setError(failure.message || 'Check your connection and try again.'); });
    return () => { active = false; };
  }, [attempt, finishProvider]);

  const onProviderSignIn = useCallback(async (provider, mode) => {
    if (!['google', 'apple'].includes(provider) || !['login', 'signup', 'link'].includes(mode)) throw new Error('Choose an available sign-in method.');
    if (activeProvider.current) throw new Error('Finish the current sign-in first.');
    if (Platform.OS === 'ios' && !mounted.current) throw new Error('Return to UFIConnect to sign in.');
    activeProvider.current = true; setProviderBusy(true);
    const generation = bridge.current.getGeneration();
    try {
      await SecureStore.deleteItemAsync(PENDING_KEY, KEY_OPTIONS);
      const currentToken = bridge.current.getToken();
      if (mode === 'link' && !currentToken) throw new Error('Sign in before linking an account.');
      const response = await bridge.current.request({ url: `/auth/providers/${provider}/${mode === 'link' ? 'link' : 'start'}`, method: 'POST',
        data: { client: 'native', mode }, headers: mode === 'link' ? { Authorization: `Bearer ${currentToken}` } : {} });
      const data = response.data;
      if (response.status !== 200 || !OPAQUE.test(data?.verifier || '') || !validAuthorizationUrl(data.authorizationUrl || data.url, provider, API)) throw new Error(data?.message || 'This sign-in method is unavailable.');
      if (generation !== bridge.current.getGeneration()) throw new Error('The account changed. Please start again.');
      await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify({ verifier: data.verifier, provider, mode, createdAt: Date.now(), ...(mode === 'link' ? { accountToken: currentToken } : {}) }), KEY_OPTIONS);
      const result = await runBrowserOperation(() => WebBrowser.openAuthSessionAsync(data.authorizationUrl || data.url, CALLBACK, { preferEphemeralSession: false }));
      if (result.type !== 'success') throw new Error('Sign-in was cancelled. You can try again.');
      return await finishProvider(result.url, generation);
    } finally {
      await SecureStore.deleteItemAsync(PENDING_KEY, KEY_OPTIONS).catch(() => {});
      activeProvider.current = false;
      if (Platform.OS !== 'ios' || mounted.current) setProviderBusy(false);
    }
  }, [finishProvider, runBrowserOperation]);

  const onOpenExternal = useCallback(async url => {
    if (Platform.OS === 'android' && vpnLaunch.open(url)) return;
    const target = externalUrl(url);
    if (target.startsWith('https://')) await runBrowserOperation(() => WebBrowser.openBrowserAsync(target, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET }));
    else await Linking.openURL(target);
  }, [runBrowserOperation]);
  const onRequestLocation = useCallback(async () => {
    if (AppState.currentState !== 'active') throw new Error('Return to UFIConnect to use location.');
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) throw new Error('Location permission was not granted. You can change it in Settings.');
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { coords: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }, timestamp: position.timestamp };
  }, []);
  const onCopyText = useCallback(async text => {
    if (typeof text !== 'string' || text.length > 1024 * 1024) throw new Error('This text cannot be copied.');
    await Clipboard.setStringAsync(text);
  }, []);
  const onShareFile = useCallback(async ({ name, type, base64 }) => {
    if (base64Bytes(base64) > MAX_BYTES || typeof type !== 'string' || /[\r\n]/.test(type)) throw new Error('This file cannot be shared.');
    if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is not available on this device.');
    const file = new File(Paths.cache, `ufi-share-${Date.now()}-${safeFileName(name)}`);
    try {
      await FileSystem.writeAsStringAsync(file.uri, base64, { encoding: 'base64' });
      await Sharing.shareAsync(file.uri, { mimeType: type || 'application/octet-stream', dialogTitle: 'Save or share file' });
    } finally { try { file.delete(); } catch {} }
  }, []);

  const shouldNavigate = useCallback(request => {
    if (request.isTopFrame === false) return /^https:\/\//.test(request.url) || request.url === 'about:blank';
    const expectedDocument = documentUrl.current || (request.url === 'about:blank' ? null : bundledDocument?.documentUri);
    const allowed = allowDocumentNavigation(request.url, { development: __DEV__, documentUrl: expectedDocument, bundleRoot: bundledDocument?.readAccessUri });
    if (allowed && request.url !== 'about:blank' && !documentUrl.current) documentUrl.current = request.url;
    if (!allowed && request.navigationType === 'click' && /^https:\/\//.test(request.url)) void onOpenExternal(request.url).catch(() => Alert.alert('Unable to open link', 'Please try again.'));
    return allowed;
  }, [onOpenExternal, bundledDocument]);

  if (!ready) return <View style={styles.recovery}><Text style={styles.brand}>UFIConnect</Text>{error ? <><Text style={styles.message}>{error}</Text><Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></> : <ActivityIndicator color="#102A6B" accessibilityLabel="Opening UFIConnect" />}</View>;
  const mediaActive = nativeAppActive && !vpnOpen && (Platform.OS !== 'ios' || !providerBusy && browserOperations === 0);
  return <SafeAreaView style={[styles.root, { backgroundColor: chrome.backgroundColor }]} edges={['top', 'bottom']}>
    <StatusBar style={chrome.statusBar} />
    <View style={{ flex: 1 }} onLayout={event => { const { width, height } = event.nativeEvent.layout; setContentSize(previous => previous.width === width && previous.height === height ? previous : { width, height }); }}>
    <Website nativePlatform={Platform.OS} nativeAppActive={mediaActive} initialSession={initialSession} nativeCapability={capability.current}
      onYouTubePlayer={async (secret, input) => { assertNativeCapability(capability.current, secret); if (!youtubeLayer.current) throw new Error('Video is unavailable.'); return youtubeLayer.current.request(input); }}
      onApiRequest={async (secret, input) => { assertNativeCapability(capability.current, secret); return onApiRequest(input); }}
      onPersistSession={async (secret, token) => { assertNativeCapability(capability.current, secret); return onPersistSession(token); }}
      onProviderSignIn={async (secret, provider, mode) => { assertNativeCapability(capability.current, secret); return onProviderSignIn(provider, mode); }}
      onOpenExternal={async (secret, url) => { assertNativeCapability(capability.current, secret); return onOpenExternal(url); }}
      onRequestLocation={async secret => { assertNativeCapability(capability.current, secret); return onRequestLocation(); }}
      onCopyText={async (secret, text) => { assertNativeCapability(capability.current, secret); return onCopyText(text); }}
      onShareFile={async (secret, file) => { assertNativeCapability(capability.current, secret); return onShareFile(file); }}
      onAppearanceChange={async (secret, mode) => { assertNativeCapability(capability.current, secret); nativeAppearance(mode); setAppearance(mode); }}
      dom={{ useExpoDOMWebView: false, unstable_useExpoModulesBridge: false,
        style: { flex: 1, backgroundColor: chrome.backgroundColor }, containerStyle: { flex: 1, backgroundColor: chrome.backgroundColor }, scrollEnabled: true, bounces: false,
        // SafeAreaView owns the notch and home-indicator space. Expo DOM's
        // automatic WKWebView insets otherwise apply a second native inset.
        contentInsetAdjustmentBehavior: 'never', automaticallyAdjustContentInsets: false, automaticallyAdjustsScrollIndicatorInsets: false,
        ...(bundledDocument ? { overrideUri: bundledDocument.documentUri, allowingReadAccessToURL: bundledDocument.readAccessUri } : {}),
        originWhitelist: ['*'],
        onShouldStartLoadWithRequest: shouldNavigate, allowFileAccessFromFileURLs: true, allowUniversalAccessFromFileURLs: false,
        javaScriptCanOpenWindowsAutomatically: false, injectedJavaScriptForMainFrameOnly: true, injectedJavaScriptBeforeContentLoadedForMainFrameOnly: true,
        mediaPlaybackRequiresUserAction: true, sharedCookiesEnabled: false, thirdPartyCookiesEnabled: false,
        onError: event => { setError(documentLoadError(event)); setReady(false); },
        onContentProcessDidTerminate: () => { documentUrl.current = null; capability.current = bytesToBase64(Crypto.getRandomBytes(32)); setAttempt(value => value + 1); },
      }} />
    <NativeYouTubeLayer key={attempt} ref={youtubeLayer} active={mediaActive && !providerBusy} containerSize={contentSize} />
    </View>
    {Platform.OS === 'android' && <AndroidVpnAccess session={vpnSession} ready={ready} onVisibilityChange={setVpnOpen} />}
    {providerBusy && <View style={styles.provider}><Text style={{ color: chrome.statusBar === 'light' ? '#edf1f7' : '#334155' }}>Complete sign-in in your browser.</Text><Pressable accessibilityRole="button" onPress={() => WebBrowser.dismissAuthSession()}><Text style={[styles.link, chrome.statusBar === 'light' && { color: '#abc2ff' }]}>Cancel</Text></Pressable></View>}
  </SafeAreaView>;
}

export default function NativeSiteApp() { return <SafeAreaProvider><NativeSite /></SafeAreaProvider>; }
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#fff' }, recovery: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 18, backgroundColor: '#fff' }, brand: { color: '#102A6B', fontSize: 30, fontWeight: '800' }, message: { color: '#334155', textAlign: 'center', lineHeight: 22 }, retry: { backgroundColor: '#102A6B', borderRadius: 8, paddingHorizontal: 22, paddingVertical: 12 }, retryText: { color: '#fff', fontWeight: '700' }, provider: { padding: 12, gap: 8, alignItems: 'center', borderTopWidth: 1, borderColor: '#e2e8f0' }, link: { color: '#102A6B', fontWeight: '700', padding: 8 } });
