// Exported so other pages (e.g. Landing's pricing section) can render the
// same names/prices without retyping them somewhere they'd drift out of sync.
import { useEffect, useState } from 'react';
import client from '../api/client';

export const TIERS = [
  {
    tier: 'pro',
    name: 'Pro',
    price: '19.94',
    tagline: 'For individuals',
    icon: 'Pro',
  },
  {
    tier: 'business',
    name: 'Business',
    price: '199.94',
    tagline: 'For hiring teams',
    icon: 'Biz',
    locked: true,
    note: 'Career sources, role-matched opportunities, and hiring workflows.',
  },
];

// Same overlay/card shape as ReportModal — the established pattern every
// modal in this app already uses. Checkout availability still comes from the
// backend, so a visible tier cannot be purchased until its Stripe Price is
// configured in Render.
export default function PricingModal({ onClose, onSelectTier, loadingTier }) {
  const [billingConfig, setBillingConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;
    client.get('/billing/config')
      .then(({ data }) => { if (!cancelled) setBillingConfig(data); })
      .catch(() => { if (!cancelled) setBillingConfig({}); });
    return () => { cancelled = true; };
  }, []);

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
          >Close</button>
        </div>
        <p style={{ margin: '0 0 20px', fontSize: '.85rem', color: 'var(--muted)' }}>
          Choose the membership that fits the work you want to do.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {TIERS.map(t => {
            const businessSetupPending = t.tier === 'business' && billingConfig && !billingConfig.tiers?.business;
            const unavailable = Boolean(t.locked || businessSetupPending);
            const unavailableLabel = t.locked ? 'COMING SOON' : businessSetupPending ? 'SETUP PENDING' : '';
            return (
            <div
              key={t.tier}
              style={{
                display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px',
                borderRadius: 12, border: '1.5px solid var(--border)',
                opacity: unavailable ? 0.6 : 1,
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
                  {unavailable && (
                    <span style={{
                      fontSize: '.65rem', fontWeight: 700, color: 'var(--muted)',
                      background: 'var(--bg-secondary)', borderRadius: 6, padding: '2px 6px',
                    }}>{unavailableLabel}</span>
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
                disabled={!!loadingTier || unavailable}
                onClick={() => onSelectTier(t.tier)}
                style={{ flexShrink: 0 }}
              >
                {unavailable ? 'Unavailable' : (loadingTier === t.tier ? '...' : 'Choose')}
              </button>
            </div>
            );
          })}
        </div>
        {TIERS.filter(t => t.note).map(t => (
          <p key={t.tier} style={{ margin: '12px 2px 0', fontSize: '.72rem', color: 'var(--muted)', fontStyle: 'italic' }}>
            {t.name}: {t.note}
          </p>
        ))}
        {TIERS.some(t => t.tier === 'business' && t.locked) ? (
          <p style={{ margin: '8px 2px 0', fontSize: '.72rem', color: 'var(--muted)' }}>
            Business membership is coming soon.
          </p>
        ) : billingConfig && !billingConfig.tiers?.business && (
          <p style={{ margin: '8px 2px 0', fontSize: '.72rem', color: 'var(--muted)' }}>
            Business checkout activates automatically once its Stripe Price is configured.
          </p>
        )}
      </div>
    </div>
  );
}
