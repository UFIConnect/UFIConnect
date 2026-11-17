import { useId, useState } from 'react';
import FocusNumberInput from './FocusNumberInput';
import { fenceProfile, normalizeScheduleTimeZone, ZONE_DAYS, zoneSchedule } from './focus-geofence.mjs';
import { FENCE_TIMING, RULE_ACTIONS, ZONE_OVERRIDE_FIELDS } from './focus-studio-model.mjs';

export const EVENT_LABELS = { enter: 'Arrival', exit: 'Departure', stay: 'Stay', approach: 'Approach' };

export function ZoneActionSelect({ label, options, value, onChange }) {
  return <label className="focus-select">{label}
    <select value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  </label>;
}

const TIMING_FIELDS = [
  ['staySeconds', 'Seconds inside before a stay triggers'],
  ['approachMeters', 'Approach distance (m)'],
  ['cooldownSeconds', 'Action cooldown (seconds)'],
];
const SPECIFIC_FIELDS = [
  ['maxAccuracy', 'Maximum device uncertainty (m)'], ['buffer', 'Boundary margin (m)'],
  ['enterSeconds', 'Arrival confirmation (seconds)'], ['exitSeconds', 'Departure confirmation (seconds)'],
  ...TIMING_FIELDS,
];
const TIME_ZONES = [...new Set(['UTC', ...(Intl.supportedValuesOf?.('timeZone') ??
  ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Tokyo'])])];
const SNOOZE_MINUTES = [15, 30, 60, 120, 240, 1440];

function localDateInput(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const local = new Date(timestamp - date.getTimezoneOffset() * 60000);
  return Number.isFinite(local.getTime()) && local.getFullYear() <= 9999 ? local.toISOString().slice(0, 16) : '';
}

export function ZoneScheduleOptions({ zone, fence, onChange }) {
  const [snoozeMinutes, setSnoozeMinutes] = useState(60);
  const [timeZoneError, setTimeZoneError] = useState('');
  const timeZoneList = useId();
  const schedule = zoneSchedule(zone.schedule);
  const setSchedule = changes => onChange({ schedule: zoneSchedule({ ...schedule, ...changes }) });
  const snoozed = zone.snoozedUntil > Date.now();
  const profile = fenceProfile(fence);
  const defaults = { ...fence, maxAccuracy: profile.maxAccuracy, buffer: profile.buffer,
    enterSeconds: fence.seconds, exitSeconds: fence.separateExit ? fence.exitSeconds : fence.seconds };
  return <details className="focus-advanced">
    <summary>Zone schedule and priority</summary>
    <div className="focus-advanced-body">
      <div className="focus-option-grid">
        <label className="focus-select">Zone group
          <input value={zone.group ?? ''} maxLength={40} onChange={event => onChange({ group: event.target.value })} />
        </label>
        <label className="focus-select">Zone priority
          <FocusNumberInput min={0} max={9} value={zone.priority ?? 0} onChange={priority => onChange({ priority })} />
        </label>
        <label className="focus-select">Monitoring expires
          <input type="datetime-local" value={localDateInput(zone.until)}
            onChange={event => onChange({ until: event.target.value ? new Date(event.target.value).getTime() : undefined })} />
        </label>
      </div>
      <label className="focus-check"><input type="checkbox" checked={Boolean(zone.exclude)}
        onChange={event => onChange({ exclude: event.target.checked })} />Exclude from combined area</label>
      <label className="focus-check"><input type="checkbox" checked={schedule.enabled}
        onChange={event => setSchedule({ enabled: event.target.checked })} />Use active days and hours</label>
      {schedule.enabled && <>
        <div className="focus-chips" role="group" aria-label="Active days">
          {ZONE_DAYS.map((day, index) => <button className="focus-chip" key={day} type="button" aria-pressed={schedule.days.includes(index)}
            onClick={() => setSchedule({ days: schedule.days.includes(index) ? schedule.days.filter(value => value !== index) : [...schedule.days, index] })}>
            {day}
          </button>)}
        </div>
        <div className="focus-option-grid">
          <label className="focus-select">Start time
            <input type="time" value={schedule.start} onChange={event => setSchedule({ start: event.target.value })} />
          </label>
          <label className="focus-select">End time
            <input type="time" value={schedule.end} onChange={event => setSchedule({ end: event.target.value })} />
          </label>
          <label className="focus-select">Schedule time zone
            <input key={zone.id + ':' + schedule.timeZone} defaultValue={schedule.timeZone} list={timeZoneList}
              placeholder="Device time zone" onBlur={event => {
                const value = event.target.value.trim();
                const timeZone = normalizeScheduleTimeZone(value);
                if (value && !timeZone) {
                  setTimeZoneError('Choose a time zone or leave the field empty for device time.');
                  return;
                }
                setTimeZoneError('');
                if (timeZone !== schedule.timeZone) setSchedule({ timeZone });
              }} />
            <datalist id={timeZoneList}>{TIME_ZONES.map(region => <option key={region} value={region} />)}</datalist>
          </label>
        </div>
        {timeZoneError && <p className="focus-error" role="alert">{timeZoneError}</p>}
        <p className="focus-footnote">An end time before the start continues into the next day. Matching times cover the full selected day.</p>
      </>}
      <div className="focus-actions">
        {!snoozed && <ZoneActionSelect label="Snooze duration" value={snoozeMinutes}
          options={SNOOZE_MINUTES.map(minutes => ({ id: minutes, label: minutes < 60 ? minutes + ' minutes'
            : minutes === 60 ? '1 hour' : minutes === 1440 ? '1 day' : minutes / 60 + ' hours' }))}
          onChange={value => setSnoozeMinutes(Number(value))} />}
        <button className="focus-button" type="button" onClick={() => onChange({
          snoozedUntil: snoozed ? undefined : Date.now() + snoozeMinutes * 60000,
        })}>
          {snoozed ? 'End zone snooze' : 'Snooze zone'}
        </button>
      </div>
      {snoozed && <p className="focus-footnote">Snoozed until {new Date(zone.snoozedUntil).toLocaleTimeString()}.</p>}
      <label className="focus-check"><input type="checkbox" checked={Boolean(zone.overrides)} onChange={event => {
        const values = Object.fromEntries(SPECIFIC_FIELDS.map(([field]) => [field, defaults[field]]));
        onChange({ overrides: event.target.checked ? values : undefined });
      }} />Set custom values for this zone</label>
      {zone.overrides && <>
        <div className="focus-option-grid">
          {SPECIFIC_FIELDS.map(([field, label]) => <label className="focus-select" key={field}>{label}
            <FocusNumberInput {...ZONE_OVERRIDE_FIELDS[field]} value={zone.overrides[field] ?? defaults[field]}
              onChange={value => onChange({ overrides: { ...zone.overrides, [field]: value } })} />
          </label>)}
        </div>
        <p className="focus-footnote">Selected and individual modes use these timings. Combined areas use the global rule timings and each zone’s accuracy and boundary margin.</p>
      </>}
    </div>
  </details>;
}

export default function FocusZoneOptions({ fence, groups, onChange }) {
  const [feedback, setFeedback] = useState('');
  const notificationAvailable = typeof Notification !== 'undefined';

  async function toggleNotifications() {
    if (fence.notify) { onChange({ notify: false }); return; }
    try {
      if ((await Notification.requestPermission()) === 'granted') {
        onChange({ notify: true });
        setFeedback('');
      } else setFeedback('Location activity stays in Office. Enable notifications for Office in your browser settings.');
    } catch { setFeedback('This browser does not offer notification permission in Office.'); }
  }

  return <details className="focus-advanced">
    <summary>Advanced geofence rules</summary>
    <div className="focus-advanced-body">
      <div className="focus-option-grid">
        <ZoneActionSelect label="Default stay action" value={fence.stay} options={RULE_ACTIONS.stay} onChange={stay => onChange({ stay })} />
        <ZoneActionSelect label="Default approach action" value={fence.approach} options={RULE_ACTIONS.approach}
          onChange={approach => onChange({ approach })} />
        {TIMING_FIELDS.map(([field, label]) => <label className="focus-select" key={field}>{label}
          <FocusNumberInput {...FENCE_TIMING[field]} value={fence[field]} onChange={value => onChange({ [field]: value })} />
        </label>)}
        {fence.scope === 'all' && <ZoneActionSelect label="Combined area" value={fence.combination}
          options={[{ id: 'any', label: 'Inside any included zone' }, { id: 'every', label: 'Inside every included zone' }]}
          onChange={combination => onChange({ combination })} />}
        {fence.scope !== 'selected' && groups.length > 0 && <ZoneActionSelect label="Zone group to monitor" value={fence.group}
          options={[{ id: '', label: 'All groups' }, ...groups.map(group => ({ id: group, label: group }))]}
          onChange={group => onChange({ group })} />}
      </div>
      <label className="focus-check"><input type="checkbox" checked={fence.separateExit}
        onChange={event => onChange({ separateExit: event.target.checked })} />Use a separate departure confirmation</label>
      {fence.separateExit && <label className="focus-select">Departure confirmation (seconds)
        <FocusNumberInput {...FENCE_TIMING.exitSeconds} value={fence.exitSeconds}
          onChange={exitSeconds => onChange({ exitSeconds })} />
      </label>}
      <label className="focus-check"><input type="checkbox" checked={fence.duringFocus}
        onChange={event => onChange({ duringFocus: event.target.checked })} />Run actions only while a work timer is running</label>
      <label className="focus-check"><input type="checkbox" checked={fence.fireOnStart}
        onChange={event => onChange({ fireOnStart: event.target.checked })} />Run arrival after starting inside a zone</label>
      {notificationAvailable && <button className="focus-button" type="button" aria-pressed={fence.notify} onClick={toggleNotifications}>
        Browser event notifications
      </button>}
      {feedback && <p className="focus-feedback" role="status">{feedback}</p>}
    </div>
  </details>;
}
