import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useRef } from 'react';
import client, { publicOAuthRequestConfig } from '../api/client';
import { auth0AuthorizationParams, auth0BackendAvailable, isAuth0Configured } from '../auth/auth0Config';
import { clearSession, clearSessionCaches, getAccessToken, setAccessToken, subscribeToSession } from '../auth/session';
import { isNativeRuntime, nativeLocationNavigator, persistNativeSession, startNativeProviderSignIn } from '../nativeRuntime.mjs';
import { clearDeviceFeedLocation, startDeviceFeedLocation } from '../utils/deviceFeedLocation.mjs';
import { clearRequiredFeedLocation } from '../utils/requiredFeedLocation.mjs';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(getAccessToken);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [restoringSession, setRestoringSession] = useState(true);
  const [sessionError, setSessionError] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [deviceLocationRevision, setDeviceLocationRevision] = useState(0);
  const deviceLocationTracker = useRef(null);
  const restoreGeneration = useRef(0);
  const restoreRequest = useRef(null);
  const auth0 = useAuth0();
  const auth0Enabled = isAuth0Configured && !isNativeRuntime();
  const [auth0Ready, setAuth0Ready] = useState(false);
  const [auth0Checking, setAuth0Checking] = useState(auth0Enabled);

  useEffect(() => {
    if (!auth0Enabled) return undefined;
    const controller = new AbortController();
    client.get('/auth/config', publicOAuthRequestConfig({ signal: controller.signal }))
      .then(({ data }) => { if (!controller.signal.aborted) setAuth0Ready(auth0BackendAvailable(data?.auth0)); })
      .catch(() => { if (!controller.signal.aborted) setAuth0Ready(false); })
      .finally(() => { if (!controller.signal.aborted) setAuth0Checking(false); });
    return () => controller.abort();
  }, [auth0Enabled]);

  useEffect(() => subscribeToSession((nextToken) => {
    clearRequiredFeedLocation();
    clearDeviceFeedLocation();
    setToken(nextToken);
    if (!nextToken) setProfile(null);
  }), []);

  useEffect(() => {
    if (!token || !profile?.id || !profile.onboardingComplete || (!window.isSecureContext && !isNativeRuntime())) return undefined;
    const tracker = startDeviceFeedLocation({ token, navigator: isNativeRuntime() ? nativeLocationNavigator() : navigator, document,
      allowAutomaticPrompt: isNativeRuntime(),
      onChange: () => setDeviceLocationRevision(value => value + 1) });
    deviceLocationTracker.current = tracker;
    return () => {
      deviceLocationTracker.current = null;
      tracker.stop();
    };
  }, [token, profile?.id, profile?.onboardingComplete]);

  const retryDeviceLocation = useCallback(() => deviceLocationTracker.current?.requestLocation() ?? Promise.resolve(false), []);

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
        if (isCurrent() && error?.response?.status !== 401) setSessionError(true);
      })
      .finally(() => { if (isCurrent()) setRestoringSession(false); });
    return () => {
      cancelled = true;
      controller.abort();
      if (restoreRequest.current === controller) restoreRequest.current = null;
    };
  }, [restoreAttempt]);

  function retrySession() {
    setSessionError(false);
    if (getAccessToken()) {
      setLoading(true);
      refreshProfile().catch(() => {}).finally(() => setLoading(false));
      return;
    }
    setRestoringSession(true);
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
    refreshProfile().catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token, refreshProfile, auth0Enabled, auth0.isLoading, restoringSession]);

  useEffect(() => {
    if (restoringSession || getAccessToken() || !auth0Enabled || !auth0Ready || auth0.isLoading || !auth0.isAuthenticated) return undefined;
    let cancelled = false;
    let providerToken;
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
        providerToken = accessToken;
        setAccessToken(accessToken);
        const { data } = await client.get('/auth/me');
        if (isCurrent() && getAccessToken() === accessToken) {
          setProfile(data.profile || data);
        }
      })
      .catch(() => { if (isCurrent() && providerToken && getAccessToken() === providerToken) void clearSession(); })
      .finally(() => { if (isCurrent()) setLoading(false); });
    return () => { cancelled = true; };
  }, [restoringSession, auth0Enabled, auth0Ready, auth0.isAuthenticated, auth0.isLoading, auth0.getAccessTokenSilently]);

  async function acceptSession(data) {
    if (!data?.token) throw new Error('Sign-in could not be confirmed. Please try again.');
    // A late startup response must never replace a newer explicit sign-in.
    const generation = ++restoreGeneration.current;
    restoreRequest.current?.abort();
    await persistNativeSession(data.token);
    if (generation !== restoreGeneration.current) throw new Error('The account session changed. Please try again.');
    setRestoringSession(false);
    setSessionError(false);
    // Do not emit a signed-out token between two valid sessions: the native
    // host must retain the newly accepted credential in secure storage.
    clearSessionCaches();
    setAccessToken(data.token);
    const nextProfile = data.profile || data.user || null;
    setProfile(nextProfile);
    return nextProfile;
  }

  async function login(email, password) {
    const { data } = await client.post('/auth/login', { email, password }, publicOAuthRequestConfig());
    return acceptSession(data);
  }

  async function register(name, email, password, title, phone, enrollment = {}) {
    const { accountType, organization, businessIndustryId } = enrollment;
    const { data } = await client.post('/auth/register', { name, email, password, title, phone, accountType, organization, businessIndustryId }, publicOAuthRequestConfig());
    return acceptSession(data);
  }

  async function verifyPhoneSignIn(verificationId, code, { signal } = {}) {
    const { data } = await client.post('/auth/phone/verify', { verificationId, code }, publicOAuthRequestConfig({ signal }));
    if (data.requiresSignup) return data;
    return acceptSession(data);
  }

  async function completePhoneSignup(registrationId, name, { signal } = {}) {
    const { data } = await client.post('/auth/phone/complete-signup', { registrationId, name }, publicOAuthRequestConfig({ signal }));
    return acceptSession(data);
  }

  async function signInWithNativeProvider(provider, mode) {
    const generation = restoreGeneration.current;
    const activeToken = getAccessToken();
    const data = await startNativeProviderSignIn(provider, mode);
    if (generation !== restoreGeneration.current || activeToken !== getAccessToken()) throw new Error('The account session changed. Please try again.');
    if (mode === 'link' && data?.linked && !data?.token) return refreshProfile();
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
    // Let native revocation authenticate before removing its secure token.
    const revoked = isNativeRuntime() ? await revocation : null;
    const locallyCleared = await clearSession();
    const confirmedRevoked = revoked ?? await revocation;
    if (auth0Enabled && auth0.isAuthenticated) {
      auth0.logout({ logoutParams: { returnTo: window.location.origin } });
    }
    return { revoked: confirmedRevoked, locallyCleared };
  }

  async function logoutAll() {
    await client.post('/auth/logout-all');
    return logout({ revoke: false });
  }

  async function confirmAuth0Availability() {
    if (!auth0Enabled || !auth0Ready) throw new Error('This sign-in method is not available yet.');
    try {
      const { data } = await client.get('/auth/config', publicOAuthRequestConfig());
      if (auth0BackendAvailable(data?.auth0)) return;
    } catch {
      setAuth0Ready(false);
      throw new Error('This sign-in method could not be verified. Please try again later.');
    }
    setAuth0Ready(false);
    throw new Error('This sign-in method is not available yet.');
  }

  async function loginWithAuth0() {
    await confirmAuth0Availability();
    return auth0.loginWithRedirect({ authorizationParams: auth0AuthorizationParams('login') });
  }

  async function registerWithAuth0() {
    await confirmAuth0Availability();
    return auth0.loginWithRedirect({ authorizationParams: auth0AuthorizationParams('signup') });
  }

  const updateProfileLocally = useCallback(updated => {
    if (getAccessToken()) setProfile(previous => ({ ...previous, ...(typeof updated === 'function' ? updated(previous) : updated) }));
  }, []);

  return (
    <AuthContext.Provider value={{
      token, profile, loading: loading || restoringSession || (auth0Enabled && auth0.isLoading),
      sessionError: sessionError && !token, retrySession, login, register, verifyPhoneSignIn, completePhoneSignup, signInWithNativeProvider, logout, logoutAll,
      updateProfileLocally, refreshProfile, auth0Enabled, auth0Ready, auth0Checking, loginWithAuth0, registerWithAuth0, deviceLocationRevision,
      retryDeviceLocation,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
