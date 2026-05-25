import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import client from '../api/client';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function Profile() {
  const { profile, updateProfileLocally } = useAuth();
  const [editing, setEditing] = useState(false);
  const [form,    setForm]    = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  function startEdit() {
    setForm({
      name:         profile?.name         || '',
      title:        profile?.title        || '',
      bio:          profile?.bio          || '',
      organization: profile?.organization || '',
      skills:       (profile?.skills || []).join(', '),
    });
    setEditing(true);
    setError('');
  }

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      };
      const { data } = await client.patch('/profile', payload);
      updateProfileLocally(data);
      setEditing(false);
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return <Layout><div className="empty-state"><span className="spinner spinner-primary" /></div></Layout>;

  return (
    <Layout>
      {/* Cover + header */}
      <div className="profile-cover" />
      <div className="profile-header">
        <div className="profile-avatar-wrap">
          <div className="avatar avatar-xl">{initials(profile.name)}</div>
        </div>
        {!editing ? (
          <>
            <div className="profile-name">{profile.name}</div>
            <div className="profile-title">{profile.title || '—'}</div>
            {profile.organization && (
              <div className="profile-org">🏢 {profile.organization}</div>
            )}
            {profile.bio && <p className="profile-bio">{profile.bio}</p>}
            {profile.skills?.length > 0 && (
              <div className="tags" style={{ margin: '12px 0' }}>
                {profile.skills.map((s) => (
                  <span key={s} className="tag tag-primary">{s}</span>
                ))}
              </div>
            )}
            <div className="profile-actions">
              <button className="btn btn-primary btn-sm" onClick={startEdit}>Edit profile</button>
              <Link to="/profile/connected-accounts">
                <button className="btn btn-ghost btn-sm">🔗 Connected accounts</button>
              </Link>
            </div>
          </>
        ) : (
          <form onSubmit={handleSave} style={{ marginTop: 12 }}>
            {error && <div className="auth-error">{error}</div>}
            <div className="form-group">
              <label className="form-label">Full name</label>
              <input className="form-input" name="name" value={form.name} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label className="form-label">Professional title</label>
              <input className="form-input" name="title" value={form.title} onChange={handleChange}
                placeholder="e.g. Senior Product Manager" />
            </div>
            <div className="form-group">
              <label className="form-label">Organization</label>
              <input className="form-input" name="organization" value={form.organization} onChange={handleChange}
                placeholder="Where do you work / study?" />
            </div>
            <div className="form-group">
              <label className="form-label">Bio</label>
              <textarea className="form-textarea" name="bio" value={form.bio} onChange={handleChange}
                placeholder="Tell people what you're working on…" />
            </div>
            <div className="form-group">
              <label className="form-label">Skills <span style={{ color:'var(--muted)', fontWeight:400 }}>(comma-separated)</span></label>
              <input className="form-input" name="skills" value={form.skills} onChange={handleChange}
                placeholder="React, Python, Product Strategy…" />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? <span className="spinner" /> : 'Save changes'}
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      {/* Preferences summary */}
      {profile.preferences && !editing && (
        <div className="card">
          <h2 style={{ fontWeight: 700, marginBottom: 14, fontSize: '1rem' }}>Preferences</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {profile.preferences.role && (
              <div>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>Role</div>
                <div style={{ fontSize: '.875rem', fontWeight: 500 }}>{profile.preferences.role}</div>
              </div>
            )}
            {profile.preferences.experience && (
              <div>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>Experience</div>
                <div style={{ fontSize: '.875rem', fontWeight: 500 }}>{profile.preferences.experience}</div>
              </div>
            )}
            {profile.preferences.goals?.length > 0 && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Goals</div>
                <div className="tags">
                  {profile.preferences.goals.map((g) => <span key={g} className="tag">{g}</span>)}
                </div>
              </div>
            )}
            {profile.preferences.interests?.length > 0 && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Interests</div>
                <div className="tags">
                  {profile.preferences.interests.map((i) => <span key={i} className="tag tag-secondary">{i}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
