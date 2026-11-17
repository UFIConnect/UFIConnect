import { useEffect, useState } from 'react';
import { MapPin, Navigation } from 'lucide-react';
import FocusLocation from './FocusLocation';
import FocusZone from './FocusZone';
import { FENCE_PROFILES } from './focus-geofence.mjs';
import { readFocusSettings, saveFocusSettings } from './focus-studio-model.mjs';
import { TRACKING_PROFILES } from './focus-tracking.mjs';
import useFocusLocation from './useFocusLocation';
import './OfficeLocationMaps.css';

export default function OfficeLocationMaps({ active, onOpen }) {
  const [section, setSection] = useState('tracking');
  const [settings, setSettings] = useState(readFocusSettings);
  const { tracking, monitor, walk } = useFocusLocation(settings, active);
  useEffect(() => saveFocusSettings(settings), [settings]);

  function updateSettings(changes) {
    setSettings(current => ({ ...current, ...(typeof changes === 'function' ? changes(current) : changes) }));
  }
  function updateTracking(changes) {
    updateSettings(current => ({ tracking: { ...current.tracking, ...changes } }));
  }
  function updateFence(changes) {
    updateSettings(current => ({ fence: { ...current.fence, ...changes } }));
  }
  function openWalk(mode) {
    const target = walk.state?.mode ?? mode;
    walk.open(target);
    setSection(target === 'route' ? 'tracking' : 'zones');
  }
  const walkTools = { ...walk, open: openWalk };
  const map = {
    mapMode: settings.mapMode,
    setMapMode: mapMode => updateSettings({ mapMode }),
    showStreets: settings.streets,
    setShowStreets: streets => updateSettings({ streets }),
  };
  const trackingOpen = active && section === 'tracking';
  const zonesOpen = active && section === 'zones';
  return <>
    <div className="office-location-maps" hidden={!active}>
      <h1>Location maps</h1>
      <nav className="office-location-nav" aria-label="Location maps">
        <button type="button" aria-current={section === 'tracking' ? 'page' : undefined}
          onClick={() => setSection('tracking')}><Navigation size={17} aria-hidden="true" />Geo Tracking</button>
        <button type="button" aria-current={section === 'zones' ? 'page' : undefined}
          onClick={() => setSection('zones')}><MapPin size={17} aria-hidden="true" />Geofencing</button>
      </nav>
      {trackingOpen && <FocusLocation tracking={tracking} preferences={settings.tracking} onChange={updateTracking}
        onProfile={profile => updateTracking({ profile, interval: TRACKING_PROFILES[profile].interval })}
        walk={walkTools} map={map} />}
      <div hidden={!zonesOpen}>
        <FocusZone settings={settings} updateSettings={updateSettings} monitor={monitor}
          deviceFix={zonesOpen ? tracking.fix ?? monitor.status?.fix : null}
          updateFence={updateFence} onAccuracy={profile => updateFence({ profile, seconds: FENCE_PROFILES[profile].defaultSeconds })}
          walk={walkTools} map={map} mapVisible={zonesOpen} />
      </div>
    </div>
    {!active && (tracking.active || monitor.active) && <aside className="focus-compact" aria-label="Location session">
      <button type="button" className="focus-button" onClick={onOpen}>Location maps</button>
      {tracking.active && <button type="button" className="focus-button" onClick={tracking.stop}>Stop Geo Tracking</button>}
      {monitor.active && <button type="button" className="focus-button" onClick={monitor.stop}>Stop Geofencing</button>}
    </aside>}
  </>;
}
