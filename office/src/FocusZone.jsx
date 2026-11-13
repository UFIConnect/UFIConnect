import { useEffect, useRef, useState } from 'react';
import { Crosshair, Globe2, MapPin, Navigation, Plus, Trash2 } from 'lucide-react';
import FocusGlobe from './FocusGlobe';
import { FocusRadiusDiagram } from './FocusRadiusDiagram';
import { FENCE_PROFILES, readLocationFix } from './focus-geofence.mjs';
import { ENTRY_ACTIONS, EXIT_ACTIONS, RADIUS_VALUES, coordinateLabel, nextZoneName, radiusIndex, radiusLabel, zoneLabel } from './focus-studio-model.mjs';
import { LOCATION_OPTIONS, locationMessage } from './useFocusGeofence';

const RADIUS_PRESETS = [100, 250, 1000, 5000, 25000, 100000];
const STATUS = { inside: 'Inside the monitored area', outside: 'Outside the monitored area',
  edge: 'Near a boundary · waiting for a clearer fix', weak: 'Location accuracy is too low' };

function ActionSelect({ label, options, value, onChange }) {
  return <label className="focus-select">{label}
    <select value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  </label>;
}

function ZoneMonitoring({ monitor, settings, onChange }) {
  const { active, visible, status, error, event, monitoredCount } = monitor;
  const { scope, profile, seconds, enter, exit } = settings;
  let label = monitoredCount ? 'Monitoring off' : 'Choose an enabled zone to monitor';
  if (active) {
    if (!visible) label = 'Monitoring paused while this browser tab is hidden';
    else if (!status) label = 'Waiting for your device’s location…';
    else if (status.checking) label = status.checking === 'inside' ? 'Confirming you’re inside…' : 'Confirming you’re outside…';
    else label = STATUS[status.relation];
  }

  return <section className="focus-card focus-monitor" aria-labelledby="focus-monitor-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><Navigation size={18} aria-hidden="true" /></span>
      <div><h2 id="focus-monitor-title">Monitoring</h2><p>Choose where Focus Studio responds to your location.</p></div>
    </div>
    <div className="focus-zone-status" role="status">
      <span className="focus-dot" data-location={status?.relation} />
      <div>{label}{status && <small>Device accuracy ±{Math.ceil(status.accuracy)} m</small>}</div>
    </div>
    <button type="button" className={`focus-button${active ? '' : ' focus-primary'}`} disabled={!monitoredCount}
      onClick={active ? monitor.stop : monitor.start}>{active ? 'Stop monitoring' : 'Start monitoring'}</button>
    {error && <p className="focus-error" role="alert">{error}</p>}
    {event && <p className="focus-feedback">Last confirmed {event.type === 'enter' ? 'arrival' : 'exit'} at {new Date(event.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>}
    <div className="focus-monitor-fields">
      <ActionSelect label="Monitor" value={scope} options={[{ id: 'selected', label: 'Selected zone' }, { id: 'all', label: 'All enabled zones' }]}
        onChange={scope => onChange({ scope })} />
      <ActionSelect label="Location accuracy" value={profile} options={Object.entries(FENCE_PROFILES).map(([id, item]) => ({ id, label: item.label }))}
        onChange={profile => onChange({ profile, seconds: FENCE_PROFILES[profile].defaultSeconds })} />
      <label className="focus-slider">
        <span>Confirm boundary after</span><output>{seconds} s</output>
        <input type="range" aria-label="Boundary confirmation time" min="2" max="30" step="1" value={seconds}
          aria-valuetext={`${seconds} seconds`} onChange={event => onChange({ seconds: Number(event.target.value) })} />
      </label>
      <ActionSelect label="When you enter" value={enter} options={ENTRY_ACTIONS} onChange={enter => onChange({ enter })} />
      <ActionSelect label="When you leave" value={exit} options={EXIT_ACTIONS} onChange={exit => onChange({ exit })} />
    </div>
    <p className="focus-footnote">Location stays in this browser. Keep this tab visible. Strict mode waits for more accurate readings and gives the boundary a wider buffer.</p>
  </section>;
}

export default function FocusZone({ settings, updateSettings, monitor }) {
  const { zones, activeZoneId } = settings;
  const selected = zones.find(zone => zone.id === activeZoneId);
  const [draft, setDraft] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState('');
  const capture = useRef(0);
  const editing = Boolean(draft);
  const target = draft ?? selected;
  const radius = target?.radius ?? settings.radius;
  const measurement = monitor.active && monitor.visible && !draft
    ? monitor.status?.measurements.find(item => item.id === selected?.id) : null;

  useEffect(() => () => { capture.current++; }, []);

  function cancelLocation() {
    capture.current++;
    setCapturing(false);
    setLocationError('');
  }

  function choosePoint(center, country = '') {
    cancelLocation();
    setDeleting(false);
    setSaved('');
    setDraft(previous => previous ? { ...previous, center } : {
      id: null, center, radius: settings.radius, name: nextZoneName(zones, country || 'Focus zone'), enabled: true,
    });
  }

  function selectZone(id) {
    cancelLocation();
    setDeleting(false);
    setDraft(null);
    setSaved('');
    updateSettings({ activeZoneId: id });
  }

  function moveZone(id, center) {
    const zone = zones.find(item => item.id === id);
    if (!zone) return;
    cancelLocation();
    setDeleting(false);
    setSaved('');
    setDraft(previous => previous?.id === id ? { ...previous, center } : { ...zone, center });
    updateSettings({ activeZoneId: id });
  }

  function locate() {
    if (!window.isSecureContext || !navigator.geolocation) {
      setLocationError('This browser needs a secure connection to use device location.');
      return;
    }
    const request = ++capture.current;
    setCapturing(true);
    setLocationError('');
    const fail = error => {
      if (capture.current !== request) return;
      setCapturing(false);
      setLocationError(locationMessage(error));
    };
    try {
      navigator.geolocation.getCurrentPosition(position => {
        if (capture.current !== request) return;
        const fix = readLocationFix(position, Date.now());
        if (!fix) { fail({ code: 3 }); return; }
        const { latitude, longitude, accuracy } = fix;
        choosePoint({ latitude, longitude, accuracy });
      }, fail, LOCATION_OPTIONS);
    } catch (error) { fail(error); }
  }

  function setRadius(radius) {
    if (!target) { updateSettings({ radius }); return; }
    setDeleting(false);
    setSaved('');
    setDraft(previous => ({ ...(previous ?? selected), radius }));
  }

  function save() {
    const zone = { ...draft, id: draft.id || crypto.randomUUID() };
    updateSettings(current => ({
      zones: draft.id ? current.zones.map(item => item.id === zone.id ? zone : item) : [...current.zones, zone],
      activeZoneId: zone.id,
    }));
    setDraft(null);
    setSaved(`${zoneLabel(zone)} saved.`);
  }

  function remove() {
    const remaining = zones.filter(zone => zone.id !== selected.id);
    updateSettings({ zones: remaining, activeZoneId: remaining[0]?.id ?? null });
    setDeleting(false);
    setSaved('Zone removed.');
  }

  return <div className="focus-zone-layout">
    <section className="focus-card focus-zone" aria-labelledby="focus-zone-title">
      <div className="focus-card-heading">
        <span className="focus-icon"><Globe2 size={19} aria-hidden="true" /></span>
        <div><h2 id="focus-zone-title">Focus zones</h2><p>Drag the globe to look around. Tap the map to place a zone.</p></div>
      </div>
      <FocusGlobe zones={zones} selected={selected} draft={draft} draftRadius={radius}
        onPick={choosePoint} onSelect={selectZone} onMove={moveZone} />
      <div className="focus-actions focus-globe-actions">
        <button type="button" className="focus-button" disabled={capturing} onClick={locate}>
          <Crosshair size={17} aria-hidden="true" />{capturing ? 'Finding your location…' : 'Use my location'}
        </button>
      </div>
      {locationError && <p className="focus-error" role="alert">{locationError}</p>}
      <p className="focus-footnote">Drag a pin to move it. Map data from <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>.</p>
    </section>
    <section className="focus-card focus-circle" aria-labelledby="focus-circle-title">
      <div className="focus-card-heading">
        <span className="focus-icon"><MapPin size={18} aria-hidden="true" /></span>
        <div><h2 id="focus-circle-title">{draft?.id ? 'Edit zone' : draft ? 'New zone' : selected ? zoneLabel(selected) : 'Zone radius'}</h2>
          <p>{target ? coordinateLabel(target.center) : 'Drop a pin to create a zone.'}</p></div>
      </div>
      <FocusRadiusDiagram radius={radius} location={measurement} onResize={setRadius} />
      <label className="focus-slider focus-radius">
        <span>Circle radius</span><output>{radiusLabel(radius)}</output>
        <input type="range" aria-label="Circle radius" min="0" max={RADIUS_VALUES.length - 1} value={radiusIndex(radius)}
          aria-valuetext={radiusLabel(radius)} onChange={event => setRadius(RADIUS_VALUES[Number(event.target.value)])} />
      </label>
      <div className="focus-chips" role="group" aria-label="Quick zone sizes">
        {RADIUS_PRESETS.map(meters => <button className="focus-chip" key={meters} type="button"
          aria-pressed={radius === meters} onClick={() => setRadius(meters)}>{radiusLabel(meters)}</button>)}
      </div>
      {measurement && <p className="focus-footnote">{radiusLabel(Math.round(measurement.distance))} from the center · ±{Math.ceil(measurement.uncertainty)} m</p>}
      {editing ? <div className="focus-actions focus-zone-save">
        <button type="button" className="focus-button focus-primary" onClick={save}><Plus size={16} aria-hidden="true" />{draft.id ? 'Save changes' : 'Save zone'}</button>
        <button type="button" className="focus-button" onClick={() => { cancelLocation(); setDraft(null); }}>Discard</button>
      </div> : selected && <div className="focus-actions focus-zone-save">
        <button type="button" className="focus-button" onClick={() => moveZone(selected.id, selected.center)}>Move pin</button>
        <button type="button" className="focus-button" onClick={() => {
          setDraft({ ...selected, id: null, name: nextZoneName(zones, zoneLabel(selected)) });
          setSaved('');
          setDeleting(false);
        }}>Duplicate zone</button>
        <button type="button" className="focus-button focus-icon-button" title="Remove zone" aria-label="Remove zone"
          onClick={() => setDeleting(value => !value)}><Trash2 size={16} aria-hidden="true" /></button>
      </div>}
      {deleting && selected && <div className="focus-actions focus-zone-save">
        <button type="button" className="focus-button" onClick={remove}>Remove {zoneLabel(selected)}</button>
        <button type="button" className="focus-button" onClick={() => setDeleting(false)}>Keep zone</button>
      </div>}
      {saved && <p className="focus-feedback" role="status">{saved}</p>}
    </section>
    {zones.length > 0 && <section className="focus-card focus-saved-zones" aria-labelledby="focus-saved-zones-title">
      <h2 id="focus-saved-zones-title">Saved zones</h2>
      <div className="focus-zone-list">
        {zones.map(zone => <div className="focus-zone-item" key={zone.id} data-selected={zone.id === activeZoneId}>
          <button className="focus-zone-select-button" type="button" aria-pressed={zone.id === activeZoneId} onClick={() => selectZone(zone.id)}>
            <MapPin size={16} aria-hidden="true" /><span>{zoneLabel(zone)}<small>{radiusLabel(zone.radius)}</small></span>
          </button>
          <button type="button" className="focus-button" aria-label={`${zone.enabled ? 'Disable' : 'Enable'} ${zoneLabel(zone)}`}
            onClick={() => {
              setDraft(current => current?.id === zone.id ? { ...current, enabled: !zone.enabled } : current);
              updateSettings(current => ({ zones: current.zones.map(item => item.id === zone.id ? { ...item, enabled: !item.enabled } : item) }));
            }}>{zone.enabled ? 'Enabled' : 'Disabled'}</button>
        </div>)}
      </div>
    </section>}
    <ZoneMonitoring monitor={monitor} settings={settings.fence}
      onChange={change => updateSettings(current => ({ fence: { ...current.fence, ...change } }))} />
  </div>;
}
