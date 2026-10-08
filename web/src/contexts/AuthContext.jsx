import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useRef } from 'react';
import client, { publicOAuthRequestConfig } from '../api/client';
import { auth0AuthorizationParams, isAuth0Configured } from '../auth/auth0Config';
import { clearSession, getAccessToken, setAccessToken, subscribeToSession } from '../auth/session';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(getAccessToken);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [restoringSession, setRestoringSession] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const restoreGeneration = useRef(0);
  const restoreRequest = useRef(null);
  const auth0 = useAuth0();
  const auth0Enabled = isAuth0Configured;

  useEffect(() => subscribeToSession((nextToken) => {
    setToken(nextToken);
    if (!nextToken) setProfile(null);
  }), []);

  useEffect(() => {
    let cancelled = false;
    const generation = ++restoreGeneration.current;
    const isCurrent = () => !cancelled && generation === restoreGeneration.current;
    if (getAccessToken()) { setRestoringSession(false); return undefined; }
    const controller = new AbortController();
    restoreRequest.current = controller;
    setRestoringSession(true);
    setSessionError(false);
    client.get('/auth/session', publicOAuthRequestConfig({ _ufiReauthentication: true, signal: controller.signal }))
      .then(({ data }) => {
        if (!isCurrent()) return;
        if (!data?.token) throw new Error('Session response unavailable');
        setAccessToken(data.token);
        setProfile(data.profile || null);
      })
      .catch((error) => {
        // A temporary connection/server failure is not a sign-out. Keep the
        // member's current URL and let them retry the HttpOnly session.
        if (isCurrent() && ![401, 403].includes(error?.response?.status)) setSessionError(true);
      })
      .finally(() => { if (isCurrent()) setRestoringSession(false); });
    return () => {
      cancelled = true;
      controller.abort();
      if (restoreRequest.current === controller) restoreRequest.current = null;
    };
  }, [restoreAttempt]);

  function retrySession() {
    setRestoringSession(true);
    setSessionError(false);
    setRestoreAttempt(attempt => attempt + 1);
  }

  const refreshProfile = useCallback(async () => {
    const activeToken = getAccessToken();
    if (!activeToken) return null;
    const { data } = await client.get('/profile');
    if (data?.error || !data?.id) throw new Error('Profile unavailable');
    if (getAccessToken() === activeToken) setProfile(data);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setProfile(null);
      if (!restoringSession && (!auth0Enabled || !auth0.isLoading)) setLoading(false);
      return undefined;
    }
    setLoading(true);
    refreshProfile().catch((error) => {
      if (!cancelled && getAccessToken() === token && [401, 403].includes(error?.response?.status)) clearSession();
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, refreshProfile, auth0Enabled, auth0.isLoading, restoringSession]);

  useEffect(() => {
    if (!auth0Enabled || auth0.isLoading || !auth0.isAuthenticated) return undefined;
    let cancelled = false;
    let generation = restoreGeneration.current;
    const isCurrent = () => !cancelled && generation === restoreGeneration.current;
    setLoading(true);
    auth0.getAccessTokenSilently({ authorizationParams: auth0AuthorizationParams() })
      .then(async (accessToken) => {
        if (!isCurrent()) return;
        generation = ++restoreGeneration.current;
        restoreRequest.current?.abort();
        setRestoringSession(false);
        setSessionError(false);
        setAccessToken(accessToken);
        const { data } = await client.get('/auth/me');
        if (isCurrent() && getAccessToken() === accessToken) {
          setProfile(data.profile || data);
        }
      })
      .catch(() => { if (isCurrent()) clearSession(); })
      .finally(() => { if (isCurrent()) setLoading(false); });
    return () => { cancelled = true; };
  }, [auth0Enabled, auth0.isAuthenticated, auth0.isLoading, auth0.getAccessTokenSilently]);

  function acceptSession(data) {
    // A late startup response must never replace a newer explicit sign-in.
    restoreGeneration.current += 1;
    restoreRequest.current?.abort();
    setRestoringSession(false);
    setSessionError(false);
    clearSession();
    setAccessToken(data.token);
    const nextProfile = data.profile || data.user || null;
    setProfile(nextProfile);
    return nextProfile;
  }

  async function login(email, password) {
    const { data } = await client.post('/auth/login', { email, password }, publicOAuthRequestConfig());
    return acceptSession(data);
  }

  async function register(name, email, password, title, phone) {
    const { data } = await client.post('/auth/register', { name, email, password, title, phone }, publicOAuthRequestConfig());
    return acceptSession(data);
  }

  async function verifyPhoneSignIn(verificationId, code, { signal } = {}) {
    const { data } = await client.post('/auth/phone/verify', { verificationId, code }, publicOAuthRequestConfig({ signal }));
    return acceptSession(data);
  }

  async function logout({ revoke = true } = {}) {
    restoreGeneration.current += 1;
    restoreRequest.current?.abort();
    setRestoringSession(false);
    setLoading(false);
    setSessionError(false);
    const activeToken = getAccessToken();
    const revocation = revoke && activeToken
      ? client.post('/auth/logout', {}, publicOAuthRequestConfig({ headers: { Authorization: `Bearer ${activeToken}` } }))
          .then(() => true).catch(() => false)
      : Promise.resolve(true);
    clearSession();
    const revoked = await revocation;
    if (auth0Enabled && auth0.isAuthenticated) {
      auth0.logout({ logoutParams: { returnTo: window.location.origin } });
    }
    return { revoked };
  }

  async function logoutAll() {
    await client.post('/auth/logout-all');
    return logout({ revoke: false });
  }

  function loginWithAuth0() {
    if (!auth0Enabled) return Promise.reject(new Error('Auth0 is not configured.'));
    return auth0.loginWithRedirect({ authorizationParams: auth0AuthorizationParams('login') });
  }

  function registerWithAuth0() {
    if (!auth0Enabled) return Promise.reject(new Error('Auth0 is not configured.'));
    return auth0.loginWithRedirect({ authorizationParams: auth0AuthorizationParams('signup') });
  }

  function updateProfileLocally(updated) {
    if (getAccessToken()) setProfile((prev) => ({ ...prev, ...updated }));
  }

  return (
    <AuthContext.Provider value={{
      token, profile, loading: loading || restoringSession || (auth0Enabled && auth0.isLoading),
      sessionError: sessionError && !token, retrySession, login, register, verifyPhoneSignIn, logout, logoutAll,
      updateProfileLocally, refreshProfile, auth0Enabled, loginWithAuth0, registerWithAuth0,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
