import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // On GitHub Pages the app lives at /proconnect/; locally it's at /
  base: process.env.GH_PAGES === 'true' ? '/proconnect/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // In dev, forward /api/* → backend at :3000 (strips /api prefix)
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
