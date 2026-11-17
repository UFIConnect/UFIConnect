import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { coordinateLabel, zoneLabel, radiusLabel } from './focus-studio-model.mjs';
import { selectPhoneConfig } from './useOfficeFocus';

const deviceStatus = {
  monitoring: 'Monitoring on phone', limited: 'Limited phone coverage', permission: 'Check phone location permissions',
  pending: 'Waiting for phone', paused: 'Sharing paused',
};

export default function FocusPhoneSync({ sync, settings, officeAccess, audioEnabledAt, onToggleAudio, audioError }) {
  const [draftReview, setReview] = useState(null);
  const [confirmation, setConfirmation] = useState('');
  const [disconnectNotice, setDisconnectNotice] = useState(false);
  const { snapshot, pairing, status } = sync;
  const phone = snapshot?.phone, fix = phone?.fix;
  const review = draftReview?.ownerId === snapshot?.ownerId ? draftReview : null;
  const { busy, code } = status;
  return <section className="focus-card focus-monitor" aria-labelledby="focus-phone-title">
    <div className="focus-card-heading">
      <span className="focus-icon"><Smartphone size={18} aria-hidden="true" /></span>
      <div><h2 id="focus-phone-title">Phone monitoring</h2><p>Pair the Office iPhone app for background zone activity.</p></div>
    </div>
    {!officeAccess && <p className="focus-footnote">Connect to Office to open private Focus settings.</p>}
    {officeAccess && code === 404 && <p className="focus-footnote">Phone sync is currently unavailable.</p>}
    {officeAccess && [401, 403].includes(code) && <p className="focus-footnote">
      <a href="https://uficonnect.org/login" target="_blank" rel="noreferrer">Sign in to your UFIConnect account</a>, then refresh here.
    </p>}
    {status.error && <p className="focus-error" role="alert">{status.error}</p>}
    {snapshot && !phone && disconnectNotice && <p role="status" className="focus-footnote">
      Office stopped receiving updates. The phone stops linked monitoring when it reconnects or its authorization expires.
    </p>}
    {snapshot && !review && <button type="button" className="focus-button" onClick={() => {
      setReview({ ...selectPhoneConfig(settings), revision: snapshot.revision, ownerId: snapshot.ownerId });
    }}>{snapshot.config ? 'Review zone changes' : 'Review zones to share'}</button>}
    {snapshot && review?.ownerId === snapshot.ownerId && <>
      <p className="focus-footnote">Only compatible circular zones and their arrival and exit rules are shared. Your other saved zones and rules stay available in Office.</p>
      {!!review.skipped && <p className="focus-footnote">{review.skipped} {review.skipped === 1 ? 'zone is' : 'zones are'} outside phone coverage.</p>}
      {!!review.config.zones.length && <ul className="focus-zone-events">
        {review.config.zones.map(zone => <li key={zone.id}><span>{zoneLabel(zone)}</span><span>{radiusLabel(zone.radius)}</span></li>)}
      </ul>}
      <div className="focus-actions">
        <button type="button" className="focus-button focus-primary" disabled={busy}
          onClick={async () => { if (await sync.save(review.config, review.revision)) setReview(null); }}>Save phone configuration</button>
        <button type="button" className="focus-button" onClick={() => setReview(null)}>Cancel</button>
      </div>
    </>}
    {snapshot?.config && <>
      {!phone && <button type="button" className="focus-button focus-primary" disabled={busy}
        onClick={() => void sync.pair()}>Generate pairing code</button>}
      {pairing && !phone && <p role="status">Pairing code <strong>{pairing.code}</strong> · Expires {new Date(pairing.expiresAt).toLocaleTimeString()}</p>}
      {phone?.awaitingConfirmation && <>
        <label className="focus-select">Confirmation code shown on your phone
          <input type="text" value={confirmation} autoComplete="off" maxLength={8}
            onChange={event => setConfirmation(event.target.value.replace(/[^0-9a-f]/gi, '').toUpperCase())} />
        </label>
        <div className="focus-actions">
          <button type="button" className="focus-button focus-primary" disabled={busy || confirmation.length !== 8}
            onClick={async () => { if (await sync.confirmPhone(confirmation)) setConfirmation(''); }}>Confirm phone</button>
          <button type="button" className="focus-button" disabled={busy} onClick={() => void sync.disconnect()}>Cancel pairing</button>
        </div>
      </>}
      {phone && !phone.awaitingConfirmation && <>
        <div className="focus-zone-status" role="status">
          <span className="focus-dot" data-location={phone.status === 'monitoring' ? 'inside' : undefined} />
          <div>{phone.platform === 'ios' ? 'iPhone' : 'Android'} · {deviceStatus[phone.status]}
            <small>{phone.scopes.zones && phone.appliedRevision !== snapshot.revision ? 'Zone changes pending on phone · ' : ''}Last contact {new Date(phone.seenAt).toLocaleString()}</small>
          </div>
        </div>
        {phone.scopes.zones && <ul className="focus-zone-events">{snapshot.config.zones.map(zone => <li key={zone.id}>
          <span>{zoneLabel(zone)}</span><span>{phone.appliedRevision !== snapshot.revision ? 'Pending' : !phone.registered.includes(zone.id)
            ? 'Inactive on phone' : phone.states?.[zone.id] === true ? 'Last inside' : phone.states?.[zone.id] === false ? 'Last outside' : 'Registered'}</span>
        </li>)}</ul>}
        {phone.scopes.precision && <p>{fix
          ? `Last ${phone.scopes.precision} fix · ${coordinateLabel(fix)} · ±${Math.ceil(fix.accuracy)} m · ${new Date(fix.timestamp).toLocaleTimeString()}`
          : 'Waiting for a shared fix.'}</p>}
        <div className="focus-actions">
          <button type="button" className="focus-button" aria-pressed={Boolean(audioEnabledAt)} onClick={onToggleAudio}>
            {audioEnabledAt ? 'Turn off phone-triggered sound' : 'Allow phone-triggered sound in this tab'}
          </button>
          <button type="button" className="focus-button" disabled={busy}
            onClick={async () => { if (await sync.disconnect()) setDisconnectNotice(true); }}>Disconnect phone</button>
        </div>
        {audioError && <p role="status" className="focus-footnote">{audioError}</p>}
      </>}
      <button type="button" className="focus-button" disabled={busy} onClick={() => {
        if (window.confirm('Delete your shared Focus zones and disconnect the phone?')) void sync.disconnect(true);
      }}>Delete phone configuration</button>
    </>}
    {officeAccess && <button type="button" className="focus-button" disabled={busy} onClick={() => void sync.refresh()}>Refresh phone status</button>}
  </section>;
}
