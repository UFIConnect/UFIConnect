import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import client from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { publicSiteUrl } from '../utils/publicSiteUrl.mjs';

export default function BusinessTeamSettings() {
  const { profile, refreshProfile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const inviteToken = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
  const [team, setTeam] = useState(null);
  const [invitation, setInvitation] = useState(null);
  const [email, setEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = generation.current;
    setLoading(true); setError('');
    try {
      const [{ data }, preview] = await Promise.all([
        client.get('/business/team'),
        inviteToken ? client.post('/business/team/invitation', { token: inviteToken }) : Promise.resolve(null),
      ]);
      if (request !== generation.current) return;
      setTeam(data); setInvitation(preview?.data || null);
    } catch (failure) {
      if (request === generation.current) setError(failure?.response?.data?.message || 'Could not load your team. Please try again.');
    } finally { if (request === generation.current) setLoading(false); }
  }, [profile?.id, inviteToken]);

  useEffect(() => {
    generation.current++;
    setTeam(null); setInvitation(null); setInviteLink(''); setEmail(''); setBusy(false); setNotice('');
    load();
    return () => { generation.current++; };
  }, [load]);

  async function act(operation, success, { refreshAccount = false, accepted = false } = {}) {
    if (busy) return;
    const request = generation.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await operation();
      if (request !== generation.current) return;
      if (result?.data?.invitePath) {
        setInviteLink(publicSiteUrl(result.data.invitePath));
        setEmail('');
      }
      if (refreshAccount) await refreshProfile();
      if (request !== generation.current) return;
      setNotice(success);
      if (accepted) navigate('/recruiting', { replace: true });
      else await load();
    } catch (failure) {
      if (request === generation.current) setError(failure?.response?.data?.message || 'Could not update your team. Please try again.');
    } finally { if (request === generation.current) setBusy(false); }
  }

  if (!inviteToken && team?.role === 'none' && !error) return null;
  return <section className="card business-team-settings" aria-labelledby="business-team-title" style={{ padding: 20, marginTop: 18, display: 'grid', gap: 12 }}>
    <h2 id="business-team-title" style={{ margin: 0, fontSize: '1.1rem' }}>{inviteToken ? 'Business team invitation' : 'Your Business team'}</h2>
    {loading && <p role="status">Checking team membership…</p>}
    {error && <p role="alert" className="auth-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {inviteToken && invitation && <div>
      <p><strong>{invitation.owner.organization || invitation.owner.name}</strong> invited <strong>{invitation.email}</strong> to its Business recruiting workspace.</p>
      <p style={{ color: 'var(--muted)', fontSize: '.85rem' }}>Accepting uses one seat paid for by the team owner. Your personal subscription and saved account content stay with your account. You can leave the team at any time.</p>
      {!invitation.active && <p role="status">The team owner needs an active membership for two or more people before you can join.</p>}
      <button type="button" className="btn btn-primary" disabled={busy || loading || !invitation.active}
        onClick={() => act(() => client.post('/business/team/accept', { token: inviteToken }), 'You joined the Business team.', { refreshAccount: true, accepted: true })}>
        {busy ? 'Joining…' : 'Accept invitation'}
      </button>
    </div>}
    {!inviteToken && team?.role === 'owner' && <>
      <p style={{ margin: 0 }}>{team.active ? `${team.used} of ${team.seats} seats assigned. Your own account uses one seat.` : 'Your membership is inactive. Assigned teammates currently have no access through this team.'}</p>
      {team.active && team.seats >= 2 ? <form onSubmit={event => {
        event.preventDefault();
        act(() => client.post('/business/team/invitations', { email }), 'Invitation created. Copy and share the link with your teammate.');
      }} style={{ display: 'grid', gap: 8 }}>
        <label className="form-label" htmlFor="business-team-email">Teammate’s registered email</label>
        <input id="business-team-email" className="form-input" type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="teammate@company.com" disabled={busy} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || loading || !email.trim()}>{busy ? 'Saving…' : 'Create invitation link'}</button>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: '.8rem' }}>Links expire in seven days and can only be accepted by that account. Invitations reserve an available seat. No email is sent automatically.</p>
      </form> : <p><Link to="/settings">Manage billing</Link> to review your membership and number of people.</p>}
      {inviteLink && <div style={{ display: 'grid', gap: 8 }}>
        <label className="form-label" htmlFor="business-team-link">Invitation link</label>
        <input id="business-team-link" className="form-input" value={inviteLink} readOnly onFocus={event => event.target.select()} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
          try { await navigator.clipboard.writeText(inviteLink); setNotice('Invitation link copied.'); }
          catch { setNotice('Select and copy the invitation link above.'); }
        }}>Copy invitation link</button>
      </div>}
      {team.members?.length > 0 && <div><h3 style={{ fontSize: '.95rem' }}>Members</h3>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{team.members.map(member => <li key={member.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <span><strong>{member.name}</strong><br /><span style={{ fontSize: '.8rem', overflowWrap: 'anywhere' }}>{member.email} · {member.active ? 'Active seat' : 'No active seat'}</span></span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => client.delete(`/business/team/members/${encodeURIComponent(member.id)}`), 'Team member removed.')}>Remove</button>
        </li>)}</ul>
      </div>}
      {team.invitations?.length > 0 && <div><h3 style={{ fontSize: '.95rem' }}>Pending invitations</h3>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{team.invitations.map(item => <li key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ overflowWrap: 'anywhere' }}>{item.email}<br /><small>Expires {new Date(item.expiresAt).toLocaleDateString()}</small></span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => client.delete(`/business/team/invitations/${encodeURIComponent(item.id)}`), 'Invitation revoked.')}>Revoke</button>
        </li>)}</ul>
      </div>}
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: '.8rem' }}>If paid seats are reduced, the earliest joined teammates retain the available seats. Other assigned teammates stay listed without active access.</p>
    </>}
    {!inviteToken && team?.role === 'member' && <>
      <p>You belong to <strong>{team.organization || team.ownerName}</strong>. {team.active ? 'Your Business seat is active.' : 'Your team seat is currently inactive. Contact the owner about membership or seat availability.'}</p>
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy || loading} onClick={() => {
        if (window.confirm('Leave this Business team? You will lose access provided by its seat.')) act(() => client.post('/business/team/leave'), 'You left the Business team.', { refreshAccount: true });
      }}>Leave team</button>
    </>}
    <button type="button" className="btn btn-ghost btn-sm" disabled={busy || loading} onClick={load}>Refresh team</button>
  </section>;
}
