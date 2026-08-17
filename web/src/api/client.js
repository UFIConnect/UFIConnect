import axios from 'axios';

// In dev: Vite proxy rewrites /api/* → http://localhost:3000/*
// In production: VITE_API_URL points directly to the backend (no /api prefix needed)
const baseURL = import.meta.env.VITE_API_URL || '/api';

const client = axios.create({ baseURL, timeout: 30000 });

// Attach JWT token from localStorage on every request
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('pc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Render briefly returns 502/503/504 during a deploy cutover or a cold
// start — genuinely transient, not a real failure — but with nothing
// retrying it, a user who happens to load a page in that exact window sees
// a broken screen instead of what would have resolved itself half a second
// later. Retried once, GET-only (safe to repeat — no side effects), after a
// short delay to actually let the blip clear instead of hammering it
// immediately.
client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { config, response } = error;
    if (config && !config._retried && config.method === 'get' && response && [502, 503, 504].includes(response.status)) {
      config._retried = true;
      await new Promise(resolve => setTimeout(resolve, 900));
      return client(config);
    }
    return Promise.reject(error);
  }
);

export default client;
