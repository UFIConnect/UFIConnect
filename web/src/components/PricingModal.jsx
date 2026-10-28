// Exported so other pages (e.g. Landing's pricing section) can render the
// same names/prices without retyping them somewhere they'd drift out of sync.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import useBillingConfig from '../hooks/useBillingConfig';
import { isNativeRuntime } from '../nativeRuntime.mjs';
import { useAuth } from '../contexts/AuthContext';
import { isBusinessAccount, membershipTiersForAccount } from '../businessAccount.mjs';
import './PricingModal.css';

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
    tagline: 'For recruiting companies',
    icon: 'Biz',
    note: 'One person: $199.94/month. Teams of 2 or more: $19.94 per person/month. Includes a workspace for recruiting and career sources.',
  },
];

// Same overlay/card shape as ReportModal — the established pattern every
// modal in this app already uses. Checkout availability still comes from the
// backend, so a visible tier cannot be purchased until its Stripe Price is
// configured in Render.
export default function PricingModal({ onClose, onSelectTier, loadingTier, error }) {
  const { profile } = useAuth();
  const businessAccount = isBusinessAccount(profile);
  const allowedTiers = membershipTiersForAccount(profile);
  const visibleTiers = TIERS.filter(tier => allowedTiers.includes(tier.tier));
  const { config: billingConfig, error: configError, refresh: refreshBilling } = useBillingConfig();
  const [businessPeople, setBusinessPeople] = useState('1');
  const closeButton = useRef(null);

  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => previous?.focus?.();
  }, []);

  if (isNativeRuntime()) return <div className="membership-modal-backdrop"><div className="membership-modal" role="dialog" aria-modal="true" aria-label="Membership"><p>Your existing membership determines the tools available in this app.</p><button ref={closeButton} type="button" onClick={onClose}>Close</button></div></div>;
  return (
    <div
      className="membership-modal-backdrop"
      onKeyDown={event => {
        if (event.key === 'Escape' && !loadingTier) onClose();
        if (event.key !== 'Tab') return;
        const controls = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), a[href]')];
        const first = controls[0]; const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="membership-title" className="membership-modal" style={{
        background: 'var(--card)', borderRadius: 14, padding: 24, width: '100%', maxWidth: 480,
        boxShadow: '0 12px 40px rgba(0,0,0,.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
          <h3 id="membership-title" style={{ margin: 0, fontSize: '1.15rem' }}>{businessAccount ? 'Business membership' : 'Upgrade UFIconnect'}</h3>
          <button
            ref={closeButton}
            onClick={onClose}
            aria-label="Close"
            style={{ all: 'unset', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--muted)', padding: 4 }}
          >Close</button>
        </div>
        <p style={{ margin: '0 0 20px', fontSize: '.85rem', color: 'var(--muted)' }}>
          {businessAccount ? 'Choose the number of people covered by your Business membership.' : 'Add Pro tools to your personal account.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visibleTiers.map(t => {
            const quantity = t.tier === 'business' ? Number(businessPeople) : 1;
            const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= 100;
            const priceTier = t.tier === 'business' && quantity >= 2 ? 'business_team' : t.tier;
            const pricing = billingConfig?.pricing?.[priceTier];
            const available = validQuantity && billingConfig?.paymentsReady === true && billingConfig?.tiers?.[priceTier] === true && pricing?.active === true && pricing?.display && pricing?.interval;
            const unavailable = !available;
            const unavailableLabel = !billingConfig ? 'CHECKING' : !available ? 'UNAVAILABLE' : '';
            const cadence = pricing?.intervalCount > 1 ? `every ${pricing.intervalCount} ${pricing.interval}s` : `every ${pricing?.interval}`;
            return (
            <div
              key={t.tier}
              className="membership-plan"
              style={{
                alignItems: 'center', gap: 14, padding: '16px 18px',
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
                <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{pricing?.display && validQuantity ? t.tier === 'business' ? new Intl.NumberFormat('en-US', { style: 'currency', currency: pricing.currency }).format(pricing.unitAmount * quantity / 100) : pricing.display : '—'}</div>
                <div style={{ fontSize: '.68rem', color: 'var(--muted)' }}>{pricing?.interval ? cadence : 'Price unavailable'}</div>
                {t.tier === 'business' && quantity >= 2 && <div style={{ fontSize: '.68rem', color: 'var(--muted)' }}>Total for {quantity} people</div>}
              </div>
              {t.tier === 'business' && <label style={{ display: 'grid', gridColumn: '2 / -1', gap: 6, fontSize: '.78rem' }}>Number of people, including you
                <input type="number" min="1" max="100" step="1" value={businessPeople} disabled={!!loadingTier} onChange={event => setBusinessPeople(event.target.value)} style={{ width: 90, padding: 8 }} />
                <span>{quantity >= 2 ? '$19.94 per person/month (2–100 people)' : '$199.94/month for one person'}</span>
                {!validQuantity && <span role="alert">Enter a whole number from 1 to 100.</span>}
              </label>}
              <button
                type="button"
                className="btn btn-primary btn-sm membership-choose"
                disabled={!!loadingTier || unavailable}
                onClick={() => onSelectTier(t.tier, quantity)}
                style={{ flexShrink: 0 }}
              >
                {unavailable ? 'Unavailable' : (loadingTier === t.tier ? 'Opening checkout…' : `Choose ${t.name}`)}
              </button>
            </div>
            );
          })}
        </div>
        <p className="membership-terms">Memberships renew automatically at the price and interval shown. Review the total, including any applicable tax, in Stripe before paying. Manage payment methods and cancel from Settings → Manage billing.</p>
        <p className="membership-terms">Card details are entered on Stripe’s secure checkout. By subscribing, you agree to our <Link to="/terms" onClick={onClose}>Terms of Service</Link>. Read our <Link to="/privacy" onClick={onClose}>Privacy Policy</Link>.</p>
        {error && <p role="alert" className="auth-error">{error}</p>}
        {!billingConfig && <p role="status">Loading current membership prices…</p>}
        {configError ? <p role="status">{configError}</p> : billingConfig && !billingConfig.paymentsReady && <p role="status">Membership checkout is currently unavailable. Please try again later.</p>}
        {billingConfig && (!billingConfig.paymentsReady || (businessAccount ? ['business', 'business_team'] : ['pro']).some(tier => !billingConfig.tiers?.[tier])) && <button type="button" className="btn btn-ghost btn-sm" disabled={!!loadingTier} onClick={refreshBilling}>Check billing availability</button>}
        {visibleTiers.filter(t => t.note).map(t => (
          <p key={t.tier} style={{ margin: '12px 2px 0', fontSize: '.72rem', color: 'var(--muted)', fontStyle: 'italic' }}>
            {t.name}: {t.note}
          </p>
        ))}
        {businessAccount && billingConfig && !configError && !billingConfig.tiers?.business && (
          <p style={{ margin: '8px 2px 0', fontSize: '.72rem', color: 'var(--muted)' }}>
            Business checkout is currently unavailable. Please check again later.
          </p>
        )}
      </div>
    </div>
  );
}
