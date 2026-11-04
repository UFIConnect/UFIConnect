import { operationNumber as num, operationDate as date } from './operations-runtime.mjs';

export default function UnknownTopicGuardian({ guardian, unknownLive }) {
  if (!guardian) return null;
  const live = guardian.unknownLive ?? unknownLive;
  const ceiling = guardian.ceiling ?? 500;
  const status = guardian.status ? String(guardian.status).replaceAll('_', ' ') : guardian.enabled ? 'Enabled' : 'Paused';
  const warning = guardian.lastError || (live != null && Number(live) > ceiling);
  return <section className="op-card" aria-label="Unknown topic guardian">
    <div className="op-heading"><h2>Unknown topic guardian</h2><span className={`op-tag ${warning ? 'rejected' : guardian.enabled ? 'approved' : 'held'}`}>{status}</span></div>
    <p>Automatically reviews stored posts and assigns topics using content evidence.</p>
    <div className="op-stats">{[['Unknown live',live],['Target',guardian.target ?? 0],['Maximum',ceiling],['Held for review',guardian.heldForReview]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{num(value)}</strong></div>)}</div>
    {live != null && Number(live) > ceiling && <p role="status">The live Unknown count is above the {num(ceiling)} limit. {guardian.enabled ? 'The agent is working through the backlog.' : 'Automatic cleanup is paused.'}</p>}
    {Number(guardian.heldForReview) > 0 && <p>{num(guardian.heldForReview)} posts are held for topic review. Their content is preserved and they stay out of the live feed until classified.</p>}
    <p>Last run: {date(guardian.lastRun)}{Number(guardian.intervalMs) > 0 ? ` · Checks every ${num(Number(guardian.intervalMs) / 1000)} seconds` : ''}.</p>
    {guardian.lastRun && <p>Latest run: {num(guardian.lastChecked)} checked · {num(guardian.lastClassified)} classified · {num(guardian.lastHeld)} held for review.</p>}
    {guardian.lastError && <div className="op-error" role="alert">{guardian.lastError}</div>}
  </section>;
}
