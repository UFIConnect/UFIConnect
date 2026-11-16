import { useEffect, useRef, useState } from 'react';
import { Crosshair, Globe2, MapPin, Plus, Trash2 } from 'lucide-react';
import FocusGlobe from './FocusGlobe';
import { BackgroundLocation, locationTime } from './FocusLocation';
import FocusNumberInput from './FocusNumberInput';
import { FocusRadiusDiagram } from './FocusRadiusDiagram';
import { FENCE_CUSTOM_FIELDS, FENCE_PROFILES, fenceProfile, locationOptions, readLocationFix } from './focus-geofence.mjs';
import { ENTRY_ACTIONS, EXIT_ACTIONS, FENCE_SCOPES, MIN_RADIUS, RADIUS_VALUES, boundaryRule, coordinateLabel, nextZoneName, radiusIndex, radiusLabel, roundRadius, zoneLabel } from './focus-studio-model.mjs';
import { locationMessage } from './useFocusLocation';

const RADIUS_PRESETS = [1, 25, 100, 250, 1000, 5000, 25000, 100000];
const STATUS = { inside: 'Inside the monitored area', outside: 'Outside the monitored area',
  edge: 'Near a boundary · waiting for a clearer fix', weak: 'Location accuracy is too low' };
const READING = { inside: 'Inside', outside: 'Outside', edge: 'Near the edge', weak: 'Low accuracy' };
const DEFAULT_RULE = { id: '', label: 'Use default action' };
const ACCURACY_OPTIONS = Object.entries(FENCE_PROFILES).map(([id, { label }]) => ({ id, label }));

function ActionSelect({ label, options, value, onChange }) {
  return <label className="focus-select">{label}
    <select value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  </label>;
}

function ZoneMonitoring({ monitor, settings, onChange, onRuleChange, onAccuracy }) {
  const { active, visible, status, error, events, monitoredCount, selected, refreshing } = monitor;
  const { scope, profile, seconds, enter, exit, custom } = settings.fence;
  const { maxAccuracy, highAccuracy } = fenceProfile(settings.fence);
  const [test, setTest] = useState(null);
  const testRule = test?.id === selected?.id && selected
    ? boundaryRule(settings, { type: test.type, zoneId: scope === 'all' ? null : selected.id }) : null;
  let label = monitoredCount ? 'Geofencing off' : 'Create or enable a zone to start geofencing';
  if (active) {
    if (!visible) label = 'Geofencing paused while this browser tab is hidden';
    else if (!status) label = 'Waiting for your device’s location…';
    else if (status.checking) label = status.checking === 'inside' ? 'Confirming you’re inside…' : 'Confirming you’re outside…';
    else label = STATUS[status.relation];
  }

  return <section className="focus-card focus-monitor" aria-labelledby="focus-monitor-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><MapPin size={18} aria-hidden="true" /></span>
      <div><h2 id="focus-monitor-title">Geofencing</h2><p>Run Focus commands when you cross a zone boundary.</p></div>
    </div>
    <div className="focus-zone-status" role="status">
      <span className="focus-dot" data-location={status?.relation} />
      <div>{label}{status && <small>Device accuracy ±{Math.ceil(status.fix.accuracy)} m · {locationTime(status.fix.timestamp)}</small>}</div>
    </div>
    <div className="focus-actions focus-monitor-actions">
      <button type="button" className={`focus-button${active ? '' : ' focus-primary'}`} disabled={!monitoredCount}
        onClick={active ? monitor.stop : monitor.start}>{active ? 'Stop Geofencing' : 'Start Geofencing'}</button>
      <button type="button" className="focus-button" disabled={!active || !visible || refreshing}
        onClick={monitor.refresh}>{refreshing ? 'Checking location…' : 'Refresh location'}</button>
    </div>
    {error && <p className="focus-error" role="alert">{error}</p>}
    <BackgroundLocation feature="Geofencing" checked={settings.fence.background}
      onChange={background => onChange({ background })} />
    <div className="focus-chips focus-monitor-scopes" role="group" aria-label="Zones to monitor">
      {FENCE_SCOPES.map(({ id, label }) => <button type="button" className="focus-chip" key={id}
        aria-pressed={scope === id} onClick={() => onChange({ scope: id })}>{label}</button>)}
    </div>
    <div className="focus-monitor-fields">
      <ActionSelect label="Location accuracy" value={profile} options={ACCURACY_OPTIONS} onChange={onAccuracy} />
      {profile === 'custom' ? <div className="focus-accuracy-custom">
        {Object.entries(FENCE_CUSTOM_FIELDS).map(([field, { label, min, max }]) => <label className="focus-select" key={field}>{label}
          <FocusNumberInput value={custom[field]} min={min} max={max}
            onChange={value => onChange({ custom: { ...custom, [field]: value } })} />
        </label>)}
        <label className="focus-check"><input type="checkbox" checked={custom.highAccuracy}
          onChange={event => onChange({ custom: { ...custom, highAccuracy: event.target.checked } })} />Request high accuracy</label>
      </div> : <p className="focus-footnote focus-accuracy-description">
        Up to ±{maxAccuracy} m device uncertainty · {highAccuracy ? 'High accuracy requested' : 'Standard accuracy requested'}
      </p>}
      <label className="focus-slider">
        <span>Confirm boundary after</span><output>{seconds} s</output>
        <input type="range" aria-label="Boundary confirmation time" min="2" max="30" step="1" value={seconds}
          aria-valuetext={`${seconds} seconds`} onChange={event => onChange({ seconds: Number(event.target.value) })} />
      </label>
      <ActionSelect label="Default arrival action" value={enter} options={ENTRY_ACTIONS} onChange={enter => onChange({ enter })} />
      <ActionSelect label="Default exit action" value={exit} options={EXIT_ACTIONS} onChange={exit => onChange({ exit })} />
    </div>
    {selected && <div className="focus-zone-details">
      <h3>Rules for {zoneLabel(selected)}</h3>
      <div className="focus-monitor-fields">
        <ActionSelect label="Zone arrival action" value={selected.rules?.enter ?? ''} options={[DEFAULT_RULE, ...ENTRY_ACTIONS]}
          onChange={action => onRuleChange(selected.id, 'enter', action)} />
        <ActionSelect label="Zone exit action" value={selected.rules?.exit ?? ''} options={[DEFAULT_RULE, ...EXIT_ACTIONS]}
          onChange={action => onRuleChange(selected.id, 'exit', action)} />
      </div>
      {scope === 'all' && <p className="focus-footnote">Together mode uses the default actions at the combined boundary.</p>}
      {scope === 'individual' && <p className="focus-footnote">When crossings happen together, Quiet Mode takes priority, followed by pauses and actions that reduce sound.</p>}
      <div className="focus-actions">
        <button type="button" className="focus-button" onClick={() => setTest({ id: selected.id, type: 'enter' })}>Test arrival</button>
        <button type="button" className="focus-button" onClick={() => setTest({ id: selected.id, type: 'exit' })}>Test exit</button>
      </div>
      <p className="focus-feedback" role="status">{testRule && `${testRule.type === 'enter' ? 'Arrival' : 'Exit'} preview · ${testRule.label}${selected.enabled ? '' : ' (zone disabled)'}`}</p>
    </div>}
    {events.length > 0 && <div className="focus-zone-details">
      <div className="focus-zone-activity-heading"><h3>Recent crossings</h3>
        <button type="button" className="focus-button" onClick={monitor.clearEvents}>Clear activity</button></div>
      <ul className="focus-zone-events">{events.map(event => {
        const zone = settings.zones.find(zone => zone.id === event.zoneId);
        return <li key={`${event.at}-${event.zoneId}-${event.type}`}>
          <span>{event.type === 'enter' ? 'Entered' : 'Left'} {zone ? zoneLabel(zone) : 'the monitored area'}</span>
          <time dateTime={new Date(event.at).toISOString()}>{locationTime(event.at)}</time>
        </li>;
      })}</ul>
    </div>}
    <p className="focus-footnote">Location and crossings stay in this browser.</p>
  </section>;
}

export default function FocusZone({ settings, updateSettings, monitor, deviceFix, updateFence, onAccuracy }) {
  const { zones, activeZoneId } = settings;
  const selected = zones.find(zone => zone.id === activeZoneId);
  const [draft, setDraft] = useState(null);
  const [capturing, setCapturing] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [saved, setSaved] = useState('');
  const [radiusInput, setRadiusInput] = useState(null);
  const capture = useRef(0);
  const editing = Boolean(draft);
  const target = draft ?? selected;
  const radius = target?.radius ?? settings.radius;
  const measurement = !draft ? monitor.status?.measurements.find(item => item.id === selected?.id) : null;

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
      }, fail, locationOptions());
    } catch (error) { fail(error); }
  }

  function setRadius(radius) {
    if (!target) { updateSettings({ radius }); return; }
    setDeleting(false);
    setSaved('');
    setDraft(previous => ({ ...(previous ?? selected), radius }));
  }

  function commitRadius(event) {
    const value = event.currentTarget.valueAsNumber;
    setRadiusInput(null);
    if (Number.isFinite(value) && roundRadius(value) !== radius) setRadius(roundRadius(value));
  }

  function save() {
    const zone = { ...draft, name: draft.name.trim(), id: draft.id || crypto.randomUUID() };
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
        <div><h2 id="focus-zone-title">Focus zones</h2><p>Drag to pan. Tap the globe to place a pin.</p></div>
      </div>
      <FocusGlobe zones={zones} selected={selected} draft={draft} deviceFix={deviceFix}
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
      {editing && <label className="focus-select focus-zone-name">Zone name
        <input value={draft.name} maxLength={64} onChange={event => {
          const name = event.target.value;
          setDraft(current => ({ ...current, name }));
        }} />
      </label>}
      <label className="focus-select focus-radius">Radius (meters)
        <input type="number" min={MIN_RADIUS} step="1" value={radiusInput ?? radius}
          onChange={event => setRadiusInput(event.target.value)} onBlur={commitRadius}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      </label>
      <label className="focus-slider focus-radius">
        <span>Quick resize</span><output>{radiusLabel(radius)}</output>
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
        <button type="button" className="focus-button" onClick={() => moveZone(selected.id, selected.center)}>Edit zone</button>
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
        {zones.map(zone => {
          const reading = monitor.status?.measurements.find(item => item.id === zone.id);
          const signal = reading?.checking ? 'Confirming' : reading && READING[reading.relation];
          return <div className="focus-zone-item" key={zone.id} data-selected={zone.id === activeZoneId}>
            <button className="focus-zone-select-button" type="button" aria-pressed={zone.id === activeZoneId} onClick={() => selectZone(zone.id)}>
              <MapPin size={16} aria-hidden="true" /><span>{zoneLabel(zone)}<small>{radiusLabel(zone.radius)}{signal && ` · ${signal}`}</small></span>
            </button>
            <button type="button" className="focus-button" aria-label={`${zone.enabled ? 'Disable' : 'Enable'} ${zoneLabel(zone)}`}
              onClick={() => {
                setDraft(current => current?.id === zone.id ? { ...current, enabled: !zone.enabled } : current);
                updateSettings(current => ({ zones: current.zones.map(item => item.id === zone.id ? { ...item, enabled: !item.enabled } : item) }));
              }}>{zone.enabled ? 'Enabled' : 'Disabled'}</button>
          </div>;
        })}
      </div>
    </section>}
    <ZoneMonitoring monitor={monitor} settings={settings} onChange={updateFence} onAccuracy={onAccuracy}
      onRuleChange={(id, type, action) => {
        updateSettings(current => ({ zones: current.zones.map(zone => zone.id === id
          ? { ...zone, rules: { ...zone.rules, [type]: action || undefined } } : zone) }));
        setDraft(current => current?.id === id ? { ...current, rules: { ...current.rules, [type]: action || undefined } } : current);
      }} />
  </div>;
}
