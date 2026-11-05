import { useCallback, useEffect, useRef, useState } from 'react';
import { reportDays } from './analytics-model.mjs';
import { useOfficePageVisible } from './useOfficePolling.js';
import OfficeBulkEmail from './OfficeBulkEmail.jsx';
import EmailTemplatePicker from './EmailTemplatePicker.jsx';
import { emailDraftError, excludedRecipientCount, templatePlaceholders } from './office-email-templates.mjs';
import './office-users.css';
import UserUsage from './UserUsage';

const number = value => Number(value || 0).toLocaleString();
const date = value => value ? new Date(value).toLocaleString() : '—';
const utcDay = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : '';
const outcomeNames = { created: 'Account created', invalid: 'Invalid form', duplicate: 'Already registered', limited: 'Rate limited', unavailable: 'Storage unavailable', failed: 'Other failure' };
const initialAccount = () => {
  const value = new URLSearchParams(window.location.search).get('account') || '';
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value) ? value : '';
};

function SelectionCheckbox({ checked, partial = false, ...props }) {
  const input = useRef(null);
  useEffect(() => { if (input.current) input.current.indeterminate = partial; }, [partial]);
  return <input {...props} ref={input} type="checkbox" checked={checked} />;
}

export default function OfficeUsers({ apiBase, request, active = true }) {
  const visible = useOfficePageVisible();
  const [usageUser, setUsageUser] = useState(null);
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(true);
  const [query, setQuery] = useState(initialAccount), [search, setSearch] = useState(initialAccount), [state, setState] = useState('all'), [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [days, setDays] = useState(() => initialAccount() ? 'all' : 'since_may');
  const [cache, setCache] = useState(null), [acting, setActing] = useState(false);
  const [recipient, setRecipient] = useState(null), [subject, setSubject] = useState(''), [message, setMessage] = useState(''), [delivery, setDelivery] = useState(null), [history, setHistory] = useState([]);
  const [emailTemplate, setEmailTemplate] = useState('');
  const [selected, setSelected] = useState({}), [selectionSummary, setSelectionSummary] = useState(null), [selectionBusy, setSelectionBusy] = useState(false), [selectionError, setSelectionError] = useState('');
  const [bulkPreview, setBulkPreview] = useState(null), [bulkSending, setBulkSending] = useState(false);
  const selectionGeneration = useRef(0);
  const generation = useRef(0), emailGeneration = useRef(0), emailRequest = useRef(null);
  const selectedIds = Object.keys(selected), pageRecipients = (data?.recent || []).filter(user => user.email);
  const selectedOnPage = pageRecipients.filter(user => selected[user.id]).length;
  const locked = acting || bulkSending;
  const registrationCounts = new Map((data?.registrationHistory?.daily || []).map(row => [row.day, row]));
  const registrationDays = data?.registrationHistory ? reportDays({ range: data.registrationHistory }) : [];
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const change = () => { generation.current++; emailGeneration.current++; selectionGeneration.current++; setData(null); setCache(null); setRecipient(null); setUsageUser(null); setHistory([]); setDelivery(null); setSubject(''); setMessage(''); setEmailTemplate(''); setSelected({}); setSelectionSummary(null); setBulkPreview(null); setSelectionBusy(false); setSelectionError(''); refresh(); };
    window.addEventListener('office-token-changed', change);
    return () => { generation.current++; emailGeneration.current++; selectionGeneration.current++; window.removeEventListener('office-token-changed', change); };
  }, [refresh]);
  useEffect(() => {
    if (!active || !visible) return;
    const controller = new AbortController(), current = ++generation.current;
    setBusy(true); setError(''); setData(null);
    const params = new URLSearchParams({ page: String(page), q: search, state, days });
    request(`${apiBase}/office/users?${params}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const body = await response.json();
      if (!response.ok || !body.available || !Array.isArray(body.recent)) throw new Error(body.message || 'Account records could not be loaded.');
      if (generation.current === current) setData(body);
    }).catch(error => { if (generation.current === current && error.name !== 'AbortError') setError(error.message); })
      .finally(() => { if (generation.current === current) setBusy(false); });
    return () => controller.abort();
  }, [apiBase, request, page, search, state, days, revision, active, visible]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') refresh(); }, 30000);
    return () => window.clearInterval(timer);
  }, [refresh, active]);
  useEffect(() => { selectionGeneration.current++; setSelected({}); setSelectionSummary(null); setBulkPreview(null); setSelectionBusy(false); setSelectionError(''); }, [search, state, days]);
  function toggleSelection(users, checked) {
    setSelected(previous => { const next = { ...previous }; for (const user of users) { if (checked) next[user.id] = { id: user.id, name: user.name, email: user.email }; else delete next[user.id]; } return next; });
    setSelectionSummary(null); setSelectionError('');
  }
  async function previewSelection(allMatching = false) {
    if (selectionBusy || locked) return;
    const current = ++selectionGeneration.current;
    setSelectionBusy(true); setSelectionError('');
    try {
      const response = await request(`${apiBase}/office/users/email/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(allMatching ? { filter: { q: search, state, days } } : { userIds: selectedIds }) });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.recipients) || !body.selectionToken) throw new Error(body.message || 'Recipients could not be checked.');
      if (selectionGeneration.current !== current) return;
      if (allMatching) { setSelected(Object.fromEntries(body.recipients.map(user => [user.id, user]))); setSelectionSummary(body); }
      else if (!body.recipients.length) setSelectionError('None of the selected accounts has an eligible email address. No message was sent.');
      else { emailGeneration.current++; setRecipient(null); setHistory([]); setDelivery(null); setBulkPreview(body); }
      return body;
    } catch (failure) { if (selectionGeneration.current === current) setSelectionError(failure.message || 'Recipients could not be checked.'); }
    finally { if (selectionGeneration.current === current) setSelectionBusy(false); }
  }
  async function cacheAction(clear = false) {
    if (acting || (clear && !window.confirm('Clear user caches across API workers? Registered accounts remain in the database and reload when needed.'))) return;
    const current = generation.current; setActing(true); setError('');
    try {
      const response = await request(`${apiBase}/office/users/cache${clear ? '/clear' : ''}`, clear ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) } : {});
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Cache check failed.');
      if (generation.current === current) { setCache(body); if (clear) refresh(); }
    } catch (error) { if (generation.current === current) setError(error.message); }
    finally { setActing(false); }
  }
  async function openEmail(user) {
    if (!user.email) return;
    const current = ++emailGeneration.current;
    setRecipient(user); setSubject(''); setMessage(''); setEmailTemplate(''); setDelivery(null); setHistory([]); emailRequest.current = null;
    try {
      const response = await request(`${apiBase}/office/users/${encodeURIComponent(user.id)}/email`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Email history could not be loaded.');
      if (emailGeneration.current === current) setHistory(body.messages || []);
    } catch (error) { if (emailGeneration.current === current) setDelivery({ message: error.message }); }
  }
  async function sendEmail(event) {
    event.preventDefault();
    if (acting || !recipient || emailDraftError(subject, message)) return;
    const current = emailGeneration.current;
    if (!window.confirm(`Send this email to ${recipient.name} (${recipient.email})?\n\nSubject: ${subject}\n\n${message}`)) return;
    setActing(true); setDelivery(null);
    const payload = JSON.stringify([recipient.id, subject, message]);
    if (emailRequest.current?.payload !== payload) emailRequest.current = { payload, requestId: crypto.randomUUID() };
    try {
      const response = await request(`${apiBase}/office/users/${encodeURIComponent(recipient.id)}/email`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, message, requestId: emailRequest.current.requestId }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || 'Email could not be submitted.');
      if (emailGeneration.current === current) setDelivery(body);
    } catch (error) { if (emailGeneration.current === current) setDelivery({ status: 'unknown', message: `${error.message} Rechecking the same message will not send a duplicate.` }); }
    finally { setActing(false); }
  }
  async function removeUser(user) {
    if (acting || !window.confirm(`Permanently delete ${user.name} (${user.email}) and their UFIConnect account data? Recurring memberships will be stopped. This cannot be undone.`)) return;
    const current = generation.current; setActing(true); setError('');
    try {
      const response = await request(`${apiBase}/office/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok || !body.deleted) throw new Error(body.message || 'Account deletion failed.');
      if (generation.current === current) { if (usageUser?.id === user.id) setUsageUser(null); refresh(); }
    } catch (error) { if (generation.current === current) setError(error.message); }
    finally { setActing(false); }
  }
  return <section className="office-users" aria-label="Registered accounts">
    <div className="ou-heading"><h2>Registered accounts and signups</h2><button type="button" disabled={busy || locked} onClick={refresh}>Refresh records</button></div>
    <p>Records come directly from the database. Onboarding status is separate from account registration. History uses the earliest recorded registration date; current account totals use current records. Dates use UTC calendar days.</p>
    {error && <p role="alert" className="ou-error">{error}</p>}
    {busy && <p role="status">Loading account records…</p>}
    {usageUser && <UserUsage key={usageUser.id} user={usageUser} apiBase={apiBase} request={request} onClose={() => setUsageUser(null)} />}
    {data && <>
      <div className="ou-stats">{[['Registered', data.total], ['Onboarding complete', data.onboarded], ['Onboarding incomplete', data.incomplete], ['New today', data.today], ['New in 7 days', data.last7], ['New in 30 days', data.last30], ['Registered since May', data.sinceMay], ['Incomplete since May', data.incompleteSinceMay]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{number(value)}</strong></div>)}</div>
      <form className="ou-tools" onSubmit={event => { event.preventDefault(); if (locked || bulkPreview) return; setSearch(query); setPage(1); }}><label>Find an account<input maxLength={160} value={query} disabled={locked || Boolean(bulkPreview)} onChange={event => setQuery(event.target.value)} placeholder="Name or email" /></label><button disabled={locked || Boolean(bulkPreview)}>Search</button><div><label htmlFor="office-account-status">Status</label><select id="office-account-status" value={state} disabled={locked || Boolean(bulkPreview)} onChange={event => { setState(event.target.value); setPage(1); }}><option value="all">All accounts</option><option value="complete">Onboarding complete</option><option value="incomplete">Onboarding incomplete</option><option value="hidden">Profile hidden</option></select></div><div><label htmlFor="office-registration-window">Registration window</label><select id="office-registration-window" value={days} disabled={locked || Boolean(bulkPreview)} onChange={event => { setDays(event.target.value); setPage(1); }}><option value="since_may">Since May 2026</option><option value="120">Last 120 UTC days</option><option value="30">Last 30 UTC days</option><option value="all">All registrations</option></select></div></form>
      <p>{number(data.pagination.total)} matching accounts · Last read {date(data.generatedAt)}</p>
      <div className="ou-selection" aria-label="Email recipient selection"><div className="ou-tools"><button type="button" disabled={selectionBusy || locked || Boolean(bulkPreview)} onClick={() => previewSelection(true)}>Select all matching accounts</button><button type="button" disabled={!selectedIds.length || selectionBusy || locked || Boolean(bulkPreview)} onClick={() => { selectionGeneration.current++; setSelected({}); setSelectionSummary(null); setSelectionError(''); }}>Clear selection</button><button type="button" disabled={!selectedIds.length || selectionBusy || locked || Boolean(bulkPreview) || !data.email?.available} onClick={() => previewSelection(false)}>Email selected accounts</button></div><p role="status">{selectionBusy ? 'Checking eligible recipients…' : `${number(selectedIds.length)} accounts selected across all pages.`}{selectionSummary ? ` ${number(excludedRecipientCount(selectionSummary.excluded))} excluded from ${number(selectionSummary.totalMatched)} matching accounts because their email addresses are missing, invalid, duplicated or reserved for tests.` : ''}</p><p>Selection stays fixed when records refresh. Changing search, status or registration filters clears it. Recipient addresses are checked again before review.</p>{selectionError && <p role="alert" className="ou-error">{selectionError}</p>}</div>
      <div className="ou-table-wrap"><table><thead><tr><th scope="col"><SelectionCheckbox aria-label="Select accounts on this page" checked={pageRecipients.length > 0 && selectedOnPage === pageRecipients.length} partial={selectedOnPage > 0 && selectedOnPage < pageRecipients.length} disabled={!pageRecipients.length || selectionBusy || locked || Boolean(bulkPreview)} onChange={event => toggleSelection(pageRecipients, event.target.checked)} /></th><th scope="col">Account</th><th scope="col">Onboarding / visibility</th><th scope="col">Registered (UTC)</th><th scope="col">Actions</th></tr></thead><tbody>{data.recent.map(user => <tr key={user.id}><td data-label="Select"><SelectionCheckbox aria-label={`Select ${user.name} (${user.email || 'no email'})`} checked={Boolean(selected[user.id])} disabled={!user.email || selectionBusy || locked || Boolean(bulkPreview)} onChange={event => toggleSelection([user], event.target.checked)} /></td><td data-label="Account"><button type="button" className="ou-user-link" onClick={() => setUsageUser(user)} aria-label={`View usage for ${user.name}`}>{user.name}</button><span>{user.email || 'No email added'}</span></td><td data-label="Onboarding / visibility">{user.onboarded ? 'Complete' : 'Incomplete'}<span>{user.hidden ? 'Profile hidden' : 'Discoverable profile'}</span></td><td data-label="Registered (UTC)">{user.registeredDay || utcDay(user.createdAt)}{user.registeredDay && user.registeredDay !== utcDay(user.createdAt) && <span>Current account record: {date(user.createdAt)}</span>}</td><td data-label="Actions"><div className="ou-actions"><button disabled={locked || Boolean(bulkPreview) || !data.email?.available || !user.email} title={!user.email ? 'This account has not added an email address' : data.email?.available ? 'Compose an email' : 'SMTP email delivery is not configured'} onClick={() => openEmail(user)}>Email</button><button className="ou-danger" disabled={locked || Boolean(bulkPreview)} onClick={() => removeUser(user)}>Delete account</button></div></td></tr>)}</tbody></table></div>
      {!data.recent.length && <p>No registered account matches these filters. A rejected signup attempt does not create an account.</p>}
      <nav className="ou-tools" aria-label="Account pages"><button disabled={page <= 1 || locked} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page} of {data.pagination.pages}</span><button disabled={page >= data.pagination.pages || locked} onClick={() => setPage(value => value + 1)}>Next</button></nav>
      {registrationDays.length > 0 && <details><summary>Daily registration history since May</summary><p>{number(data.knownRegistrationsSinceMay)} known registrations, including {number(data.recoveredRegistrations)} recovered historical registrations. Current registered accounts remain {number(data.total)}. History uses the earliest recorded registration date when a backup confirms the same account; recovery does not recreate accounts.</p><div className="ou-table-wrap"><table><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Current accounts</th><th scope="col">Recovered registrations</th><th scope="col">Known registrations</th></tr></thead><tbody>{registrationDays.map(day => <tr key={day}><th scope="row">{day}</th><td>{number(registrationCounts.get(day)?.currentRegistrations)}</td><td>{number(registrationCounts.get(day)?.recoveredRegistrations)}</td><td>{number(registrationCounts.get(day)?.registrations)}</td></tr>)}</tbody></table></div></details>}
      {!data.email?.available && <p className="ou-warning">Email delivery is unavailable. Configure the existing SMTP mail service to send from Office.</p>}
      <h3>Signup request outcomes since May</h3><p>These are retained form submissions, including repeated attempts. {data.signupRequests?.since ? `Retained outcomes start on ${data.signupRequests.since}. ` : 'No retained outcomes have been recorded. '}Previously expired or unrecorded requests cannot be reconstructed. These counts contain no submitted name, email or password and are separate from registered-account totals.</p>
      {data.signupRequests?.available ? <div className="ou-stats">{data.signupRequests.outcomes.map(row => <div key={row.outcome}><span>{outcomeNames[row.outcome]}</span><strong>{number(row.requests)}</strong></div>)}</div> : <p className="ou-warning">Signup diagnostics are temporarily unavailable; account records above are still authoritative.</p>}
    </>}
    <h3>User cache checks</h3><p>Cache checks compare this API worker with registered database records. Clearing publishes an invalidation to every API worker within five seconds. Accounts load from the database again when needed.</p>
    <div className="ou-tools"><button disabled={locked} onClick={() => cacheAction()}>Check user cache</button><button disabled={locked} onClick={() => cacheAction(true)}>Clear user caches</button></div>
    {cache && <div className="ou-cache"><p>Checked {date(cache.checkedAt)}</p><dl>{[['Database accounts',cache.database],['Cached on this worker',cache.cached],['Database accounts currently uncached',cache.notCached],['Cache entries without a database account',cache.cacheOnly]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{number(value)}</dd></div>)}</dl><p>{cache.note}</p>{cache.cleared != null && <p>{number(cache.cleared)} entries cleared on this worker.</p>}</div>}
    {bulkPreview && <OfficeBulkEmail apiBase={apiBase} request={request} preview={bulkPreview} onClose={() => setBulkPreview(null)} onSendingChange={setBulkSending} />}
    {recipient && <section className="ou-composer" aria-label="Email account">
      <div className="ou-heading"><h3>Email {recipient.name}</h3><button disabled={acting} onClick={() => { emailGeneration.current++; setRecipient(null); setDelivery(null); setHistory([]); }}>Close email</button></div>
      <p>To: {recipient.email}</p>
      <form onSubmit={sendEmail}>
        <EmailTemplatePicker value={emailTemplate} disabled={acting || Boolean(delivery?.status)} onChange={chosen => { setEmailTemplate(chosen?.id || ''); if (chosen) { setSubject(chosen.subject); setMessage(chosen.message); } }} />
        <label>Subject<input aria-label="Subject" required maxLength={160} value={subject} disabled={acting || Boolean(delivery?.status)} onChange={event => setSubject(event.target.value)} /></label>
        <label>Message<textarea aria-label="Message" required maxLength={10000} rows={10} value={message} disabled={acting || Boolean(delivery?.status)} onChange={event => setMessage(event.target.value)} /></label>
        {templatePlaceholders(subject, message).length > 0 && <p className="ou-warning">Replace these fields: {templatePlaceholders(subject, message).join(', ')}</p>}
        <button disabled={acting || Boolean(emailDraftError(subject, message)) || ['accepted','sending','uncertain','failed'].includes(delivery?.status)}>{acting ? 'Submitting…' : delivery?.status === 'unknown' ? 'Resume this submission' : 'Review and send email'}</button>
      </form>
      {delivery && <p role="status">{delivery.message}</p>}
      {history.length > 0 && <><h4>Recent submissions</h4><ul>{history.map(item => <li key={item.id}>{item.subject} · {item.status} · {date(item.createdAt)}</li>)}</ul></>}
    </section>}
  </section>;
}

