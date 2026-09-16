import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getGoogleAnalytics } from '../analytics/browserAnalytics';
import { useLocation } from 'react-router-dom';
import './AnalyticsPrivacy.css';

export default function AnalyticsPrivacy() {
  const location = useLocation();
  const analytics = getGoogleAnalytics();
  const consent = useSyncExternalStore(analytics.subscribe, analytics.getConsent, () => null);
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const heading = useRef(null);
  const visible = !consent || open;
  const restoreTriggerFocus = () => requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  useEffect(() => {
    if (location.pathname === '/privacy' && location.hash === '#analytics') setOpen(true);
  }, [location.pathname, location.hash, location.key]);
  useEffect(() => { if (open) heading.current?.focus({ preventScroll: true }); }, [open]);
  function choose(value) {
    analytics.setConsent(value);
    setOpen(false);
    restoreTriggerFocus();
  }
  if (!analytics.available) return null;
  return <div className={`analytics-privacy${visible ? ' analytics-privacy--open' : ''}`}>
    {visible && <section className="analytics-privacy-panel" aria-labelledby="analytics-privacy-title"
      onKeyDown={event => { if (event.key === 'Escape' && consent) { setOpen(false); restoreTriggerFocus(); } }}>
      <h2 id="analytics-privacy-title" ref={heading} tabIndex={-1}>Your analytics choice</h2>
      <p>Allow Google Analytics to measure page categories and basic device information? Google receives your IP address when connecting. We exclude passwords, messages, account details and full page links.</p>
      <p>You can decline and change your choice here anytime. <a href={`${import.meta.env.BASE_URL}privacy`}>Privacy policy</a></p>
      {consent && <p className="analytics-privacy-status" role="status">Analytics is {consent === 'granted' ? 'on' : 'off'} for this browser.</p>}
      <div className="analytics-privacy-actions">
        <button type="button" onClick={() => choose('granted')}>Accept analytics</button>
        <button type="button" onClick={() => choose('denied')}>Decline analytics</button>
      </div>
      {consent && <button type="button" className="analytics-privacy-close" onClick={() => { setOpen(false); restoreTriggerFocus(); }}>Close preferences</button>}
    </section>}
    <button type="button" ref={trigger} className="analytics-privacy-trigger" onClick={() => setOpen(true)}>Analytics privacy</button>
  </div>;
}
