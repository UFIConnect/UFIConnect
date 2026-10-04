import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getGoogleAnalytics } from '../analytics/browserAnalytics';
import { getGoogleAds } from '../analytics/browserAds';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from 'react-router-dom';
import './AnalyticsPrivacy.css';

export default function AnalyticsPrivacy() {
  const location = useLocation();
  const analytics = getGoogleAnalytics();
  const ads = getGoogleAds();
  const { token, loading, sessionError } = useAuth();
  const consent = useSyncExternalStore(analytics.subscribe, analytics.getConsent, () => null);
  const privacySignal = useSyncExternalStore(analytics.subscribe, analytics.getPrivacySignal || (() => false), () => false);
  const persistenceError = useSyncExternalStore(analytics.subscribe, analytics.getPersistenceError || (() => null), () => null);
  const adsConsent = useSyncExternalStore(ads.subscribe, ads.getConsent, () => null);
  const adsPrivacySignal = useSyncExternalStore(ads.subscribe, ads.getPrivacySignal, () => false);
  const adsPersistenceError = useSyncExternalStore(ads.subscribe, ads.getPersistenceError, () => null);
  const [allowAds, setAllowAds] = useState(adsConsent === 'granted');
  const [open, setOpen] = useState(false);
  const opener = useRef(null);
  const heading = useRef(null);
  const guestHomepage = location.pathname === '/' && !loading && !token && !sessionError;
  const adsPrompt = ads.available && guestHomepage && adsConsent === null;
  const adsOnly = Boolean(consent && adsPrompt && !open);
  const showAds = ads.available && (guestHomepage || open);
  const visible = (analytics.available && !consent) || open || adsPrompt;
  const signal = privacySignal || adsPrivacySignal;
  useEffect(() => { setAllowAds(adsConsent === 'granted'); }, [adsConsent]);
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
    if (showAds) ads.setConsent(allowAds ? 'granted' : 'denied');
    const failed = Boolean(analytics.getPersistenceError?.() || (showAds && ads.getPersistenceError()));
    setOpen(failed);
    if (!failed) restoreFocus();
  }
  function chooseAds(value) {
    ads.setConsent(value);
    const failed = Boolean(ads.getPersistenceError());
    setOpen(failed);
    if (!failed) restoreFocus();
  }
  if ((!analytics.available && !ads.available) || (!visible && !persistenceError && !adsPersistenceError)) return null;
  return <div className="analytics-privacy">
    {visible && <section className="analytics-privacy-panel" aria-labelledby="analytics-privacy-title"
      onKeyDown={event => { if (event.key === 'Escape' && consent) { setOpen(false); restoreFocus(); } }}>
      <h2 id="analytics-privacy-title" ref={heading} tabIndex={-1}>{adsOnly ? 'Your ad measurement choice' : 'Your analytics choices'}</h2>
      {!adsOnly && <>
        <p>Core service metrics exclude account and visitor identifiers. Your Vault is excluded from page analytics and optional diagnostics.</p>
        <p>Allow optional Google Analytics to measure page categories and basic device information? Google receives your IP address when connecting. We exclude passwords, messages, account details and full page links.</p>
      </>}
      {showAds && <div className="analytics-privacy-ads">
        {adsOnly ? <p><strong>Optional Google Ads measurement</strong></p> : <label className="analytics-privacy-option">
          <input type="checkbox" checked={allowAds && !signal} disabled={signal} onChange={event => setAllowAds(event.target.checked)} />
          <span>Allow Google Ads measurement (optional)</span>
        </label>}
        <p>Help us measure visits from our ads to the homepage. Only the guest homepage uses this tag. Google receives your IP address, browser/device information and ad click identifiers, and uses cookies to connect ad clicks to homepage visits. Ad personalization stays off.</p>
        {!adsOnly && <p className="analytics-privacy-hint">Your Ads checkbox choice is saved with either button below. Accepting analytics alone does not enable Ads measurement.</p>}
      </div>}
      <p>You can decline and change your choice here anytime. <a href={`${import.meta.env.BASE_URL}privacy`}>Privacy policy</a></p>
      {consent && !adsOnly && <p className="analytics-privacy-status" role="status">Analytics is {consent === 'granted' ? 'on' : 'off'} for this browser.</p>}
      {showAds && adsConsent && <p className="analytics-privacy-status" role="status">Ad measurement is {adsConsent === 'granted' ? 'on' : 'off'} for this browser.</p>}
      {signal && <p role="status">Global Privacy Control is enabled in your browser. Optional analytics and ad measurement stay off while this signal is enabled.</p>}
      {persistenceError && <p className="auth-error" role="status">{persistenceError}</p>}
      {adsPersistenceError && <p className="auth-error" role="status">{adsPersistenceError}</p>}
      <div className="analytics-privacy-actions">
        {adsOnly ? <>
          <button type="button" disabled={signal} onClick={() => chooseAds('granted')}>Allow ad measurement</button>
          <button type="button" onClick={() => chooseAds('denied')}>Keep ad measurement off</button>
        </> : <>
          <button type="button" disabled={privacySignal || !analytics.available} onClick={() => choose('granted')}>Accept analytics</button>
          <button type="button" onClick={() => choose('denied')}>Decline analytics</button>
        </>}
      </div>
      {consent && open && <button type="button" className="analytics-privacy-close" onClick={() => { setOpen(false); restoreFocus(); }}>Close preferences</button>}
    </section>}
    {!visible && persistenceError && <p className="auth-error" role="status">{persistenceError}</p>}
    {!visible && adsPersistenceError && <p className="auth-error" role="status">{adsPersistenceError}</p>}
  </div>;
}
