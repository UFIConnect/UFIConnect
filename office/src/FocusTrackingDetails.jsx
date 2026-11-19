import { downloadFocusFile, trackingProfile } from './focus-tracking.mjs';
import { diagnosticReport } from './focus-device-health.mjs';
import { useState } from 'react';

export default function FocusTrackingDetails({ tracking, preferences, devices, health }) {
  const [expanded, setExpanded] = useState(false);
  const details = tracking.diagnostics;
  if (!details) return null;
  return <details className="focus-advanced focus-tracking-details" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>Phone & tracking diagnostics</summary>
    {expanded && <div className="focus-advanced-body">
      <dl className="focus-ops-stats">
        <div><dt>Location permission</dt><dd>{details.permission === 'unknown' ? 'Not reported by browser' : details.permission}</dd></div>
        {['camera', 'microphone', 'notifications'].map(name => <div key={name}><dt>{name[0].toUpperCase() + name.slice(1)} permission</dt><dd>{details.permissions[name] === 'unknown' ? 'Not reported by browser' : details.permissions[name]}</dd></div>)}
        <div><dt>Page visibility</dt><dd>{tracking.visible ? 'Visible' : 'Hidden — GPS paused'}</dd></div>
        <div><dt>Device connection</dt><dd>{details.online ? 'Reports online' : 'Reports offline'}</dd></div>
        <div><dt>GPS source</dt><dd>Browser location service</dd></div>
        <div><dt>Last accepted GPS</dt><dd>{tracking.lastAcceptedAt ? new Date(tracking.lastAcceptedAt).toLocaleString() : 'No accepted reading'}</dd></div>
        {preferences && <div><dt>Accepted uncertainty</dt><dd>±{trackingProfile(preferences).maxAccuracy} m maximum</dd></div>}
        <div><dt>Rejected readings</dt><dd>{tracking.rejectedReadings ?? 0}</dd></div>
        <div><dt>Moving tracking mode</dt><dd>{tracking.continuous ? 'On · no time or distance stop limits' : 'Off · configured limits apply'}</dd></div>
        <div><dt>Screen wake lock</dt><dd>{details.awake ? 'Active' : details.keepAwake ? 'Requested; not active' : 'Off'}</dd></div>
        {devices && <>
          <div><dt>Sharing</dt><dd>{devices.sharing || 'Off'}</dd></div>
          <div><dt>Last Office response</dt><dd>{devices.connection?.status == null ? 'No response recorded' : `HTTP ${devices.connection.status}`}</dd></div>
          <div><dt>Last successful sync</dt><dd>{devices.connection?.successAt ? new Date(devices.connection.successAt).toLocaleString() : 'No successful sync'}</dd></div>
          <div><dt>Response time</dt><dd>{devices.connection?.latency == null ? 'Unavailable' : `${devices.connection.latency} ms`}</dd></div>
        </>}
      </dl>
      <p className="focus-footnote">Location is device-reported and approximate. GPS, Wi-Fi or cell positioning may be used by the browser; Office cannot identify the underlying provider. Screen lock or a hidden tab pauses browser tracking. Missing route sections stay disconnected.</p>
      {details.wakeSupported && <label className="focus-check"><input type="checkbox" checked={details.keepAwake}
        disabled={!tracking.active} onChange={event => details.setKeepAwake(event.target.checked)} />Keep screen awake while tracking</label>}
      {!details.wakeSupported && <p className="focus-footnote">Screen wake lock is unavailable in this browser.</p>}
      {details.wakeError && <p role="status" className="focus-footnote">{details.wakeError}</p>}
      <p className="focus-footnote">This session records only events observed by Office. It cannot inspect other apps, calls, messages, or identify a person from a phone number. A GPS or network error does not establish interference.</p>
      <button type="button" className="focus-button" onClick={() => downloadFocusFile(JSON.stringify(diagnosticReport(tracking, devices, health), null, 2),
        'office-diagnostics.json', 'application/json')}>Download diagnostic report</button>
      <p className="focus-footnote">The report includes observed status and error codes. Exact coordinates and authentication credentials are excluded.</p>
      <h4>Observed events · this session</h4>
      {details.events.length ? <>
        <ol className="focus-diagnostic-events" aria-label="Observed phone and tracking events">{details.events.map((event, index) => <li key={`${event.at}-${index}`}>
          <time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString()}</time>
          <code>{event.code}</code><span>{event.message}</span>
        </li>)}</ol>
        <button type="button" className="focus-button" onClick={details.clear}>Clear diagnostic history</button>
      </> : <p className="focus-footnote">No events recorded. Up to 30 recent events stay in memory until Office closes or reloads.</p>}
    </div>}
  </details>;
}
