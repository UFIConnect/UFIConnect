import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // On GitHub Pages the app lives at /UFConnect/; locally it's at /
  base: process.env.GH_PAGES === 'true' ? '/UFConnect/' : '/',
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
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // The array form (name: [package, ...]) silently failed to actually
        // isolate react/react-dom — confirmed in the built output:
        // vendor-react-*.js was a 37-byte stub re-exporting vendor-router,
        // while index.js (255KB) had react's real code (createRoot,
        // useState, etc.) bundled straight into it. Matching by resolved
        // module path instead reliably catches every module in each
        // package's dependency graph (including transitive ones like
        // scheduler, which react-dom depends on but the array form's exact
        // package-name matching never accounted for).
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-router')) return 'vendor-router';
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
        },
      },
    },
  },
});
