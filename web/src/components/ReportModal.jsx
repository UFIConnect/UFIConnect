import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import client from '../api/client';
import './ReportModal.css';

const REPORT_REASONS = [
  { value: 'child_safety', label: 'Child safety concern' },
  { value: 'copyright', label: 'Copyright or intellectual property' },
  { value: 'nonconsensual_intimate', label: 'Intimate imagery shared without consent' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'inappropriate', label: 'Inappropriate or offensive content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Other' },
];

export default function ReportModal({ targetType, targetId, targetLabel, source, sourceUrl, signInRequired = false, onClose, onSubmitted }) {
  const titleId = useId(), detailsId = useId(), groupId = useId();
  const dialog = useRef(null), close = useRef(onClose), busy = useRef(false);
  close.current = onClose;
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');

  useEffect(() => {
    const previous = document.activeElement;
    const keydown = event => {
      if (event.key === 'Escape' && !busy.current) { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = [...(dialog.current?.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled)') || [])];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    dialog.current?.focus();
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus?.(); };
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (!reason || busy.current) return;
    busy.current = true;
    setSubmitting(true); setError('');
    try {
      const { data } = await client.post('/reports', { targetType, targetId, reason, details: details.trim() || undefined, source, sourceUrl });
      if (!data?.ok || !data?.id) throw new Error('Receipt unavailable');
      setReceipt(data.id);
      onSubmitted?.();
    } catch (failure) {
      setError(failure?.response?.data?.message || 'The report could not be saved. Please try again.');
    } finally { busy.current = false; setSubmitting(false); }
  }

  return createPortal(
    <div className="report-overlay" onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <section ref={dialog} className="report-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId}>{receipt ? 'Report submitted' : `Report ${targetLabel || targetType}`}</h2>
        {receipt ? <>
          <p>Your report is saved in the UFIConnect review queue.</p>
          <p className="report-reference">Reference: {receipt}</p>
          <p>This does not send a takedown request to another service or automatically remove content.</p>
          <div className="report-buttons"><button className="btn btn-primary btn-sm" onClick={onClose}>Done</button></div>
        </> : signInRequired ? <>
          <p>Sign in to send a report to the UFIConnect review queue. You can also use the public policy pages to contact us without an account.</p>
          <p><Link to="/copyright" onClick={onClose}>Copyright notices and counter-notices</Link> · <Link to="/child-safety" onClick={onClose}>Child safety</Link> · <Link to="/policies#reporting" onClick={onClose}>Other concerns</Link></p>
          <div className="report-buttons"><button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button><Link className="btn btn-primary btn-sm" to="/login" onClick={onClose}>Sign in</Link></div>
        </> : <form onSubmit={submit}>
          <p>Reports are reviewed by UFIConnect. For content from another service, you can also use that service’s reporting tools.</p>
          <fieldset disabled={submitting}><legend>Reason for reporting</legend>
            {REPORT_REASONS.map(item => <label className="report-reason" key={item.value}>
              <input type="radio" name={groupId} value={item.value} checked={reason === item.value} onChange={() => setReason(item.value)} required />{item.label}
            </label>)}
          </fieldset>
          {reason === 'copyright' && <p><Link to="/copyright" onClick={onClose}>Submit a formal copyright notice or counter-notice</Link>. This quick report starts an internal review and is not a complete legal notice.</p>}
          <label htmlFor={detailsId}>Additional details (optional)</label>
          <textarea id={detailsId} value={details} onChange={event => setDetails(event.target.value)} rows={3} maxLength={1000} disabled={submitting} />
          <p className="report-help">Share a link or a description. Do not upload intimate images, child sexual abuse material, passwords, or other people’s private contact details.</p>
          {error && <p className="report-error" role="alert">{error}</p>}
          <div className="report-buttons"><button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={submitting}>Cancel</button><button type="submit" className="btn btn-primary btn-sm" disabled={submitting || !reason}>{submitting ? 'Submitting…' : 'Submit report'}</button></div>
        </form>}
      </section>
    </div>, document.body,
  );
}
