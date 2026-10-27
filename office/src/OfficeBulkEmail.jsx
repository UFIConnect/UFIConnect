import { useEffect, useRef, useState } from 'react';
import EmailTemplatePicker from './EmailTemplatePicker.jsx';
import { emailDraftError, EXCLUSION_LABELS, excludedRecipientCount, pendingRecipientIds, templatePlaceholders } from './office-email-templates.mjs';

const statusNames = { accepted: 'Accepted by mail service', failed: 'Failed', uncertain: 'Delivery uncertain', sending: 'Submission in progress', skipped: 'Skipped', limited: 'Waiting for rate limit', interrupted: 'Submission interrupted' };

export default function OfficeBulkEmail({ apiBase, request, preview, onClose, onSendingChange }) {
  const [subject, setSubject] = useState(''), [message, setMessage] = useState(''), [template, setTemplate] = useState('');
  const [phase, setPhase] = useState('compose'), [campaign, setCampaign] = useState(null), [error, setError] = useState(''), [reviewed, setReviewed] = useState(false), [now, setNow] = useState(Date.now), [blocked, setBlocked] = useState(false);
  const active = useRef(false), generation = useRef(0), campaignRef = useRef(null);
  const placeholders = templatePlaceholders(subject, message), draftError = emailDraftError(subject, message);
  const pending = campaign ? pendingRecipientIds(campaign) : [], excluded = excludedRecipientCount(preview.excluded);
  const limitedUntil = campaign?.retryAt || 0;
  useEffect(() => {
    const cancel = () => { generation.current++; active.current = false; onSendingChange(false); };
    window.addEventListener('office-token-changed', cancel);
    return () => { cancel(); window.removeEventListener('office-token-changed', cancel); };
  }, [onSendingChange]);
  useEffect(() => {
    if (!active.current && !pending.length) return;
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [phase, pending.length]);
  useEffect(() => { if (!limitedUntil || now >= limitedUntil) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, [limitedUntil, now >= limitedUntil]);
  function updateCampaign(value) { campaignRef.current = value; setCampaign(value); }
  function review(event) {
    event.preventDefault(); if (draftError) { setError(draftError); return; }
    updateCampaign({ requestId: crypto.randomUUID(), selectionToken: preview.selectionToken, recipients: preview.recipients.map(recipient => ({ ...recipient })), subject: subject.trim(), message: message.trim(), results: {}, retryAt: 0 });
    setReviewed(false); setError(''); setPhase('review');
  }
  async function send() {
    if (active.current || !campaignRef.current || !reviewed || blocked || Date.now() < (campaignRef.current.retryAt || 0)) return;
    const currentCampaign = campaignRef.current, ids = pendingRecipientIds(currentCampaign);
    if (!ids.length || !window.confirm(`Send "${currentCampaign.subject}" to ${ids.length} reviewed recipients still awaiting submission?`)) return;
    active.current = true; onSendingChange(true); setPhase('sending'); setError('');
    const current = ++generation.current;
    try {
      const batchSize = Math.max(1, Math.min(5, Number(preview.batchSize) || 5));
      for (let offset = 0; offset < ids.length && generation.current === current; offset += batchSize) {
        const userIds = ids.slice(offset, offset + batchSize);
        let body, response, timer;
        const controller = new AbortController();
        try {
          const loaded = await Promise.race([(async () => {
            const response = await request(`${apiBase}/office/users/email/batch`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: currentCampaign.requestId, selectionToken: currentCampaign.selectionToken, userIds, subject: currentCampaign.subject, message: currentCampaign.message, confirmed: true }) });
            return { response, body: await response.json() };
          })(), new Promise((_, reject) => { timer = window.setTimeout(() => { controller.abort(); reject(new Error('The submission response timed out.')); }, 45000); })]);
          ({ response, body } = loaded);
          if (!response.ok || !Array.isArray(body.results)) throw new Error(body.message || 'The batch response could not be confirmed.');
          if (body.results.length !== userIds.length || userIds.some(id => body.results.filter(result => result.userId === id).length !== 1) || body.results.some(result => !Object.hasOwn(statusNames, result.status) || result.status === 'interrupted')) throw new Error('The batch response was incomplete.');
        } catch (failure) {
          if (generation.current !== current) return;
          const latest = campaignRef.current, results = { ...latest.results };
          for (const id of userIds) results[id] = { userId: id, status: 'interrupted', message: 'The response was interrupted. Resume with the same submission ID to avoid a duplicate.' };
          const retryAfter = response?.status === 429 ? Math.max(1, Number(response.headers?.get('Retry-After')) || Number(body?.retryAfter) || 60) : 0;
          updateCampaign({ ...latest, results, retryAt: retryAfter ? Date.now() + retryAfter * 1000 : latest.retryAt });
          if ([400, 403, 409, 422].includes(response?.status)) setBlocked(true);
          setError(`${failure.message || 'Connection interrupted.'} No further batches were submitted.`);
          break;
        } finally { window.clearTimeout(timer); }
        if (generation.current !== current) return;
        const latest = campaignRef.current, results = { ...latest.results };
        for (const result of body.results) results[result.userId] = result;
        const delay = Math.max(Number(body.retryAfter) || 0, ...body.results.map(result => Number(result.retryAfter) || 0));
        updateCampaign({ ...latest, results, retryAt: body.results.some(result => result.status === 'limited') ? Date.now() + (delay > 0 ? delay : 60) * 1000 : 0 });
        if (body.results.some(result => result.status === 'limited')) break;
      }
    } finally {
      if (generation.current === current) { active.current = false; onSendingChange(false); setPhase('results'); setNow(Date.now()); }
    }
  }
  const results = Object.values(campaign?.results || {}), finished = results.filter(result => !['limited', 'interrupted'].includes(result.status)).length;
  return <section className="ou-composer ou-bulk-composer" aria-label="Email selected accounts">
    <div className="ou-heading"><h3>Email selected accounts</h3><button type="button" disabled={phase === 'sending'} onClick={() => { if (!pending.length || window.confirm('Close this email? Any recipients still awaiting submission will not receive it.')) onClose(); }}>Close email</button></div>
    <p>{preview.recipients.length} eligible recipients. {excluded} excluded.{excluded > 0 && <> {Object.entries(preview.excluded || {}).filter(([, value]) => value > 0).map(([key, value]) => `${value} ${EXCLUSION_LABELS[key] || key}`).join('; ')}.</>}</p>
    {error && <p role="alert" className="ou-error">{error}</p>}
    {phase === 'compose' && <form onSubmit={review}>
      <EmailTemplatePicker value={template} onChange={chosen => { setTemplate(chosen?.id || ''); if (chosen) { setSubject(chosen.subject); setMessage(chosen.message); } setError(''); }} />
      <label>Subject<input aria-label="Subject" required maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} /></label>
      <label>Message<textarea aria-label="Message" required maxLength={10000} rows={12} value={message} onChange={event => setMessage(event.target.value)} /></label>
      {placeholders.length > 0 && <p className="ou-warning">Replace these fields: {placeholders.join(', ')}</p>}
      <button disabled={Boolean(draftError) || !preview.emailAvailable || !preview.recipients.length}>Review recipients and message</button>
    </form>}
    {campaign && <>
      <h4>Review recipients and message</h4>
      <p>This list and message are fixed for this submission. Later account signups are not added.</p>
      <div className="ou-recipient-preview" role="region" aria-label="Reviewed email recipients" tabIndex={0}><ul>{campaign.recipients.map(recipient => <li key={recipient.id}><strong>{recipient.name}</strong> <span>{recipient.email}</span></li>)}</ul></div>
      <p><strong>Subject:</strong> {campaign.subject}</p><pre className="ou-message-preview">{campaign.message}</pre>
      {phase === 'review' && <><label className="ou-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I have reviewed every recipient, the subject and the complete message.</label><div className="ou-tools"><button type="button" onClick={() => { updateCampaign(null); setPhase('compose'); setReviewed(false); }}>Edit message</button><button type="button" disabled={!reviewed || !preview.emailAvailable} onClick={send}>Send to {campaign.recipients.length} recipients</button></div></>}
      {['sending', 'results'].includes(phase) && <div className="ou-email-progress"><h4>Submission progress</h4><progress max={campaign.recipients.length} value={finished} aria-label="Email submission progress" /><p role="status">{finished} of {campaign.recipients.length} processed; {pending.length} awaiting submission. {results.filter(result => result.status === 'accepted').length} accepted by the mail service.</p>
        <p>Mail-service acceptance does not confirm delivery. Uncertain or already recorded submissions are not sent again. Keep this page open while batches are submitting.</p>
        {results.length > 0 && <ul>{campaign.recipients.filter(recipient => campaign.results[recipient.id]).map(recipient => { const result = campaign.results[recipient.id]; return <li key={recipient.id}><strong>{recipient.email}</strong>: {statusNames[result.status]}{result.message ? ` — ${result.message}` : ''}</li>; })}</ul>}
        {phase === 'results' && pending.length > 0 && <><p>{blocked ? 'The server stopped this submission. Review the error before creating another message; earlier accepted or uncertain submissions must not be duplicated.' : 'Resume checks recorded submissions and sends recipients not yet submitted, using the same submission ID and reviewed message.'}</p><button type="button" disabled={blocked || now < limitedUntil} onClick={send}>{now < limitedUntil ? `Resume available in ${Math.ceil((limitedUntil - now) / 1000)} seconds` : 'Resume remaining submissions'}</button></>}
      </div>}
    </>}
  </section>;
}
