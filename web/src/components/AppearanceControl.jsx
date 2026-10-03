import { useId, useSyncExternalStore } from 'react';

const subscribe = callback => {
  window.addEventListener('ufi:appearance', callback);
  return () => window.removeEventListener('ufi:appearance', callback);
};
const preference = () => window.__ufiAppearance?.preference || 'system';
const serverPreference = () => 'system';

export default function AppearanceControl({ compact = false, business = false }) {
  const id = useId();
  const selected = useSyncExternalStore(subscribe, preference, serverPreference);
  return <div className={'appearance-control' + (compact ? ' appearance-control--compact' : '')}>
    <label htmlFor={id}>Appearance</label>
    <select id={id} value={selected} onChange={event => window.__ufiAppearance?.setPreference(event.target.value)}>
      <option value="system">Auto (device setting)</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
    {!compact && <p>{business ? 'Choose Light or Dark for your recruiting workspace.' : 'Light or Dark for all of UFIconnect, including Your Vault.'} Auto follows your device appearance. Saved on this browser.</p>}
  </div>;
}
