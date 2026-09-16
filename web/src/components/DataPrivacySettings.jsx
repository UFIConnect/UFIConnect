import { useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { getGoogleAnalytics } from '../analytics/browserAnalytics';
import { setDataPreferences, useDataPreferences, subscribeDataPreferences, getDataPreferencesPersistenceError } from '../preferences';
import './DataPrivacySettings.css';

function PreferenceSwitch({ label, description, checked, onChange, disabled = false }) {
  return <div className="data-preference-row">
    <div><h3>{label}</h3><p>{description}</p></div>
    <button type="button" className="data-preference-switch" role="switch" aria-label={label}
      aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
      <span aria-hidden="true" />
    </button>
  </div>;
}

export default function DataPrivacySettings() {
  const preferences = useDataPreferences();
  const persistenceError = useSyncExternalStore(subscribeDataPreferences, getDataPreferencesPersistenceError, () => null);
  const analytics = getGoogleAnalytics();
  const consent = useSyncExternalStore(analytics.subscribe, analytics.getConsent, () => null);
  const analyticsPersistenceError = useSyncExternalStore(analytics.subscribe, analytics.getPersistenceError || (() => null), () => null);
  return <div className="data-privacy-settings">
    <section className="card" aria-labelledby="data-usage-title">
      <h2 id="data-usage-title">Data use and playback</h2>
      <p className="data-preference-intro">Changes apply immediately in this browser. Your device controls cellular data and roaming.</p>
      {persistenceError && <p className="auth-error" role="status">{persistenceError}</p>}
      <PreferenceSwitch label="Data saver for feed previews" checked={preferences.dataSaver}
        onChange={dataSaver => setDataPreferences({ dataSaver })}
        description="Pause automatic inline feed videos and defer their video downloads until you choose to play. Poster images can still load." />
      <PreferenceSwitch label="Autoplay feed previews" checked={preferences.autoplayPreviews && !preferences.dataSaver}
        disabled={preferences.dataSaver} onChange={autoplayPreviews => setDataPreferences({ autoplayPreviews })}
        description={preferences.dataSaver ? 'Paused while data saver is on. Your autoplay preference returns when you turn data saver off.' : 'Play visible inline feed video previews automatically. Turn off to start each preview yourself.'} />
      <p className="data-preference-note">These controls apply to feed previews. Videos and Music pages, and videos you open yourself, keep their playback controls.</p>
    </section>

    <section className="card" aria-labelledby="data-insights-title">
      <h2 id="data-insights-title">Service metrics and insights</h2>
      <div className="data-preference-row">
        <div><h3>Core service metrics and aggregate usage counts</h3>
          <p>Always active: totals for availability, request outcomes and page categories help us operate UFIconnect. These metrics do not attach account IDs, visitor IDs, messages or full page links. Hosting still receives network information when connecting.</p></div>
        <span className="data-preference-required">Always active</span>
      </div>
      <PreferenceSwitch label="Optional performance diagnostics" checked={preferences.performanceInsights}
        onChange={performanceInsights => setDataPreferences({ performanceInsights })}
        description="Share broad categories of page and video failures. Off by default. We exclude error text, stack traces, account identifiers and full page links." />
      <PreferenceSwitch label="Optional Google Analytics" checked={consent === 'granted'} disabled={!analytics.available}
        onChange={enabled => analytics.setConsent(enabled ? 'granted' : 'denied')}
        description={analytics.available ? 'Share page categories and basic device information with Google. Google receives your IP address when connecting. Turning this off stops new collection and clears this browser’s analytics identifier.' : 'Google Analytics is unavailable in this deployment.'} />
      {analyticsPersistenceError && <p className="auth-error" role="status">{analyticsPersistenceError}</p>}
      <p className="data-preference-note">Actions such as saving posts, managing reading history and personalizing your feed still use the information needed to perform those features. <Link to="/privacy">Read the privacy policy</Link>.</p>
    </section>
  </div>;
}
