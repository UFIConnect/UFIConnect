import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import client from '../api/client';
import { CONNECTED_SOCIAL_PLATFORMS, SOURCE_META } from './sourceMeta';

const LINK_FIELDS = [
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/yourname' },
  { key: 'github', label: 'GitHub', placeholder: 'https://github.com/yourname' },
  { key: 'portfolio', label: 'Portfolio', placeholder: 'https://yourwebsite.com' },
  { key: 'resume', label: 'Resume / CV', placeholder: 'https://drive.google.com/...' },
  { key: 'twitter', label: 'X / Twitter', placeholder: 'https://x.com/yourhandle' },
];

function ToolPanel({ title, summary, open, onToggle, children }) {
  return (
    <section className="profile-panel">
      <button type="button" className="profile-panel-trigger" onClick={onToggle} aria-expanded={open}>
        <span>
          <span className="profile-panel-title">{title}</span>
          {summary && <span className="profile-panel-summary">{summary}</span>}
        </span>
        <span className="profile-panel-chevron" aria-hidden="true">{open ? '-' : '+'}</span>
      </button>
      {open && <div className="profile-panel-content">{children}</div>}
    </section>
  );
}

function scoreStyle(score) {
  if (score >= 80) return { color: '#047857', background: '#ECFDF5', border: '#A7F3D0' };
  if (score >= 50) return { color: '#B45309', background: '#FFFBEB', border: '#FDE68A' };
  return { color: '#B91C1C', background: '#FEF2F2', border: '#FECACA' };
}

export default function HomeFeedTools({ showSources = true }) {
  const { profile, updateProfileLocally } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [openPanel, setOpenPanel] = useState(null);
  const [skills, setSkills] = useState([]);
  const [skillInput, setSkillInput] = useState('');
  const [savingSkills, setSavingSkills] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [links, setLinks] = useState(null);
  const [editingLinks, setEditingLinks] = useState(false);
  const [savingLinks, setSavingLinks] = useState(false);

  useEffect(() => { setSkills(Array.isArray(profile?.skills) ? profile.skills : []); }, [profile?.skills]);

  useEffect(() => {
    if (openPanel !== 'files' || attachmentsLoading || attachments.length) return;
    setAttachmentsLoading(true);
    client.get('/profile/attachments')
      .then(({ data }) => setAttachments(data.attachments || []))
      .catch(() => setAttachments([]))
      .finally(() => setAttachmentsLoading(false));
  }, [openPanel, attachments.length, attachmentsLoading]);

  const toggle = (key) => setOpenPanel(current => current === key ? null : key);
  const connected = (profile?.connectedPlatforms || CONNECTED_SOCIAL_PLATFORMS.filter(key => profile?.connectedSocial?.[key] || profile?.socialConnected?.[key]));

  function addSkill() {
    const value = skillInput.trim();
    if (!value || skills.some(skill => skill.toLowerCase() === value.toLowerCase())) return setSkillInput('');
    setSkills(current => [...current, value]);
    setSkillInput('');
  }

  async function saveSkills() {
    setSavingSkills(true);
    try {
      const { data } = await client.patch('/profile', { skills });
      updateProfileLocally(data.profile || data);
      showToast('Skills saved', 'success');
    } catch {
      showToast('Could not save skills. Try again.', 'error');
    } finally { setSavingSkills(false); }
  }

  async function uploadAttachment(file) {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) return setUploadError('Use a PDF, DOCX, or TXT file.');
    setUploading(true);
    setUploadError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await client.post('/profile/attachments', form);
      setAttachments(current => [data, ...current.map(item => ({ ...item, isPrimary: false }))]);
      showToast('Resume uploaded and ready for matching', 'success');
    } catch (error) {
      setUploadError(error?.response?.data?.message || 'Upload failed. Try again.');
    } finally { setUploading(false); }
  }

  async function downloadAttachment(attachment) {
    try {
      const { data } = await client.get(`/profile/attachments/${attachment.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.filename || 'resume';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch { showToast('Could not download this file.', 'error'); }
  }

  async function saveLinks(event) {
    event.preventDefault();
    setSavingLinks(true);
    try {
      const { data } = await client.patch('/profile', { links: links || {} });
      updateProfileLocally(data.profile || data);
      setEditingLinks(false);
      showToast('Profile links saved', 'success');
    } catch {
      showToast('Could not save links. Try again.', 'error');
    } finally { setSavingLinks(false); }
  }

  return (
    <div className="home-feed-side-tools" aria-label="Home tools">
      {showSources && <ToolPanel title="Feed sources" summary="Personalized for you" open={openPanel === 'sources'} onToggle={() => toggle('sources')}>
        <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: '.82rem', lineHeight: 1.5 }}>
          Home balances your saved topics, role, activity, and connected accounts.
        </p>
        {connected.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {connected.map(key => <span key={key} className="tag tag-primary" style={{ fontSize: '.74rem' }}>{SOURCE_META[key]?.label || key}</span>)}
          </div>
        ) : <p style={{ margin: 0, color: 'var(--muted)', fontSize: '.8rem' }}>No accounts connected yet.</p>}
        <Link to="/sources" className="btn btn-ghost btn-sm" style={{ marginTop: 10, textDecoration: 'none' }}>Source settings</Link>
      </ToolPanel>}

      <ToolPanel title="Connected accounts" summary={connected.length ? `${connected.length} connected` : 'Add your sources'} open={openPanel === 'accounts'} onToggle={() => toggle('accounts')}>
        <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: '.82rem', lineHeight: 1.5 }}>Connect the accounts that should shape your personal feed.</p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/connected-accounts')}>Manage accounts</button>
      </ToolPanel>

      <ToolPanel title="Skills" summary={skills.length ? `${skills.length} saved` : 'Add your skills'} open={openPanel === 'skills'} onToggle={() => toggle('skills')}>
        {skills.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {skills.map(skill => <span key={skill} className="tag tag-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.76rem' }}>
            {skill}<button type="button" aria-label={`Remove ${skill}`} onClick={() => setSkills(current => current.filter(item => item !== skill))} style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}>x</button>
          </span>)}
        </div>}
        <div style={{ display: 'flex', gap: 7 }}>
          <input className="form-input" value={skillInput} placeholder="Add a skill" onChange={event => setSkillInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addSkill(); } }} style={{ minWidth: 0, flex: 1 }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={addSkill}>Add</button>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={saveSkills} disabled={savingSkills} style={{ marginTop: 9 }}>{savingSkills ? 'Saving...' : 'Save skills'}</button>
      </ToolPanel>

      <ToolPanel title="Files" summary={attachments.length ? `${attachments.length} saved` : 'Resumes and links'} open={openPanel === 'files'} onToggle={() => toggle('files')}>
        <label style={{ display: 'flex', alignItems: 'center', padding: '9px 10px', border: '1px dashed var(--border)', borderRadius: 6, cursor: uploading ? 'default' : 'pointer', color: 'var(--muted)', fontSize: '.8rem' }}>
          {uploading ? 'Uploading...' : 'Upload resume'}
          <input type="file" accept=".pdf,.docx,.txt" disabled={uploading} style={{ display: 'none' }} onChange={event => { const file = event.target.files[0]; event.target.value = ''; uploadAttachment(file); }} />
        </label>
        {uploadError && <div className="auth-error" style={{ marginTop: 8 }}>{uploadError}</div>}
        {attachmentsLoading ? <div style={{ padding: '12px 0', textAlign: 'center' }}><span className="spinner spinner-primary" /></div> : attachments.map(attachment => {
          const score = scoreStyle(attachment.atsScore);
          return <div key={attachment.id} style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, fontSize: '.78rem' }}>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachment.filename}</span>
            <span style={{ color: score.color, background: score.background, border: `1px solid ${score.border}`, padding: '2px 5px', borderRadius: 4, fontWeight: 700 }}>{attachment.atsScore}/100</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadAttachment(attachment)} style={{ padding: '4px 7px' }}>Get</button>
          </div>;
        })}
        {!editingLinks ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLinks({ ...(profile?.links || {}) }); setEditingLinks(true); }} style={{ marginTop: 10 }}>Edit links</button> : (
          <form onSubmit={saveLinks} style={{ marginTop: 12 }}>
            {LINK_FIELDS.map(field => <div className="form-group" key={field.key} style={{ marginBottom: 8 }}><label className="form-label">{field.label}</label><input className="form-input" type="url" value={links?.[field.key] || ''} placeholder={field.placeholder} onChange={event => setLinks(current => ({ ...current, [field.key]: event.target.value }))} /></div>)}
            <div style={{ display: 'flex', gap: 7 }}><button className="btn btn-primary btn-sm" disabled={savingLinks}>{savingLinks ? 'Saving...' : 'Save links'}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingLinks(false)}>Cancel</button></div>
          </form>
        )}
      </ToolPanel>

    </div>
  );
}
