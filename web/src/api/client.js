import axios from 'axios';

// In dev: Vite proxy rewrites /api/* → http://localhost:3000/*
// In production: VITE_API_URL points directly to the backend (no /api prefix needed)
// Hardcoded fallback ensures production always hits the right API even if env var is missing
const baseURL = import.meta.env.VITE_API_URL
  || 'https://uficonnect-api.onrender.com';

const client = axios.create({ baseURL });

// Attach JWT token from localStorage on every request
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('pc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default client;
