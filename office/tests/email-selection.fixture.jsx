import React from 'react';
import { createRoot } from 'react-dom/client';
import OfficeUsers from '../src/OfficeUsers.jsx';

const user = index => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, name: `Fixture member ${index + 1}`, email: index === 68 ? null : index < 54 || index > 68 ? `member${index + 1}@fixture-mail.test` : `test${index + 1}@example.com`, onboarded: index < 50, hidden: false, registeredDay: '2026-10-01', createdAt: '2026-10-01T00:00:00Z' });
const state = window.emailFixture = { users: Array.from({ length: 69 }, (_, index) => user(index)), previews: [], batches: [], deliveries: {}, singleSends: [], mode: 'ok', lostOnce: false, limitedOnce: false, held: [], reads: 0 };
state.addUser = () => state.users.push(user(69));
function eligible(user) { return Boolean(user?.email && !user.email.endsWith('@example.com')); }
function matches(filter = {}) { return state.users.filter(user => (!filter.q || `${user.name} ${user.email || ''}`.toLowerCase().includes(filter.q.toLowerCase())) && (filter.state === 'complete' ? user.onboarded : filter.state === 'incomplete' ? !user.onboarded : true)); }
async function request(raw, options = {}) {
  const url = new URL(raw, location.origin), body = options.body ? JSON.parse(options.body) : null;
  if (url.pathname === '/fixture/office/users') {
    state.reads++; const users = matches(Object.fromEntries(url.searchParams)), page = Number(url.searchParams.get('page')) || 1;
    return Response.json({ available: true, total: state.users.length, recent: users.slice((page - 1) * 50, page * 50), pagination: { total: users.length, pages: Math.ceil(users.length / 50), page }, generatedAt: new Date().toISOString(), email: { available: true }, signupRequests: { available: true, outcomes: [] } });
  }
  if (url.pathname.endsWith('/email/preview')) {
    state.previews.push(body); const selected = body.filter ? matches(body.filter) : state.users.filter(user => body.userIds.includes(user.id));
    const recipients = selected.filter(eligible).map(({ id, name, email }) => ({ id, name, email }));
    return Response.json({ recipients, selectionToken: `synthetic-selection-${state.previews.length}`, totalMatched: selected.length, eligibleCount: recipients.length, emailAvailable: true, batchSize: 5, excluded: { missingEmail: selected.filter(user => !user.email).length, reservedAddress: selected.filter(user => user.email?.endsWith('@example.com')).length, invalidAddress: 0, duplicateAddress: 0, missingAccount: 0 } });
  }
  if (url.pathname.endsWith('/email/batch')) {
    state.batches.push(body);
    if (state.mode === 'http429') return Response.json({ message: 'Fixture HTTP rate limit.' }, { status: 429, headers: { 'Retry-After': '2' } });
    if (state.mode === 'limited-no-hint') return Response.json({ requestId: body.requestId, results: body.userIds.map(userId => ({ userId, status: 'limited', message: 'Fixture capacity limit.' })) });
    if (state.mode === 'hold') await new Promise(resolve => state.held.push(resolve));
    if (state.mode === 'limited' && !state.limitedOnce && state.batches.length > 1) { state.limitedOnce = true; return Response.json({ requestId: body.requestId, results: body.userIds.map(userId => ({ userId, status: 'limited', message: 'Fixture rate limit.', retryAfter: 1 })), retryAfter: 1 }); }
    const results = body.userIds.map(userId => { const key = `${body.requestId}:${userId}`; if (!state.deliveries[key]) state.deliveries[key] = { userId, subject: body.subject, message: body.message, attempts: 1 }; return { userId, status: state.mode === 'uncertain' ? 'uncertain' : 'accepted', message: state.mode === 'uncertain' ? 'Fixture uncertain.' : 'Accepted by fixture mail service.' }; });
    if (state.mode === 'lost' && !state.lostOnce) { state.lostOnce = true; throw new TypeError('Fixture response lost after acceptance.'); }
    return Response.json({ requestId: body.requestId, results, batchSize: 5 });
  }
  if (url.pathname.endsWith('/email') && options.method === 'POST') { state.singleSends.push(body); return Response.json({ status: 'accepted', message: 'Accepted by fixture mail service.' }); }
  if (url.pathname.endsWith('/email')) return Response.json({ messages: [] });
  return Response.json({});
}
const root = createRoot(document.getElementById('root'));
root.render(<OfficeUsers apiBase="/fixture" request={request} />);
window.unmountEmailFixture = () => root.unmount();
