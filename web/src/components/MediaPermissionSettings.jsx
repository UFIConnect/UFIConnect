import { useEffect, useState } from 'react';
import { MEDIA_PERMISSION_CHANGED, readMediaPermissions, saveMediaPermission } from '../utils/mediaPermissions.mjs';

export default function MediaPermissionSettings({ accountId }) {
  const [choices, setChoices] = useState(() => readMediaPermissions(accountId));
  const [persistent, setPersistent] = useState(true);
  useEffect(() => {
    const update = () => setChoices(readMediaPermissions(accountId));
    update();
    window.addEventListener(MEDIA_PERMISSION_CHANGED, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(MEDIA_PERMISSION_CHANGED, update); window.removeEventListener('storage', update); };
  }, [accountId]);
  return <section className="media-permission-settings">
    <h3>Photos and camera</h3>
    <p>Choices are saved automatically for this account on this device. Your device’s camera permissions still apply.</p>
    {Object.entries({ photos: 'Photos and videos', camera: 'Camera' }).map(([kind, label]) => <label key={kind}>
      <span>{label}</span>
      <select className="form-select" aria-label={`${label} permission`} value={choices[kind]}
        onChange={event => { setPersistent(saveMediaPermission(accountId, kind, event.target.value)); setChoices(readMediaPermissions(accountId)); }}>
        <option value="ask">Ask next time</option><option value="allow">Allow</option><option value="block">Don’t allow</option>
      </select>
    </label>)}
    {!persistent && <p role="status">This browser can remember your choices until this page closes.</p>}
  </section>;
}
