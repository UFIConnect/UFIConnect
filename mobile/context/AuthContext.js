import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import axios from 'axios';
import Constants from 'expo-constants';
import { resolveApiBase } from '../security/apiConfig';
import { createSessionStorage } from '../security/sessionStorage';
import { deleteAccountWithSession } from '../security/accountDeletion';
import { disconnectVpnSession } from '../native-vpn/client';

export const API_BASE = resolveApiBase(Constants.expoConfig?.extra?.apiUrl, __DEV__);
const sessionStorage = createSessionStorage({
  platform: Platform.OS,
  secureStore: SecureStore,
  legacyStorage: AsyncStorage,
});
const REQUEST_TIMEOUT = 15000;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const currentToken = useRef(null);
  const accountDeletionPending = useRef(null);

  const clearLocalSession = useCallback(async () => {
    const session = currentToken.current;
    currentToken.current = null;
    setToken(null);
    setProfile(null);
    const vpnStopped = await disconnectVpnSession(session).then(() => true, () => false);
    const localCleared = await sessionStorage.clear().then(() => true, () => false);
    if (!vpnStopped || !localCleared) {
      const error = new Error('Device sign-out needs attention.');
      error.localCleared = localCleared; error.vpnDisconnected = vpnStopped; throw error;
    }
  }, []);

  function cleanupResult() {
    return clearLocalSession().then(
      () => ({localCleared: true, vpnDisconnected: true}),
      error => ({localCleared: error?.localCleared === true, vpnDisconnected: error?.vpnDisconnected === true})
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
        } else await disconnectVpnSession(null);
      } catch (error) {
        await disconnectVpnSession(stored).catch(() => {});
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
    try {
      // A newly authenticated account must not inherit an earlier account's VPN.
      await disconnectVpnSession(currentToken.current);
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
    await disconnectVpnSession(currentToken.current).catch(() => {});
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
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
