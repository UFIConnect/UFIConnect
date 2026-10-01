import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const releaseLocal = mode === 'release-local';
  return {
    plugins: [react()],
    resolve: { dedupe: ['react', 'react-dom', 'three'] },
    server: {
      port: releaseLocal ? 4174 : 5174,
      host: releaseLocal ? '127.0.0.1' : undefined,
      strictPort: releaseLocal,
      proxy: releaseLocal ? {
        '/api': {
          target: 'https://api.uficonnect.org',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/api/, ''),
        },
        '/pipeline': {
          target: 'https://uficonnect-pipeline-708r.onrender.com',
          changeOrigin: true,
          rewrite: path => path.replace(/^\/pipeline/, ''),
        },
      } : {
        '/office': { target: 'http://localhost:3000', changeOrigin: true },
        '/hq':     { target: 'http://localhost:3000', changeOrigin: true },
        '/health': { target: 'http://localhost:3000', changeOrigin: true },
      },
    },
  };
});
