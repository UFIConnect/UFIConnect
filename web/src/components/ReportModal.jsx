import { useState } from 'react';
import client from '../api/client';

// child_safety listed first, not alphabetically or by expected frequency —
// this is the one category Play Store's child-safety policy specifically
// requires a real reporting path for (see backend's REPORT_REASONS/
// sendChildSafetyAlertEmail), so it shouldn't be buried in the list.
const REPORT_REASONS = [
  { value: 'child_safety', label: 'Child safety concern' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'inappropriate', label: 'Inappropriate or offensive content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Other' },
];

// Shared across every surface that can be reported (a post, a comment, a
// user profile) rather than one-off report UIs per page — same targetType/
// targetId shape POST /reports expects either way.
export default function ReportModal({ targetType, targetId, targetLabel, onClose, onSubmitted }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit() {
    if (!reason) { setError('Choose a reason.'); return; }
    setSubmitting(true);
    setError('');
    try {
      await client.post('/reports', { targetType, targetId, reason, details: details.trim() || undefined });
      setDone(true);
      onSubmitted?.();
    } catch {
      setError('Something went wrong — please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: 'var(--card)', borderRadius: 14, padding: 20, width: '100%', maxWidth: 420,
        boxShadow: '0 12px 40px rgba(0,0,0,.25)',
      }}>
        {done ? (
          <>
            <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem' }}>Report submitted</h3>
            <p style={{ margin: '0 0 16px', fontSize: '.85rem', color: 'var(--muted)', lineHeight: 1.5 }}>
              Thanks — our team will review this. {reason === 'child_safety' && "Reports involving a child's safety are flagged for immediate review."}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn-primary btn-sm" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>Report {targetLabel || targetType}</h3>
            <p style={{ margin: '0 0 14px', fontSize: '.82rem', color: 'var(--muted)' }}>
              Our team reviews every report.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              {REPORT_REASONS.map(r => (
                <label
                  key={r.value}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8,
                    border: `1.5px solid ${reason === r.value ? 'var(--primary)' : 'var(--border)'}`,
                    cursor: 'pointer', fontSize: '.85rem',
                  }}
                >
                  <input type="radio" name="report-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
                  {r.label}
                </label>
              ))}
            </div>
            <textarea
              value={details}
              onChange={e => setDetails(e.target.value)}
              placeholder="Any additional details (optional)"
              rows={3}
              maxLength={1000}
              style={{
                width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8,
                border: '1.5px solid var(--border)', fontSize: '.85rem', resize: 'vertical',
                marginBottom: 10, fontFamily: 'inherit',
              }}
            />
            {error && <div style={{ color: 'var(--danger)', fontSize: '.8rem', marginBottom: 10 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={submitting}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={submit} disabled={submitting || !reason}>
                {submitting ? 'Submitting…' : 'Submit report'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
