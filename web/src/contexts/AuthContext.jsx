import { createContext, useContext, useState, useEffect } from 'react';
import client from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token,   setToken]   = useState(() => localStorage.getItem('pc_token'));
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Re-hydrate profile on mount / token change
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    client.get('/profile')
      .then(({ data }) => setProfile(data))
      .catch(() => { localStorage.removeItem('pc_token'); setToken(null); })
      .finally(() => setLoading(false));
  }, [token]);

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
  }

  function updateProfileLocally(updated) {
    setProfile((prev) => ({ ...prev, ...updated }));
  }

  return (
    <AuthContext.Provider value={{ token, profile, loading, login, register, logout, updateProfileLocally }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
