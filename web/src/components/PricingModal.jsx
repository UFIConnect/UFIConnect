// Exported so other pages (e.g. Landing's pricing section) can render the
// same names/prices without retyping them somewhere they'd drift out of sync.
export const TIERS = [
  {
    tier: 'pro',
    name: 'Pro',
    price: '19.94',
    tagline: 'For individuals',
    icon: '⭐',
  },
  {
    tier: 'business',
    name: 'Business',
    price: '199.94',
    tagline: 'For teams',
    icon: '🏢',
    locked: true,
    note: 'Final pricing is based on how many employers your business has logged.',
  },
];

// Same overlay/card shape as ReportModal — the established pattern every
// modal in this app already uses. Tier descriptions are deliberately just
// name/price/tagline, not a feature list — nothing is actually gated by
// plan yet (this is the payment/tier infrastructure ahead of a real
// feature), so listing specific perks here would be a promise nothing
// behind it can keep.
export default function PricingModal({ onClose, onSelectTier, loadingTier }) {
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: 'var(--card)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480,
        boxShadow: '0 12px 40px rgba(0,0,0,.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Upgrade UFIconnect</h3>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ all: 'unset', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--muted)', padding: 4 }}
          >✕</button>
        </div>
        <p style={{ margin: '0 0 20px', fontSize: '.85rem', color: 'var(--muted)' }}>
          Choose a plan to support UFIconnect and unlock what's coming next.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {TIERS.map(t => (
            <div
              key={t.tier}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px',
                borderRadius: 12, border: '1.5px solid var(--border)',
                opacity: t.locked ? 0.6 : 1,
              }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '1.3rem',
              }}>{t.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '.95rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t.name}
                  {t.locked && (
                    <span style={{
                      fontSize: '.65rem', fontWeight: 700, color: 'var(--muted)',
                      background: 'var(--bg-secondary)', borderRadius: 6, padding: '2px 6px',
                    }}>COMING SOON</span>
                  )}
                </div>
                <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: 2 }}>{t.tagline}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>${t.price}</div>
                <div style={{ fontSize: '.68rem', color: 'var(--muted)' }}>/month</div>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!!loadingTier || t.locked}
                onClick={() => onSelectTier(t.tier)}
                style={{ flexShrink: 0 }}
              >
                {t.locked ? 'Locked' : (loadingTier === t.tier ? '…' : 'Choose')}
              </button>
            </div>
          ))}
        </div>
        {TIERS.filter(t => t.note).map(t => (
          <p key={t.tier} style={{ margin: '12px 2px 0', fontSize: '.72rem', color: 'var(--muted)', fontStyle: 'italic' }}>
            {t.name}: {t.note}
          </p>
        ))}
      </div>
    </div>
  );
}
