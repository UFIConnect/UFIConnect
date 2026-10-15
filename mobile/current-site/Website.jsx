'use dom';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Auth0Provider } from '@auth0/auth0-react';
import App from '../../web/src/App';
import { AuthProvider } from '../../web/src/contexts/AuthContext';
import { ToastProvider } from '../../web/src/contexts/ToastContext';
import { SavedItemsProvider } from '../../web/src/contexts/SavedItemsContext';
import { VaultConnectionProvider } from '../../web/src/contexts/VaultConnectionContext';
import { auth0AuthorizationParams, auth0Config, isAuth0Configured } from '../../web/src/auth/auth0Config';
import AppRecoveryBoundary from '../../web/src/components/AppRecoveryBoundary';
import { configureNativeRuntime, installNativeBrowserAdapters } from '../../web/src/nativeRuntime.mjs';
import { observeNativeAppearance } from './nativeAppearance.cjs';
import AppWelcome from './AppWelcome';
import '../../web/src/index.css';
import '../../web/public/appearance.css';
import '../../web/public/appearance-init.js';
import './website.css';

function OptionalAuth0Provider({ native, children }) {
  if (native || !isAuth0Configured) return children;
  return <Auth0Provider domain={auth0Config.domain} clientId={auth0Config.clientId}
    authorizationParams={auth0AuthorizationParams()} cacheLocation="memory" useRefreshTokens>
    {children}
  </Auth0Provider>;
}

function NativeNavigation({ native }) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!native) return undefined;
    const onNavigate = event => {
      const target = event.detail?.path;
      if (typeof target !== 'string') return;
      if (target.startsWith('#')) {
        navigate({ pathname: location.pathname, search: location.search, hash: target });
      } else if (target.startsWith('/') && !target.startsWith('//')) navigate(target);
    };
    window.addEventListener('ufi-native-navigate', onNavigate);
    return () => window.removeEventListener('ufi-native-navigate', onNavigate);
  }, [native, navigate, location.pathname, location.search]);
  return null;
}

export default function Website(props) {
  const native = ['ios', 'android'].includes(props.nativePlatform);
  useLayoutEffect(() => {
    const element = document.documentElement;
    const previous = element.getAttribute('data-ufi-app');
    element.setAttribute('data-ufi-app', native ? props.nativePlatform : 'web');
    return () => {
      if (previous === null) element.removeAttribute('data-ufi-app');
      else element.setAttribute('data-ufi-app', previous);
    };
  }, [native, props.nativePlatform]);
  const latestProps = useRef(props);
  latestProps.current = props;
  const runtime = useMemo(() => {
    if (!native) return null;
    const value = { nativePlatform: props.nativePlatform, initialSession: props.initialSession };
    const capability = props.nativeCapability;
    // Keep this capability inside the DOM closure, never in URLs, storage,
    // events or rendered markup. Every native host action validates it.
    for (const name of ['onApiRequest', 'onPersistSession', 'onProviderSignIn', 'onOpenExternal',
      'onRequestLocation', 'onShareFile', 'onCopyText', 'onAppearanceChange', 'onYouTubePlayer', 'onTwitchPlayer']) {
      if (typeof props[name] === 'function') value[name] = (...args) => latestProps.current[name](capability, ...args);
    }
    return value;
  }, [native, props.nativePlatform, props.nativeCapability]);
  if (runtime) runtime.nativeAppActive = props.nativeAppActive !== false;
  configureNativeRuntime(runtime);
  const [actionError, setActionError] = useState('');
  const [adaptersReady, setAdaptersReady] = useState(!native);
  useEffect(() => {
    if (!native) return undefined;
    const onError = event => setActionError(event.detail?.message || 'This action could not complete. Please try again.');
    window.addEventListener('ufi-native-error', onError);
    const cleanup = installNativeBrowserAdapters();
    setAdaptersReady(true);
    return () => { cleanup(); window.removeEventListener('ufi-native-error', onError); };
  }, [native]);
  useEffect(() => {
    if (!native) return;
    // A native browser sheet can leave the actual WebView foregrounded.
    // Notify media listeners for both transitions after updating hidden state.
    if (props.nativeAppActive !== false) window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  }, [native, props.nativeAppActive]);
  useEffect(() => {
    if (!native) return;
    window.dispatchEvent(new CustomEvent('ufi-native-twitch-state', { detail: { active: props.nativeTwitchActive === true } }));
  }, [native, props.nativeTwitchActive]);
  useEffect(() => {
    if (!native || !runtime?.onAppearanceChange) return undefined;
    return observeNativeAppearance({ document, window, onChange: runtime.onAppearanceChange });
  }, [native, runtime]);
  if (!adaptersReady) return <div role="status" aria-live="polite">Opening UFI Connect…</div>;
  const Router = native ? MemoryRouter : BrowserRouter;
  return <AppRecoveryBoundary><HelmetProvider><OptionalAuth0Provider native={native}>
    <Router><NativeNavigation native={native} /><AuthProvider><VaultConnectionProvider><SavedItemsProvider><ToastProvider>
      {actionError && <div className="native-action-error" role="alert">
        <span>{actionError}</span><button type="button" onClick={() => setActionError('')}>Dismiss</button>
      </div>}
      <App guestHome={<AppWelcome />} />
    </ToastProvider></SavedItemsProvider></VaultConnectionProvider></AuthProvider></Router>
  </OptionalAuth0Provider></HelmetProvider></AppRecoveryBoundary>;
}
