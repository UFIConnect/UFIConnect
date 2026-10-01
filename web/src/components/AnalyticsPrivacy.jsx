import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getGoogleAnalytics } from '../analytics/browserAnalytics';
import { useLocation } from 'react-router-dom';
import './AnalyticsPrivacy.css';

export default function AnalyticsPrivacy() {
  const location = useLocation();
  const analytics = getGoogleAnalytics();
  const consent = useSyncExternalStore(analytics.subscribe, analytics.getConsent, () => null);
  const privacySignal = useSyncExternalStore(analytics.subscribe, analytics.getPrivacySignal || (() => false), () => false);
  const persistenceError = useSyncExternalStore(analytics.subscribe, analytics.getPersistenceError || (() => null), () => null);
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  const heading = useRef(null);
  const visible = !consent || open;
  // Preferences open from "Analytics privacy" links (any page's #analytics), not a
  // button on every page. Closing returns focus to whatever opened them, if it remains.
  const restoreFocus = () => requestAnimationFrame(() => {
    const target = opener.current;
    opener.current = null;
    if (target?.isConnected && target.getClientRects().length) target.focus({ preventScroll: true });
  });
  useEffect(() => {
    if (location.hash !== '#analytics') return;
    if (document.activeElement !== document.body) opener.current = document.activeElement;
    setOpen(true);
  }, [location.pathname, location.hash, location.key]);
  useEffect(() => { if (open) heading.current?.focus({ preventScroll: true }); }, [open]);
  function choose(value) {
    analytics.setConsent(value);
    const failed = Boolean(analytics.getPersistenceError?.());
    setOpen(failed);
    if (!failed) restoreFocus();
  }
  if (!analytics.available || (!visible && !persistenceError)) return null;
  return <div className="analytics-privacy">
    {visible && <section className="analytics-privacy-panel" aria-labelledby="analytics-privacy-title"
      onKeyDown={event => { if (event.key === 'Escape' && consent) { setOpen(false); restoreFocus(); } }}>
      <h2 id="analytics-privacy-title" ref={heading} tabIndex={-1}>Your analytics choice</h2>
      <p>Core service metrics and aggregate page-category counts exclude account and visitor identifiers. Your Vault is excluded from page analytics and optional diagnostics. Google Analytics is optional.</p>
      <p>Allow Google Analytics to measure page categories and basic device information? Google receives your IP address when connecting. We exclude passwords, messages, account details and full page links.</p>
      <p>You can decline and change your choice here anytime. <a href={`${import.meta.env.BASE_URL}privacy`}>Privacy policy</a></p>
      {consent && <p className="analytics-privacy-status" role="status">Analytics is {consent === 'granted' ? 'on' : 'off'} for this browser.</p>}
      {privacySignal && <p role="status">Global Privacy Control is enabled in your browser. Optional analytics stays off while this signal is enabled.</p>}
      {persistenceError && <p className="auth-error" role="status">{persistenceError}</p>}
      <div className="analytics-privacy-actions">
        <button type="button" disabled={privacySignal} onClick={() => choose('granted')}>Accept analytics</button>
        <button type="button" onClick={() => choose('denied')}>Decline analytics</button>
      </div>
      {consent && <button type="button" className="analytics-privacy-close" onClick={() => { setOpen(false); restoreFocus(); }}>Close preferences</button>}
    </section>}
    {!visible && persistenceError && <p className="auth-error" role="status">{persistenceError}</p>}
  </div>;
}
