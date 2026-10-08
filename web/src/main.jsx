import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Auth0Provider } from '@auth0/auth0-react';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { SavedItemsProvider } from './contexts/SavedItemsContext';
import { VaultConnectionProvider } from './contexts/VaultConnectionContext';
import { auth0AuthorizationParams, auth0Config, isAuth0Configured } from './auth/auth0Config';
import './index.css';
import { reportClientError } from './api/errorReporting';
import AppRecoveryBoundary from './components/AppRecoveryBoundary';

// Optional diagnostics report a broad category only after this browser opts
// in. Error messages, rejected values and stack traces are never submitted.
window.addEventListener('error', () => {
  reportClientError({ code: 'script_error' });
});
window.addEventListener('unhandledrejection', () => {
  reportClientError({ code: 'unhandled_rejection' });
});

// Clicking a push notification (see sw.js's notificationclick handler)
// focuses an already-open tab rather than opening a new one, but can't
// change that tab's URL itself — a full navigation here, not a React
// Router push, since this runs outside the router/component tree entirely
// (this file loads before the app even mounts). A page load on a rare,
// deliberate click is an acceptable tradeoff for not having to thread a
// navigate function out to a module-level listener.
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'notification-click' && e.data.url) {
    try {
      const target = new URL(e.data.url, window.location.origin);
      if (target.origin === window.location.origin && /^https?:$/.test(target.protocol)) window.location.href = target.href;
    } catch { /* Ignore malformed notification links. */ }
  }
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
} else if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  }).catch(() => {});
}

function OptionalAuth0Provider({ children }) {
  if (!isAuth0Configured) return children;
  return (
    <Auth0Provider
      domain={auth0Config.domain}
      clientId={auth0Config.clientId}
      authorizationParams={auth0AuthorizationParams()}
      cacheLocation="memory"
      useRefreshTokens
    >
      {children}
    </Auth0Provider>
  );
}

// React 19 owns route metadata after boot. Remove only the build's marked
// copies, preserving CSP, icons, verification tags, and structured data.
document.querySelectorAll('[data-prerender-meta]').forEach(node => node.remove());
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppRecoveryBoundary>
    <HelmetProvider>
      <OptionalAuth0Provider>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AuthProvider>
            <VaultConnectionProvider>
            <SavedItemsProvider>
              <ToastProvider>
                <App />
              </ToastProvider>
            </SavedItemsProvider>
            </VaultConnectionProvider>
          </AuthProvider>
        </BrowserRouter>
      </OptionalAuth0Provider>
    </HelmetProvider>
    </AppRecoveryBoundary>
  </React.StrictMode>
);
