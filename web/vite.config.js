import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { browserSecurityPolicy } from './securityPolicy.mjs';

export default defineConfig({
  // On GitHub Pages the app lives at /UFIConnect/; locally it's at /
  base: process.env.GH_PAGES === 'true' ? '/UFIConnect/' : '/',
  plugins: [react(), {
    name: 'production-browser-security',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Render also sends an HTTP CSP. The meta policy protects executable
        // content on static hosts such as GitHub Pages that cannot set headers.
        return { html, tags: [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy',
          content: browserSecurityPolicy(html, { meta: true }) }, injectTo: 'head-prepend' }] };
      },
    },
  }],
  server: {
    port: 5173,
    // Applies before Vite's injected client module can request a reset URL
    // as its referrer. Production hosts must send the same policy.
    headers: { 'Referrer-Policy': 'no-referrer' },
    proxy: {
      // In dev, forward /api/* → backend at :3000 (strips /api prefix)
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: { headers: { 'Referrer-Policy': 'no-referrer' } },
  build: {
    outDir: 'dist',
    manifest: true,
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
