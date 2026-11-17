import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { coordinateLabel, MIN_RADIUS, radiusLabel, roundRadius, zoneLabel } from './focus-studio-model.mjs';

function PinEditor({ pin, onSave, onRemove }) {
  const [saved, setSaved] = useState(false);

  function save(event) {
    event.preventDefault();
    const { name, radius } = event.currentTarget.elements;
    if (!Number.isFinite(radius.valueAsNumber)) return;
    const label = name.value.trim();
    const meters = roundRadius(radius.valueAsNumber);
    onSave({ name: label, radius: meters });
    name.value = label;
    radius.value = meters;
    setSaved(true);
  }

  return <details className="focus-globe-coordinate-picker">
    <summary>Edit pin</summary>
    <form className="focus-pin-form" onSubmit={save} onChange={() => setSaved(false)}>
      <div className="focus-option-grid">
        <label className="focus-select">Pin name
          <input name="name" defaultValue={pin.name} maxLength={64} />
        </label>
        <label className="focus-select">Radius (meters)
          <input name="radius" type="number" min={MIN_RADIUS} step="1" defaultValue={pin.radius} required />
        </label>
      </div>
      <div className="focus-actions">
        <button type="submit" className="focus-button focus-primary">Save pin</button>
        <button type="button" className="focus-button" onClick={onRemove}>Remove pin</button>
        {saved && <span className="focus-feedback" role="status">Pin saved.</span>}
      </div>
    </form>
  </details>;
}

export default function FocusSavedPins({ pins, activeIds, onPhone, paused, onLocate, onSave, onActivate, onRemove }) {
  if (!pins.length) return null;
  return <details className="focus-advanced focus-saved-pins">
    <summary>Saved pins ({pins.length})</summary>
    <div className="focus-advanced-body focus-zone-list">
      {pins.map(pin => {
        const name = zoneLabel(pin);
        const active = activeIds.includes(pin.id);
        return <div className="focus-saved-pin" role="group" aria-label={name} key={pin.id}>
          <div className="focus-zone-item" data-selected={active}>
            <button type="button" className="focus-zone-select-button" aria-label={`Show ${name} on map`}
              onClick={() => onLocate(pin)}>
              <MapPin size={16} aria-hidden="true" />
              <span>{name}<small>{radiusLabel(pin.radius)} · {coordinateLabel(pin.center)}</small></span>
            </button>
            <button type="button" className="focus-button" onClick={() => onActivate(pin.id, !active)}>
              {active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
          {active && <p className="focus-footnote" role="status">{onPhone ? 'Active on phone' : paused ? 'Geofencing paused' : 'Active'}</p>}
          <PinEditor pin={pin} onSave={changes => {
            onSave(pin.id, changes);
            onLocate({ ...pin, ...changes });
          }} onRemove={() => onRemove(pin.id)} />
        </div>;
      })}
    </div>
  </details>;
}
