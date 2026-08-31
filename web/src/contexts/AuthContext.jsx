import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import client from '../api/client';
import { auth0AuthorizationParams, isAuth0Configured } from '../auth/auth0Config';

const AuthContext = createContext(null);
const AUTH_SESSION_KEY = 'ufi_authenticated_session_id';
const PROFILE_CACHE_KEY = 'ufi_profile_snapshot';

function readCachedProfile() {
  try {
    const token = localStorage.getItem('pc_token');
    const cached = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || 'null');
    return cached?.token === token && cached?.profile?.id ? cached.profile : null;
  } catch {
    return null;
  }
}

function cacheProfile(profile, token = localStorage.getItem('pc_token')) {
  try {
    if (profile?.id && token) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ token, profile }));
  } catch {}
}

function clearCachedProfile() {
  try { localStorage.removeItem(PROFILE_CACHE_KEY); } catch {}
}

function isRejectedSession(error) {
  return [401, 403].includes(error?.response?.status);
}

function getAuthenticatedSessionId() {
  try {
    let id = sessionStorage.getItem(AUTH_SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(AUTH_SESSION_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token,   setToken]   = useState(() => localStorage.getItem('pc_token'));
  const [profile, setProfile] = useState(() => readCachedProfile());
  const [loading, setLoading] = useState(true);
  const auth0 = useAuth0();
  const auth0Enabled = isAuth0Configured;

  const hydrateLocalProfile = useCallback(() => {
    if (!token) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    client.get('/profile')
      .then(({ data }) => {
        // Guard against stale service-worker offline responses that look like { error: 'offline' }
        if (!data?.error && data?.id) {
          setProfile(data);
          cacheProfile(data, token);
        }
      })
      .catch((error) => {
        // A DNS/edge timeout is not an invalid session. Retaining the token
        // and last known profile lets the feed's own cache stay usable until
        // its API fallback reconnects.
        if (!isRejectedSession(error)) return;
        localStorage.removeItem('pc_token');
        clearCachedProfile();
        setToken(null);
        setProfile(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const refreshProfile = useCallback(async () => {
    if (!token) {
      setProfile(null);
      return null;
    }
    const { data } = await client.get('/profile');
    if (data?.error || !data?.id) throw new Error('Profile unavailable');
    setProfile(data);
    cacheProfile(data, token);
    return data;
  }, [token]);

  // Re-hydrate profile on mount / token change. Auth0 is optional: if it is not
  // configured, the original local JWT flow remains the only active path.
  useEffect(() => {
    let cancelled = false;
    async function hydrateAuth0Profile() {
      if (auth0Enabled && auth0.isLoading) {
        setLoading(true);
        return;
      }

      if (auth0Enabled && auth0.isAuthenticated) {
        setLoading(true);
        try {
          const accessToken = await auth0.getAccessTokenSilently({
            authorizationParams: auth0AuthorizationParams(),
          });
          if (cancelled) return;
          localStorage.setItem('pc_token', accessToken);
          setToken(accessToken);
          const { data } = await client.get('/auth/me');
          client.post('/analytics/sign-in', { sessionId: getAuthenticatedSessionId() }).catch(() => {});
          if (!cancelled) {
            const nextProfile = data.profile || data;
            setProfile(nextProfile);
            cacheProfile(nextProfile, accessToken);
          }
        } catch (error) {
          if (!cancelled && isRejectedSession(error)) {
            localStorage.removeItem('pc_token');
            clearCachedProfile();
            setToken(null);
            setProfile(null);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      hydrateLocalProfile();
    }

    hydrateAuth0Profile();
    return () => { cancelled = true; };
  }, [auth0Enabled, auth0.isAuthenticated, auth0.isLoading, hydrateLocalProfile]);

  async function login(email, password) {
    const { data } = await client.post('/auth/login', { email, password });
    localStorage.setItem('pc_token', data.token);
    cacheProfile(data.profile || data.user || null, data.token);
    setToken(data.token);
    setProfile(data.profile || data.user || null);
    return data.profile || data.user;
  }

  async function register(name, email, password, title, phone) {
    const { data } = await client.post('/auth/register', { name, email, password, title, phone });
    localStorage.setItem('pc_token', data.token);
    cacheProfile(data.profile || data.user || null, data.token);
    setToken(data.token);
    setProfile(data.profile || data.user || null);
    return data.profile || data.user;
  }

  function logout() {
    localStorage.removeItem('pc_token');
    clearCachedProfile();
    setToken(null);
    setProfile(null);
    if (auth0Enabled && auth0.isAuthenticated) {
      auth0.logout({ logoutParams: { returnTo: window.location.origin } });
    }
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
    setProfile((prev) => {
      const next = { ...prev, ...updated };
      cacheProfile(next);
      return next;
    });
  }

  return (
    <AuthContext.Provider value={{
      token,
      profile,
      loading,
      login,
      register,
      logout,
      updateProfileLocally,
      refreshProfile,
      auth0Enabled,
      loginWithAuth0,
      registerWithAuth0,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
