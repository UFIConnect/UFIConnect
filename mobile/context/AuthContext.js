import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import Constants from 'expo-constants';
import { resolveApiBase } from '../security/apiConfig';
import { createSessionStorage } from '../security/sessionStorage';
import { deleteAccountWithSession } from '../security/accountDeletion';
import { disconnectVpnSession } from '../native-vpn/client';
import { createProviderSignIn, PENDING_KEY } from '../security/providerSignIn';

export const API_BASE = resolveApiBase(Constants.expoConfig?.extra?.apiUrl, __DEV__);
const sessionStorage = createSessionStorage({
  platform: Platform.OS,
  secureStore: SecureStore,
  legacyStorage: AsyncStorage,
});
const REQUEST_TIMEOUT = 15000;
// Official WireGuard on iOS has its own OS tunnel and lifecycle. App sign-out
// must not claim it stopped an external application's connection.
const disconnectManagedVpnSession = token => Platform.OS === 'ios'
  ? Promise.resolve({externalManaged:true}) : disconnectVpnSession(token);

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const currentToken = useRef(null);
  const accountDeletionPending = useRef(null);
  const providerSignIn = useRef(null);
  const [providerAuthState, setProviderAuthState] = useState({ busy: false, phase: 'idle', error: '' });

  const clearLocalSession = useCallback(async () => {
    const session = currentToken.current;
    currentToken.current = null;
    setToken(null);
    setProfile(null);
    const vpnStopped = await disconnectManagedVpnSession(session).then(() => true, () => false);
    const localCleared = await sessionStorage.clear().then(() => true, () => false);
    if (!vpnStopped || !localCleared) {
      const error = new Error('Device sign-out needs attention.');
      error.localCleared = localCleared; error.vpnDisconnected = vpnStopped; throw error;
    }
  }, []);

  function cleanupResult() {
    return clearLocalSession().then(
      () => ({localCleared: true, vpnDisconnected: Platform.OS === 'ios' ? null : true}),
      error => ({localCleared: error?.localCleared === true, vpnDisconnected: Platform.OS === 'ios' ? null : error?.vpnDisconnected === true})
    );
  }

  useEffect(() => {
    let active = true;
    (async () => {
      let stored;
      try {
        stored = await sessionStorage.read();
        if (stored) {
          const res = await axios.get(`${API_BASE}/profile`, {
            headers: { Authorization: `Bearer ${stored}` },
            timeout: REQUEST_TIMEOUT,
          });
          if (active) {
            currentToken.current = stored;
            setToken(stored);
            setProfile(res.data.profile || res.data);
          }
        } else await disconnectManagedVpnSession(null);
      } catch (error) {
        await disconnectManagedVpnSession(stored).catch(() => {});
        if ([401, 403].includes(error?.response?.status)) {
          await sessionStorage.clear().catch(() => {});
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const interceptor = axios.interceptors.response.use((response) => response, async (error) => {
      const request = error?.config;
      const authHeader = request?.headers?.Authorization;
      // A wrong current password is a form error, not a revoked session.
      if (error?.response?.status === 401 && currentToken.current &&
          request?.url?.startsWith(`${API_BASE}/`) &&
          request.url !== `${API_BASE}/profile/password` &&
          authHeader === `Bearer ${currentToken.current}`) {
        await clearLocalSession().catch(() => {});
      }
      return Promise.reject(error);
    });
    return () => axios.interceptors.response.eject(interceptor);
  }, [clearLocalSession]);

  async function acceptSession(data) {
    if (typeof data?.token !== 'string' || !data.token || !data.profile || typeof data.profile !== 'object') {
      throw new Error('Sign-in returned an incomplete session. Please try again.');
    }
    try {
      // The managed Android tunnel must not carry over between app accounts.
      await disconnectManagedVpnSession(currentToken.current);
      await sessionStorage.write(data.token);
    } catch {
      // Do not fall back to insecure persistence if the OS store is unavailable.
      if (data.token) {
        await axios.post(`${API_BASE}/auth/logout`, {}, {
          headers: { Authorization: `Bearer ${data.token}` }, timeout: REQUEST_TIMEOUT,
        }).catch(() => {});
      }
      throw new Error('Secure sign-in storage is unavailable. Please try again.');
    }
    currentToken.current = data.token;
    setToken(data.token);
    setProfile(data.profile);
    return data;
  }

  async function login(email, password) {
    const res = await axios.post(`${API_BASE}/auth/login`, { email, password }, { timeout: REQUEST_TIMEOUT });
    return acceptSession(res.data);
  }

  async function register(name, email, password, title, phone) {
    const res = await axios.post(`${API_BASE}/auth/register`, { name, email, password, title, phone }, { timeout: REQUEST_TIMEOUT });
    return acceptSession(res.data);
  }

  useEffect(() => {
    if (Platform.OS === 'web' || loading) return undefined;
    const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
    if (!providerSignIn.current) providerSignIn.current = createProviderSignIn({
      apiBase: API_BASE,
      post: async (path, body) => (await axios.post(`${API_BASE}${path}`, body, { timeout: REQUEST_TIMEOUT })).data,
      store: {
        read: async () => { const raw = await SecureStore.getItemAsync(PENDING_KEY, options); return raw ? JSON.parse(raw) : null; },
        write: value => SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(value), options),
        clear: () => SecureStore.deleteItemAsync(PENDING_KEY, options),
      },
      openURL: url => Linking.openURL(url), acceptSession,
      discardSession: data => typeof data?.token === 'string' ? axios.post(`${API_BASE}/auth/logout`, {}, {
        headers: { Authorization: `Bearer ${data.token}` }, timeout: REQUEST_TIMEOUT,
      }) : Promise.resolve(),
      canAccept: () => !currentToken.current,
    });
    const controller = providerSignIn.current;
    const unsubscribe = controller.subscribe(setProviderAuthState);
    let active = true;
    const subscription = Linking.addEventListener('url', ({ url }) => { void controller.open(url); });
    void controller.restore().then(() => Linking.getInitialURL()).then(url => { if (active && url) return controller.open(url); }).catch(() => {});
    return () => { active = false; subscription.remove(); unsubscribe(); };
  }, [loading]);

  async function getSignInMethods() {
    const response = await axios.get(`${API_BASE}/auth/providers`, { timeout: REQUEST_TIMEOUT });
    const providers = response.data?.providers || {};
    return Object.fromEntries(['google', 'apple', 'phone'].map(provider => [provider, {
      available: providers[provider]?.enabled === true && (provider === 'phone' || Platform.OS !== 'web'),
      websiteOnly: Platform.OS === 'web' && provider !== 'phone' && providers[provider]?.enabled === true,
    }]));
  }

  async function startProviderSignIn(provider, mode) {
    if (Platform.OS === 'web' || !providerSignIn.current) throw new Error('Use uficonnect.org to sign in with Google or Apple in a browser.');
    await providerSignIn.current.start(provider, mode === 'register' ? 'signup' : 'login');
  }

  async function cancelProviderSignIn() {
    try { await providerSignIn.current?.cancel(); }
    catch { setProviderAuthState({ busy: false, phase: 'idle', error: 'Sign-in could not be cleared from secure storage. Please try again.' }); }
  }

  async function startPhoneSignIn({ phone, mode, name, title }) {
    const body = { phoneNumber: phone, mode: mode === 'register' ? 'signup' : 'login' };
    if (body.mode === 'signup') Object.assign(body, { name, title });
    const response = await axios.post(`${API_BASE}/auth/phone/request`, body, { timeout: REQUEST_TIMEOUT });
    if (typeof response.data?.verificationId !== 'string') throw new Error('The verification request could not start.');
    return { verificationId: response.data.verificationId, retryAfter: response.data.resendAfter || 60 };
  }

  async function verifyPhoneSignIn({ verificationId, code }) {
    const response = await axios.post(`${API_BASE}/auth/phone/verify`, { verificationId, code }, { timeout: REQUEST_TIMEOUT });
    return acceptSession(response.data);
  }

  async function logout() {
    const session = currentToken.current;
    const { localCleared, vpnDisconnected } = await cleanupResult();
    let serverRevoked = !session;
    if (session) {
      try {
        await axios.post(`${API_BASE}/auth/logout`, {}, {
          headers: { Authorization: `Bearer ${session}` }, timeout: REQUEST_TIMEOUT,
        });
        serverRevoked = true;
      } catch (error) {
        serverRevoked = error?.response?.status === 401;
      }
    }
    return { localCleared, serverRevoked, vpnDisconnected };
  }

  async function logoutAll() {
    await disconnectManagedVpnSession(currentToken.current).catch(() => {});
    await axios.post(`${API_BASE}/auth/logout-all`, {}, {
      headers: { Authorization: `Bearer ${currentToken.current}` }, timeout: REQUEST_TIMEOUT,
    });
    return cleanupResult();
  }

  async function changePassword(currentPassword, newPassword) {
    const res = await axios.post(`${API_BASE}/profile/password`, { currentPassword, newPassword }, {
      headers: { Authorization: `Bearer ${currentToken.current}` }, timeout: REQUEST_TIMEOUT,
    });
    // Updating the password revokes every existing session on the server.
    return { ...res.data, ...(await cleanupResult()) };
  }

  function deleteAccount() {
    if (accountDeletionPending.current) return accountDeletionPending.current;
    const session = currentToken.current;
    const operation = deleteAccountWithSession({
      client: axios, apiBase: API_BASE, token: session,
      clearLocalSession: async () => {
        // Do not clear a different account if the user signed in again while
        // the original account's deletion request was finishing.
        if (currentToken.current === session) await clearLocalSession();
      },
    }).finally(() => { accountDeletionPending.current = null; });
    accountDeletionPending.current = operation;
    return operation;
  }

  function updateProfileLocally(updated) {
    setProfile(updated);
  }

  const onboardingComplete = profile?.onboardingComplete ?? true;

  return (
    <AuthContext.Provider value={{
      token, profile, loading,
      onboardingComplete,
      login, register, logout, logoutAll, changePassword, deleteAccount, updateProfileLocally,
      getSignInMethods, startProviderSignIn, cancelProviderSignIn, providerAuthState, startPhoneSignIn, verifyPhoneSignIn,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
