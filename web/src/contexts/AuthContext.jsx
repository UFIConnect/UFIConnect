import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import client from '../api/client';
import { auth0AuthorizationParams, isAuth0Configured } from '../auth/auth0Config';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token,   setToken]   = useState(() => localStorage.getItem('pc_token'));
  const [profile, setProfile] = useState(null);
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
        if (data?.error || !data?.id) {
          localStorage.removeItem('pc_token');
          setToken(null);
        } else {
          setProfile(data);
        }
      })
      .catch(() => { localStorage.removeItem('pc_token'); setToken(null); })
      .finally(() => setLoading(false));
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
          if (!cancelled) setProfile(data.profile || data);
        } catch {
          if (!cancelled) {
            localStorage.removeItem('pc_token');
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
    setToken(data.token);
    setProfile(data.profile || data.user || null);
    return data.profile || data.user;
  }

  async function register(name, email, password, title) {
    const { data } = await client.post('/auth/register', { name, email, password, title });
    localStorage.setItem('pc_token', data.token);
    setToken(data.token);
    setProfile(data.profile || data.user || null);
    return data.profile || data.user;
  }

  function logout() {
    localStorage.removeItem('pc_token');
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
    setProfile((prev) => ({ ...prev, ...updated }));
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
