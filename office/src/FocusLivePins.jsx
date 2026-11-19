import { useState } from 'react';
import { coordinateLabel } from './focus-studio-model.mjs';
import { LIVE_PIN_LIMIT, LOCAL_PIN_SOURCE } from './focus-live-pins.mjs';

export default function FocusLivePins({ tools }) {
  const [sourceId, setSourceId] = useState(LOCAL_PIN_SOURCE);
  const target = tools.targets.find(source => source.id === sourceId);
  return <details className="focus-advanced focus-live-pins" open>
    <summary>Live pins ({tools.pins.length})</summary>
    <div className="focus-advanced-body">
      <p className="focus-footnote">Attach a pin to this device or a device sharing GPS with Office. It follows that source as fresh readings arrive. Tap a GPS marker while dropping a pin to attach it directly.</p>
      <div className="focus-ops-fields">
        <label className="focus-select">Live pin target
          <select value={sourceId} onChange={event => setSourceId(event.target.value)}>
            {sourceId !== LOCAL_PIN_SOURCE && !target && <option value={sourceId}>Selected source unavailable</option>}
            {tools.targets.map(source => <option key={source.id} value={source.id}>{source.name}{source.fix ? ' · GPS live' : ' · waiting for GPS'}</option>)}
          </select>
        </label>
        <button className="focus-button" type="button" disabled={!target?.fix || tools.pins.length >= LIVE_PIN_LIMIT && !tools.pins.some(pin => pin.sourceId === sourceId)}
          onClick={() => tools.attach(sourceId)}>Attach live pin</button>
      </div>
      {!target?.fix && <p className="focus-footnote">Start live GPS for this device, or view an explicitly shared device, then attach a pin when its GPS is fresh.</p>}
      {tools.pins.length >= LIVE_PIN_LIMIT && <p className="focus-footnote">Live pin limit reached. Remove a pin to attach another source.</p>}
      {tools.storageError && <p className="focus-error" role="alert">Live pin bindings could not be saved on this device.</p>}
      <ul className="focus-ops-list">
        {tools.pins.map(pin => <li key={pin.id} data-live-pin-id={pin.id}>
          <div><strong>{pin.name}</strong><span>{pin.status}</span>
            {pin.fix && <><span>{coordinateLabel(pin.fix)}</span><span>±{Math.ceil(pin.fix.accuracy)} m · {new Date(pin.fix.timestamp).toLocaleTimeString()}</span></>}
          </div>
          <div className="focus-actions">
            <button className="focus-button" type="button" disabled={!pin.fix} aria-pressed={tools.selectedId === pin.id}
              onClick={() => tools.follow(pin.id)}>Follow pin</button>
            <button className="focus-button" type="button" onClick={() => tools.pause(pin.id, !pin.paused)}>{pin.paused ? 'Resume pin' : 'Pause pin'}</button>
            <button className="focus-button" type="button" onClick={() => tools.remove(pin.id)}>Remove live pin</button>
          </div>
        </li>)}
      </ul>
      {tools.selected && <button className="focus-button" type="button" onClick={tools.clearFollow}>Stop following live pin</button>}
      <p className="focus-footnote">Saved location pins keep their fixed coordinates and radius. Live pins do not move geofence boundaries. An ordinary map point cannot supply a moving object's location. Saved live pins restore paused; ended sharing sessions must be attached again.</p>
    </div>
  </details>;
}
