import FocusTrackingDetails from './FocusTrackingDetails';
import { locationSpeed } from './focus-tracking.mjs';

const allOptions = enabled => Object.fromEntries(['network', 'battery', 'performance', 'storage', 'errors'].map(key => [key, enabled]));
const bytes = value => `${(value / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;

export function DeviceHealthOptions({ health }) {
  const { options, setOptions, connection, battery, stalls } = health;
  return <>
    <div className="focus-actions">
      <button type="button" className="focus-button" onClick={() => setOptions(allOptions(true))}>Enable all available diagnostics</button>
      <button type="button" className="focus-button" onClick={() => setOptions(allOptions(false))}>Stop optional diagnostics</button>
      <button type="button" className="focus-button" disabled={!health.sampling} onClick={health.refresh}>Refresh diagnostic readings</button>
      <button type="button" className="focus-button" disabled={!health.probeSupported || !health.sampling || health.probeResult?.state === 'Checking'}
        onClick={health.testConnection}>Test Office connection</button>
    </div>
    <div className="focus-device-options">
      {[
        ['network', 'Browser network estimates', health.networkSupported],
        ['battery', 'Device battery report', health.batterySupported],
        ['performance', 'Office page performance', true],
        ['storage', 'Site storage estimate', health.storageSupported],
        ['errors', 'Office page error counts', true],
      ].map(([id, label, supported]) => <label key={id} className="focus-check"><input type="checkbox"
        checked={options[id]} disabled={!supported} onChange={event => setOptions(current => ({ ...current, [id]: event.target.checked }))} />
        {label}{!supported && ' · unavailable in this browser'}</label>)}
    </div>
    <p className="focus-footnote">{health.sampling ? 'Observing this visible Office session.' : 'Observation paused while Office is hidden.'} Choices are saved on this device.</p>
    {health.optionsError && <p className="focus-error" role="status">{health.optionsError}</p>}
    <dl className="focus-ops-stats">
      <div><dt>Connection test</dt><dd>{health.probeResult ? `${health.probeResult.state}${health.probeResult.status ? ` · HTTP ${health.probeResult.status}` : ''}${health.probeResult.latency != null ? ` · ${health.probeResult.latency} ms` : ''}` : health.probeSupported ? 'Not tested' : 'Office connection unavailable'}</dd></div>
      <div><dt>Connection estimate</dt><dd>{options.network && connection ? connection.type : 'Unavailable or disabled'}</dd></div>
      <div><dt>Estimated network RTT</dt><dd>{options.network && connection?.rtt != null ? `${connection.rtt} ms` : 'Unavailable'}</dd></div>
      <div><dt>Estimated downlink</dt><dd>{options.network && connection?.downlink != null ? `${connection.downlink} Mbps` : 'Unavailable'}</dd></div>
      <div><dt>Data saver</dt><dd>{options.network && connection ? connection.saveData ? 'Reported on' : 'Reported off' : 'Unavailable'}</dd></div>
      <div><dt>Device battery</dt><dd>{options.battery && battery ? `${battery.percent}% · ${battery.charging ? 'Charging' : 'Not charging'}` : 'Unavailable or disabled'}</dd></div>
      <div><dt>Office page stalls ≥50 ms</dt><dd>{options.performance && health.performanceSupported ? `${stalls.count} observed · longest ${Math.round(stalls.worstMs)} ms` : 'Unavailable or disabled'}</dd></div>
      <div><dt>Page timer delays ≥50 ms</dt><dd>{options.performance ? `${health.loop.delayed} observed · longest ${health.loop.worstMs} ms` : 'Disabled'}</dd></div>
      <div><dt>Site storage estimate</dt><dd>{options.storage && health.storage ? `${bytes(health.storage.usage)} / ${bytes(health.storage.quota)} · ${health.storage.percent}%` : 'Unavailable or disabled'}</dd></div>
      <div><dt>Storage persistence</dt><dd>{options.storage && health.storage ? health.storage.persisted === null ? 'Not reported' : health.storage.persisted ? 'Granted' : 'Not granted' : 'Unavailable or disabled'}</dd></div>
      <div><dt>Observed page errors</dt><dd>{options.errors ? `${health.errors.script} script · ${health.errors.promise} unhandled promise` : 'Disabled'}</dd></div>
    </dl>
    {health.probeResult && <p className="focus-footnote">Connection tested at {new Date(health.probeResult.at).toLocaleTimeString()}. This is one authenticated read request; it does not enable location sharing. No response means the cause is unknown.</p>}
    <p className="focus-footnote">Network estimates come from the browser, not an Office speed test. Page stalls describe this browser page, not whole-computer CPU usage or activity in other apps. Battery data refers to this device, not a vehicle.</p>
    <p className="focus-footnote">Timer delays measure page responsiveness and can reflect browser scheduling. Storage is an approximate allowance for this site's data, not the device's free disk space. Error monitoring keeps counts only, with no messages or stacks.</p>
    {health.batteryError && <p className="focus-footnote">{health.batteryError}</p>}
    {health.performanceError && <p className="focus-footnote">{health.performanceError}</p>}
    {health.storageError && <p className="focus-footnote">{health.storageError}</p>}
    {(stalls.count > 0 || health.loop.delayed > 0) && <button type="button" className="focus-button" onClick={health.clearStalls}>Reset page performance counters</button>}
    {(health.errors.script > 0 || health.errors.promise > 0) && <button type="button" className="focus-button" onClick={health.clearErrors}>Reset page error counters</button>}
  </>;
}

export default function FocusDeviceDesk({ tracking, devices, health, livePins, onFocus }) {
  return <section className="focus-card focus-device-desk" aria-labelledby="focus-device-title">
    <h2 id="focus-device-title">Phone, car & computer diagnostics</h2>
    <p className="focus-footnote">Choose a quiet view before driving or starting work. Location and sharing remain under your existing controls.</p>
    <div className="focus-actions">
      {['Phone', 'Driving', 'Computer'].map(mode => <button type="button" className="focus-button" key={mode}
        onClick={() => onFocus(mode.toLowerCase())}>Start {mode.toLowerCase()} focus</button>)}
    </div>
    <DeviceHealthOptions health={health} />
    <details className="focus-advanced"><summary>Diagnostic coverage & missing connections</summary>
      <div className="focus-advanced-body">
        <dl className="focus-ops-stats">
          <div><dt>Location readiness</dt><dd>{!tracking.visible ? 'Page hidden' : tracking.diagnostics.permission === 'denied' ? 'Permission denied' : tracking.paused ? 'Paused by you' : !tracking.active ? 'GPS off' : tracking.liveFix ? 'Fresh GPS available' : 'Waiting for accepted GPS'}</dd></div>
          <div><dt>Live pins</dt><dd>{livePins?.pins.filter(pin => pin.fix).length ?? 0} receiving · {livePins?.pins.length ?? 0} attached</dd></div>
          <div><dt>Secure browser context</dt><dd>{globalThis.isSecureContext ? 'Available' : 'Unavailable'}</dd></div>
        </dl>
        <div className="focus-diagnostic-table"><table>
          <caption>Available checks and additional connections needed</caption>
          <thead><tr><th>Area</th><th>Current coverage</th><th>Still needed</th></tr></thead>
          <tbody>
            <tr><th>Phone</th><td>GPS freshness, accuracy, permissions, battery when supported</td><td>A native app is needed for background updates while locked.</td></tr>
            <tr><th>Car</th><td>GPS trip, route, speed and stop estimates</td><td>An authorized OBD-II or manufacturer integration for engine, fuel and vehicle battery readings.</td></tr>
            <tr><th>Computer</th><td>Page responsiveness, errors, connection and site storage</td><td>A separate device management or security integration for system processes and hardware diagnostics.</td></tr>
            <tr><th>Live pin</th><td>This device and explicitly shared GPS sources</td><td>A location source on a moving item. A map point or phone number alone cannot track it.</td></tr>
          </tbody>
        </table></div>
      </div>
    </details>
    <FocusTrackingDetails tracking={tracking} devices={devices} health={health} />
    <details className="focus-advanced"><summary>Diagnostic capabilities & limits</summary>
      <div className="focus-advanced-body">
        <p className="focus-footnote">Phone: GPS accuracy, rejected jumps, permissions, visibility, screen wake lock, sharing, and actual Office HTTP responses.</p>
        <p className="focus-footnote">Car: GPS-based trip distance, reported or estimated speed, heading, route progress and stop detection through Vehicles & devices. The selected GPS source must travel with the vehicle. Vehicle labels and stop estimates are not verified car telemetry.</p>
        <p className="focus-footnote">Computer: this page's connection reports, stalls, supported battery data, and permission status. Office cannot inspect other programs, keystrokes, calls or messages.</p>
        <p className="focus-footnote">Vehicle hardware, engine codes, fuel, CarPlay and Android Auto telemetry are not connected. No vehicle hardware readings are inferred from GPS. Use system Focus / Do Not Disturb to silence notifications from other apps.</p>
      </div>
    </details>
  </section>;
}

export function FocusShield({ mode, tracking, devices, health, vehicle, seconds, onExit }) {
  const diagnostics = tracking.diagnostics;
  const fix = tracking.liveFix;
  return <section className="focus-distraction-free" aria-labelledby="focus-shield-title">
    <div className="focus-shield-content">
      <p className="focus-footnote">Distraction-free Office</p>
      <h1 id="focus-shield-title">{mode === 'driving' ? 'Driving' : mode === 'computer' ? 'Computer' : 'Phone'} focus</h1>
      <p>Office audio is silent. Automatic boundary actions in this tab are logged instead of interrupting you.</p>
      <dl className="focus-ops-stats" aria-live="off">
        <div><dt>GPS</dt><dd>{!tracking.active ? 'Off' : tracking.paused ? 'Paused by you' : !tracking.visible ? 'Paused while hidden' : fix ? `Receiving · ±${Math.ceil(fix.accuracy)} m` : 'Waiting for accepted GPS'}</dd></div>
        <div><dt>Connection</dt><dd>{diagnostics.online ? 'Device reports online' : 'Device reports offline'}</dd></div>
        <div><dt>Sharing</dt><dd>{devices.sharing || 'Off'}</dd></div>
        <div><dt>Work time remaining</dt><dd>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</dd></div>
        {mode === 'driving' && <>
          <div><dt>Vehicle source</dt><dd>{vehicle?.profile.name ?? 'No vehicle trip active'}</dd></div>
          <div><dt>GPS reported speed</dt><dd>{fix?.speed != null ? locationSpeed(fix.speed, 'metric') : 'Unavailable'}</dd></div>
        </>}
      </dl>
      <button type="button" className="focus-button focus-primary" onClick={onExit} autoFocus>End distraction-free focus</button>
      <details className="focus-advanced"><summary>Diagnostics & controls on demand</summary>
        <div className="focus-advanced-body">
          <DeviceHealthOptions health={health} />
          <FocusTrackingDetails tracking={tracking} devices={devices} health={health} />
          <div className="focus-actions">
            {tracking.active && <button type="button" className="focus-button" onClick={() => tracking.stop()}>Stop GPS tracking</button>}
            {devices.sharing && <button type="button" className="focus-button" onClick={devices.stopSharing}>Stop sharing GPS</button>}
          </div>
        </div>
      </details>
      <p className="focus-footnote">Other apps need system Focus / Do Not Disturb. Browser GPS pauses when hidden or locked; missing readings and network errors are logged without inferred causes.</p>
    </div>
  </section>;
}
