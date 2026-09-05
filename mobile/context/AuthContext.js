import React, { createContext, useContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import Constants from 'expo-constants';

// In development this falls back to localhost.
// In production EAS builds, set the API_URL secret:
//   eas secret:create --scope project --name API_URL --value https://api.yourserver.com
export const API_BASE =
  Constants.expoConfig?.extra?.apiUrl ?? 'http://localhost:3000';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('token');
        if (stored) {
          setToken(stored);
          const res = await axios.get(`${API_BASE}/profile`, {
            headers: { Authorization: `Bearer ${stored}` },
          });
          setProfile(res.data.profile || res.data);
        }
      } catch (error) {
        if ([401, 403].includes(error?.response?.status)) {
          await AsyncStorage.removeItem('token');
          setToken(null);
          setProfile(null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function login(email, password) {
    const res = await axios.post(`${API_BASE}/auth/login`, { email, password });
    await AsyncStorage.setItem('token', res.data.token);
    setToken(res.data.token);
    setProfile(res.data.profile);
    return res.data;
  }

  async function register(name, email, password, title, phone) {
    const res = await axios.post(`${API_BASE}/auth/register`, { name, email, password, title, phone });
    await AsyncStorage.setItem('token', res.data.token);
    setToken(res.data.token);
    setProfile(res.data.profile);
    return res.data;
  }

  async function logout() {
    await AsyncStorage.removeItem('token');
    setToken(null);
    setProfile(null);
  }

  function updateProfileLocally(updated) {
    setProfile(updated);
  }

  const onboardingComplete = profile?.onboardingComplete ?? true;

  return (
    <AuthContext.Provider value={{
      token, profile, loading,
      onboardingComplete,
      login, register, logout, updateProfileLocally,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
