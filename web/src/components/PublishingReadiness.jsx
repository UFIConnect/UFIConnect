import { SOURCE_META } from './sourceMeta';

export default function PublishingReadiness({ plan, group = false, onRemove, disabled = false }) {
  const name = source => source === 'local' ? group ? 'This group' : 'UFIConnect' : SOURCE_META[source]?.label || source;
  return <div style={{ display: 'grid', gap: 10, marginTop: 14, fontSize: '.8rem' }}>
    <section aria-label="Ready destinations">
      <strong>Ready to publish ({plan.ready.length})</strong>
      <p style={{ margin: '5px 0 0' }}>{plan.ready.length ? plan.ready.map(name).join(' · ') : 'Complete a destination’s requirements to publish.'}</p>
    </section>
    {plan.pending.length > 0 && <section aria-label="Pending destinations">
      <strong>Not sent in this batch ({plan.pending.length})</strong>
      <p style={{ color: 'var(--muted)', margin: '5px 0' }}>These selected destinations stay in your draft while ready destinations publish.</p>
      <ul style={{ paddingLeft: 20, margin: 0 }}>
        {plan.pending.map(({ platform, reason }) => <li key={platform} style={{ marginTop: 6 }}>
          <strong>{name(platform)}</strong>: {reason}
          {onRemove && <button type="button" className="btn btn-ghost btn-sm" disabled={disabled}
            aria-label={`Remove ${name(platform)} destination`} onClick={() => onRemove(platform)}>Remove</button>}
        </li>)}
      </ul>
    </section>}
  </div>;
}
