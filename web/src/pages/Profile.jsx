import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import FollowListModal from '../components/FollowListModal';
import PhotoPickerButton from '../components/PhotoPickerButton';
import PostList from '../components/PostList';
import client from '../api/client';
import { useToast } from '../contexts/ToastContext';
import { uploadMedia } from '../api/upload';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

const LINK_FIELDS = [
  { key: 'linkedin',  label: 'LinkedIn',       icon: 'in', placeholder: 'https://linkedin.com/in/yourname' },
  { key: 'github',    label: 'GitHub',         icon: 'GH', placeholder: 'https://github.com/yourname' },
  { key: 'gitlab',    label: 'GitLab',         icon: 'GL', placeholder: 'https://gitlab.com/yourname' },
  { key: 'portfolio', label: 'Portfolio',      icon: 'URL', placeholder: 'https://yourwebsite.com' },
  { key: 'resume',    label: 'Resume / CV',    icon: 'CV', placeholder: 'https://drive.google.com/...' },
  { key: 'twitter',   label: 'X / Twitter',   icon: 'X', placeholder: 'https://x.com/yourhandle' },
  { key: 'other',     label: 'Other link',     icon: 'Link', placeholder: 'https://...' },
];

const PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
function validateProfileImage(file) {
  if (!file) return 'No file selected.';
  if (!file.type?.startsWith('image/')) return 'Please choose an image file.';
  if (file.size > PROFILE_IMAGE_MAX_BYTES) return 'Profile photos must be 10MB or smaller.';
  return null;
}

function ProfilePanel({ title, summary, open, onToggle, children }) {
  return (
    <section className="profile-panel">
      <button
        type="button"
        className="profile-panel-trigger"
        onClick={onToggle}
        aria-expanded={open}
      >
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

export default function Profile() {
  const { profile, updateProfileLocally } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [openPanel,   setOpenPanel]   = useState(null);
  const [editing,     setEditing]     = useState(null);
  const [form,        setForm]        = useState(null);
  const [links,       setLinks]       = useState(null);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  // Skills panel state
  const [skillInput,    setSkillInput]    = useState('');
  const [skills,        setSkills]        = useState([]);
  const [skillSaving,   setSkillSaving]   = useState(false);
  // Posts
  const [posts,        setPosts]        = useState([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsHasMore, setPostsHasMore] = useState(false);
  const [postsLoadingMore, setPostsLoadingMore] = useState(false);
  // Follow stats
  const [followStats, setFollowStats] = useState({ followersCount: 0, followingCount: 0 });
  const [followModal, setFollowModal] = useState(null); // 'followers' | 'following' | null
  // Avatar / cover photo upload
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover,  setUploadingCover]  = useState(false);
  const [avatarPreview, setAvatarPreview] = useState('');
  const [coverPreview, setCoverPreview] = useState('');
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const [coverLoadFailed, setCoverLoadFailed] = useState(false);
  // Attachments (resume upload + ATS score)
  const [attachments,        setAttachments]        = useState([]);
  const [attachmentsLoading, setAttachmentsLoading]  = useState(false);
  const [uploading,          setUploading]           = useState(false);
  const [uploadError,        setUploadError]         = useState('');
  const [expandedAttachment, setExpandedAttachment]  = useState(null);
  const [deletingAttachment, setDeletingAttachment]  = useState(null);
  const [selectingAttachment, setSelectingAttachment] = useState(null);

  const avatarImageUrl = avatarPreview || profile?.avatarUrl || '';
  const coverImageUrl = coverPreview || profile?.coverUrl || '';

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [avatarImageUrl]);

  useEffect(() => {
    setCoverLoadFailed(false);
  }, [coverImageUrl]);

  useEffect(() => () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  useEffect(() => () => {
    if (coverPreview) URL.revokeObjectURL(coverPreview);
  }, [coverPreview]);

  // Old profile deep links still open the corresponding right-side panel.
  useEffect(() => {
    const requested = searchParams.get('tab');
    setOpenPanel(requested === 'skills' ? 'skills' : requested === 'attachments' ? 'files' : null);
    setEditing(null);
  }, [searchParams]);

  // Sync skills from profile when profile loads.
  useEffect(() => {
    if (Array.isArray(profile?.skills)) setSkills(profile.skills);
  }, [profile]);

  // Load follow counts
  useEffect(() => {
    if (!profile?.id) return;
    client.get(`/users/${profile.id}`)
      .then(({ data }) => setFollowStats({ followersCount: data.followersCount, followingCount: data.followingCount }))
      .catch(() => {});
  }, [profile?.id]);

  async function fetchProfilePosts(offset = 0) {
    if (!profile?.id) return;
    const appending = offset > 0;
    if (appending) setPostsLoadingMore(true);
    else setPostsLoading(true);
    try {
      const { data } = await client.get(`/users/${profile.id}/posts`, { params: { limit: 50, offset } });
      const incoming = data.posts || [];
      setPosts(current => {
        if (!appending) return incoming;
        const seen = new Set(current.map(post => post.id));
        return [...current, ...incoming.filter(post => !seen.has(post.id))];
      });
      setPostsHasMore(!!data.hasMore);
    } catch {
      if (!appending) setPosts([]);
      setPostsHasMore(false);
    } finally {
      if (appending) setPostsLoadingMore(false);
      else setPostsLoading(false);
    }
  }

  useEffect(() => {
    setPosts([]);
    setPostsHasMore(false);
    fetchProfilePosts();
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function loadMorePosts() {
    if (postsLoadingMore || !postsHasMore) return;
    fetchProfilePosts(posts.length);
  }

  function fetchAttachments() {
    setAttachmentsLoading(true);
    client.get('/profile/attachments')
      .then(({ data }) => setAttachments(data.attachments || []))
      .catch(() => setAttachments([]))
      .finally(() => setAttachmentsLoading(false));
  }

  // Loaded lazily when the Files panel is opened.
  useEffect(() => {
    if (openPanel === 'files' && attachments.length === 0 && !attachmentsLoading) fetchAttachments();
  }, [openPanel]); // eslint-disable-line

  async function handleAvatarUpload(file) {
    if (!file) return;
    const validationError = validateProfileImage(file);
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }
    setAvatarPreview(URL.createObjectURL(file));
    setUploadingAvatar(true);
    try {
      const uploaded = await uploadMedia(file, null, 'avatars');
      if (!uploaded?.url || uploaded.type !== 'image') throw new Error('The selected file was not uploaded as an image.');
      const { data } = await client.patch('/profile', { avatarUrl: uploaded.url });
      updateProfileLocally(data.profile || data);
      showToast('Profile photo updated', 'success');
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || 'Failed to upload photo - please try again.', 'error');
    } finally {
      setAvatarPreview('');
      setUploadingAvatar(false);
    }
  }

  async function handleCoverUpload(file) {
    if (!file) return;
    const validationError = validateProfileImage(file);
    if (validationError) {
      showToast(validationError, 'error');
      return;
    }
    setCoverPreview(URL.createObjectURL(file));
    setUploadingCover(true);
    try {
      const uploaded = await uploadMedia(file, null, 'covers');
      if (!uploaded?.url || uploaded.type !== 'image') throw new Error('The selected file was not uploaded as an image.');
      const { data } = await client.patch('/profile', { coverUrl: uploaded.url });
      updateProfileLocally(data.profile || data);
      showToast('Cover photo updated', 'success');
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || 'Failed to upload cover photo - please try again.', 'error');
    } finally {
      setCoverPreview('');
      setUploadingCover(false);
    }
  }

  async function clearProfileImage(kind) {
    const isAvatar = kind === 'avatar';
    const hasImage = isAvatar ? avatarImageUrl : coverImageUrl;
    const isUploading = isAvatar ? uploadingAvatar : uploadingCover;
    if (!hasImage || isUploading) return;

    const label = isAvatar ? 'profile photo' : 'cover photo';
    if (!window.confirm(`Remove your ${label}?`)) return;

    const setUploading = isAvatar ? setUploadingAvatar : setUploadingCover;
    const setPreview = isAvatar ? setAvatarPreview : setCoverPreview;
    setUploading(true);
    try {
      const { data } = await client.patch('/profile', { [isAvatar ? 'avatarUrl' : 'coverUrl']: '' });
      setPreview('');
      updateProfileLocally(data.profile || data);
      showToast(`${isAvatar ? 'Profile photo' : 'Cover photo'} removed`, 'success');
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || `Failed to remove ${label}.`, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function handleAttachmentUpload(file) {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) {
      setUploadError('Only PDF, DOCX, and TXT files are supported.');
      return;
    }
    setUploading(true);
    setUploadError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { data } = await client.post('/profile/attachments', formData);
      // Server marks the fresh upload primary and unsets every other one for
      // this user (see POST /profile/attachments) — mirror that locally so
      // the "Used for matching" label moves immediately instead of waiting
      // on a full refetch to notice.
      setAttachments(prev => [data, ...prev.map(a => ({ ...a, isPrimary: false }))]);
      setExpandedAttachment(data.id);
      showToast(`Resume scored ${data.atsScore}/100`, 'success');
    } catch (err) {
      setUploadError(err?.response?.data?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function handleAttachmentDelete(id) {
    setDeletingAttachment(id);
    try {
      await client.delete(`/profile/attachments/${id}`);
      setAttachments(prev => prev.filter(a => a.id !== id));
      if (expandedAttachment === id) setExpandedAttachment(null);
    } catch {
      showToast('Failed to delete — please try again.', 'error');
    } finally { setDeletingAttachment(null); }
  }

  async function handleAttachmentSelect(id) {
    setSelectingAttachment(id);
    try {
      await client.post(`/profile/attachments/${id}/select`);
      setAttachments(prev => prev.map(a => ({ ...a, isPrimary: a.id === id })));
      showToast('This resume is now used for opportunity matching.', 'success');
    } catch {
      showToast('Failed to update — please try again.', 'error');
    } finally { setSelectingAttachment(null); }
  }

  async function handleAttachmentDownload(attachment) {
    try {
      const { data } = await client.get(`/profile/attachments/${attachment.id}/download`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.filename || 'resume';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {}
  }

  function scoreColor(score) {
    if (score >= 80) return { text: '#059669', bg: '#ECFDF5', border: '#A7F3D0' };
    if (score >= 50) return { text: '#D97706', bg: '#FFFBEB', border: '#FDE68A' };
    return { text: '#DC2626', bg: '#FEF2F2', border: '#FECACA' };
  }


  function addSkill() {
    const trimmed = skillInput.trim();
    if (!trimmed || skills.includes(trimmed)) { setSkillInput(''); return; }
    setSkills(prev => [...prev, trimmed]);
    setSkillInput('');
  }

  function removeSkill(s) {
    setSkills(prev => prev.filter(x => x !== s));
  }

  async function saveSkills() {
    setSkillSaving(true);
    try {
      const payload = { name: profile.name, title: profile.title, bio: profile.bio, organization: profile.organization, skills, links: profile.links || {} };
      const { data } = await client.patch('/profile', payload);
      updateProfileLocally(data.profile || data);
    } catch {}
    finally { setSkillSaving(false); }
  }

  function startEdit() {
    setForm({
      name:         profile?.name         || '',
      title:        profile?.title        || '',
      bio:          profile?.bio          || '',
      organization: profile?.organization || '',
      skills:       (profile?.skills || []).join(', '),
    });
    setLinks({ ...(profile?.links || {}) });
    setEditing('profile');
    setError('');
  }

  function startFileEdit() {
    setLinks({ ...(profile?.links || {}) });
    setEditing('files');
    setOpenPanel('files');
    setError('');
  }

  function handleChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  function handleLinkChange(e) {
    setLinks((l) => ({ ...l, [e.target.name]: e.target.value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setError('Enter your name before saving.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        name,
        title: form.title.trim(),
        bio: form.bio.trim(),
        organization: form.organization.trim(),
        skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
        links,
      };
      const data = await client.patch('/profile', payload).then(r => r.data);
      // Support both { profile: {...} } and flat profile shapes
      updateProfileLocally(data.profile || data);
      setEditing(null);
      showToast('Profile saved', 'success');
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleFilesSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: profile.name,
        title: profile.title,
        bio: profile.bio,
        organization: profile.organization,
        skills: profile.skills || [],
        links,
      };
      const data = await client.patch('/profile', payload).then(r => r.data);
      updateProfileLocally(data.profile || data);
      setEditing(null);
      showToast('Files and links saved', 'success');
    } catch (err) {
      setError(err?.response?.data?.message || 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!profile) return (
    <Layout>
      <div className="empty-state"><span className="spinner spinner-primary" /></div>
    </Layout>
  );

  const profileLinks = profile.links || {};
  const hasLinks = Object.values(profileLinks).some(Boolean);

  return (
    <Layout>
      {/* Cover */}
      <div className="profile-cover">
        {coverImageUrl && !coverLoadFailed && (
          <img
            className="profile-cover-image"
            src={coverImageUrl}
            alt=""
            onError={() => setCoverLoadFailed(true)}
          />
        )}
        <div className="profile-cover-actions">
          <PhotoPickerButton
            className="profile-cover-photo-button"
            onFileSelected={handleCoverUpload}
            onRemove={coverImageUrl ? () => clearProfileImage('cover') : undefined}
            capture="environment"
            disabled={uploadingCover}
            ariaLabel="Change cover photo"
            removeLabel="Remove cover photo"
            label={<>{uploadingCover && <span className="spinner" style={{ width: 12, height: 12 }} />} {uploadingCover ? 'Uploading...' : 'Change cover'}</>}
            menuStyle={{ right: 0, left: 'auto' }}
          />
        </div>
      </div>

      {/* Header card */}
      <div className="profile-header">
        <div className="profile-avatar-wrap">
          {avatarImageUrl && !avatarLoadFailed ? (
            <img
              src={avatarImageUrl}
              alt=""
              className="avatar-xl"
              onError={() => setAvatarLoadFailed(true)}
              style={{ borderRadius: '50%', objectFit: 'cover', display: 'block' }}
            />
          ) : (
            <div className="avatar avatar-xl">{initials(profile.name)}</div>
          )}
          <div className="profile-avatar-actions">
            <PhotoPickerButton
              className="profile-avatar-photo-button"
              onFileSelected={handleAvatarUpload}
              onRemove={avatarImageUrl ? () => clearProfileImage('avatar') : undefined}
              capture="user"
              disabled={uploadingAvatar}
              ariaLabel="Change profile photo"
              removeLabel="Remove profile photo"
              label={uploadingAvatar ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Photo'}
              menuStyle={{ left: 0, right: 'auto' }}
            />
          </div>
        </div>
        <div className="profile-name">{profile.name}</div>
        <div className="profile-title">{profile.title || 'UFIconnect Member'}</div>
        {profile.organization && <div className="profile-org">{profile.organization}</div>}

        {/* Follow stats */}
        <div style={{ display: 'flex', gap: 20, marginTop: 14, justifyContent: 'center' }}>
          {[
            { type: 'followers', count: followStats.followersCount, label: 'Followers' },
            { type: 'following', count: followStats.followingCount, label: 'Following' },
          ].map(({ type, count, label }) => (
            <button
              key={type}
              onClick={() => setFollowModal(type)}
              style={{ textAlign: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 10px', borderRadius: 8, transition: 'background .15s' }}
              onMouseOver={e => e.currentTarget.style.background = 'var(--hover)'}
              onMouseOut={e => e.currentTarget.style.background = 'none'}
            >
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{count}</div>
              <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{label}</div>
            </button>
          ))}
        </div>

        <div className="profile-actions" style={{ marginTop: 14 }}>
          {!editing && <button className="btn btn-primary btn-sm" onClick={startEdit}>Edit profile</button>}
          <Link className="btn btn-ghost btn-sm" to={`/u/${profile.id}`} target="_blank" rel="noopener noreferrer">Preview as public</Link>
        </div>

      </div>

      {followModal && (
        <FollowListModal
          userId={profile.id}
          type={followModal}
          title={followModal === 'followers'
            ? `Followers · ${followStats.followersCount}`
            : `Following · ${followStats.followingCount}`}
          onClose={() => setFollowModal(null)}
        />
      )}

      <div className="profile-workspace profile-workspace--details">
        <section className="profile-posts-column">
          {editing === 'profile' ? (
            <form className="card" onSubmit={handleSave}>
              {error && <div className="auth-error" style={{ marginBottom: 14 }}>{error}</div>}
              <h2 style={{ fontSize: '1rem', margin: '0 0 18px' }}>Edit profile</h2>
              <div className="form-group">
                <label className="form-label">Full name</label>
                <input className="form-input" name="name" value={form.name} onChange={handleChange} />
              </div>
              <div className="form-group">
                <label className="form-label">Professional title</label>
                <input className="form-input" name="title" value={form.title} onChange={handleChange} placeholder="e.g. Senior Product Manager" />
              </div>
              <div className="form-group">
                <label className="form-label">Organization</label>
                <input className="form-input" name="organization" value={form.organization} onChange={handleChange} placeholder="Where do you work or study?" />
              </div>
              <div className="form-group">
                <label className="form-label">Bio</label>
                <textarea className="form-textarea" name="bio" value={form.bio} onChange={handleChange} placeholder="Tell people what you're working on..." />
              </div>
              <div className="form-group">
                <label className="form-label">Skills <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(comma-separated)</span></label>
                <input className="form-input" name="skills" value={form.skills} onChange={handleChange} placeholder="React, Python, Product Strategy..." />
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? <span className="spinner" /> : 'Save changes'}</button>
                <button className="btn btn-ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </form>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 14 }}>
                <h2 style={{ fontSize: '1rem', margin: '0 0 6px' }}>About</h2>
                <p style={{ fontSize: '.9rem', lineHeight: 1.65, color: profile.bio ? 'var(--text)' : 'var(--muted)', margin: 0 }}>
                  {profile.bio || 'Add a short bio so people know what you are building and learning.'}
                </p>
              </div>
              <div style={{ marginTop: 18 }}>
                <div className="profile-posts-heading">
                  <div>
                    <h2 style={{ fontSize: '1rem', margin: 0 }}>Your UFIconnect posts</h2>
                    <p style={{ color: 'var(--muted)', fontSize: '.82rem', margin: '3px 0 0' }}>Posts you share with the community live here.</p>
                  </div>
                  <Link to="/post" className="btn btn-primary btn-sm" style={{ textDecoration: 'none', flexShrink: 0 }}>Write a post</Link>
                </div>
                <PostList
                  posts={posts}
                  loading={postsLoading}
                  emptyTitle="No posts yet"
                  emptyDesc="Write your first UFIconnect post and it will appear here."
                  emptyAction={<Link to="/post" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>Write a post</Link>}
                  showAuthor={false}
                  maxWidth={null}
                  currentUserId={profile?.id}
                  onPostUpdated={(updated) => setPosts(current => current.map(post => post.id === updated.id ? { ...post, ...updated } : post))}
                  onPostDeleted={(id) => setPosts(current => current.filter(post => post.id !== id))}
                  onNearEnd={loadMorePosts}
                />
                {postsLoadingMore && <div style={{ textAlign: 'center', padding: '12px 0' }}><span className="spinner spinner-primary" /></div>}
              </div>
            </>
          )}
        </section>

        {false && <aside className="profile-side-panels" aria-label="Profile tools">
          <ProfilePanel
            title="Connected accounts"
            summary="Manage the sources you bring into UFIconnect"
            open={openPanel === 'accounts'}
            onToggle={() => setOpenPanel(openPanel === 'accounts' ? null : 'accounts')}
          >
            <p style={{ color: 'var(--muted)', fontSize: '.84rem', lineHeight: 1.55, margin: '0 0 12px' }}>
              Connect the accounts you use so their activity is available in your personal workspace.
            </p>
            <button className="btn btn-primary btn-sm" type="button" onClick={() => navigate('/connected-accounts')}>Manage accounts</button>
          </ProfilePanel>

          <ProfilePanel
            title="Skills"
            summary={skills.length ? `${skills.length} saved` : 'Add the skills you use'}
            open={openPanel === 'skills'}
            onToggle={() => setOpenPanel(openPanel === 'skills' ? null : 'skills')}
          >
            {skills.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {skills.map(skill => (
                  <span key={skill} className="tag tag-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: '.82rem' }}>
                    {skill}
                    <button type="button" onClick={() => removeSkill(skill)} aria-label={`Remove ${skill}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1, fontSize: '.85rem', opacity: .7 }}>x</button>
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: '.84rem', margin: '0 0 14px' }}>No skills added yet.</p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="form-input" placeholder="Add a skill" value={skillInput} onChange={e => setSkillInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }} style={{ minWidth: 0, flex: 1 }} />
              <button className="btn btn-ghost btn-sm" type="button" onClick={addSkill}>Add</button>
            </div>
            <button className="btn btn-primary btn-sm" type="button" onClick={saveSkills} disabled={skillSaving} style={{ marginTop: 10 }}>
              {skillSaving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save skills'}
            </button>
          </ProfilePanel>

          <ProfilePanel
            title="Files"
            summary={attachments.length ? `${attachments.length} resume${attachments.length === 1 ? '' : 's'} saved` : 'Resumes and profile links'}
            open={openPanel === 'files'}
            onToggle={() => setOpenPanel(openPanel === 'files' ? null : 'files')}
          >
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1.5px dashed var(--border)', borderRadius: 8, cursor: uploading ? 'default' : 'pointer', fontSize: '.82rem', color: 'var(--muted)', opacity: uploading ? .6 : 1 }}>
                {uploading && <span className="spinner spinner-primary" style={{ width: 14, height: 14 }} />}
                {uploading ? 'Uploading and scoring...' : 'Upload resume (PDF, DOCX, TXT)'}
                <input type="file" accept=".pdf,.docx,.txt" style={{ display: 'none' }} disabled={uploading} onChange={e => { const file = e.target.files[0]; e.target.value = ''; handleAttachmentUpload(file); }} />
              </label>
              {uploadError && <div className="auth-error" style={{ marginTop: 8 }}>{uploadError}</div>}
            </div>

            {attachmentsLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}><span className="spinner spinner-primary" /></div>
            ) : attachments.map(attachment => {
              const colors = scoreColor(attachment.atsScore);
              const isExpanded = expandedAttachment === attachment.id;
              return (
                <div key={attachment.id} className="profile-file-item">
                  <button type="button" className="profile-file-trigger" onClick={() => setExpandedAttachment(isExpanded ? null : attachment.id)} aria-expanded={isExpanded}>
                    <span style={{ fontSize: '.75rem', fontWeight: 800 }}>CV</span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <span style={{ display: 'block', fontWeight: 600, fontSize: '.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachment.filename}</span>
                      <span style={{ display: 'block', fontSize: '.7rem', color: 'var(--muted)' }}>{attachment.isPrimary ? 'Used for job matching' : 'Saved resume'}</span>
                    </span>
                    <span style={{ fontSize: '.72rem', fontWeight: 800, color: colors.text, background: colors.bg, border: `1px solid ${colors.border}`, padding: '3px 6px', borderRadius: 5 }}>{attachment.atsScore}/100</span>
                  </button>
                  {isExpanded && (
                    <div className="profile-file-details">
                      {(attachment.atsChecks || []).map((check, index) => <div key={index} style={{ fontSize: '.76rem', lineHeight: 1.45, color: check.passed ? 'var(--text)' : 'var(--muted)' }}>{check.label}{check.detail ? `: ${check.detail}` : ''}</div>)}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        {!attachment.isPrimary && <button type="button" className="btn btn-ghost btn-sm" disabled={selectingAttachment === attachment.id} onClick={() => handleAttachmentSelect(attachment.id)}>{selectingAttachment === attachment.id ? 'Saving...' : 'Use for matching'}</button>}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleAttachmentDownload(attachment)}>Download</button>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={deletingAttachment === attachment.id} onClick={() => handleAttachmentDelete(attachment.id)} style={{ color: 'var(--danger)' }}>{deletingAttachment === attachment.id ? 'Deleting...' : 'Delete'}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {editing === 'files' ? (
              <form onSubmit={handleFilesSave} style={{ marginTop: 14 }}>
                {error && <div className="auth-error" style={{ marginBottom: 10 }}>{error}</div>}
                {LINK_FIELDS.map(({ key, label, placeholder }) => (
                  <div className="form-group" key={key} style={{ marginBottom: 10 }}>
                    <label className="form-label">{label}</label>
                    <input className="form-input" type="url" name={key} value={links?.[key] || ''} onChange={handleLinkChange} placeholder={placeholder} />
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save links'}</button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </form>
            ) : hasLinks ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {LINK_FIELDS.filter(field => profileLinks[field.key]).map(({ key, label }) => <a key={key} href={profileLinks[key]} target="_blank" rel="noopener noreferrer" className="profile-link-row">{label}<span aria-hidden="true">&rarr;</span></a>)}
                <button className="btn btn-ghost btn-sm" type="button" onClick={startFileEdit} style={{ alignSelf: 'flex-start' }}>Edit links</button>
              </div>
            ) : (
              <button className="btn btn-ghost btn-sm" type="button" onClick={startFileEdit}>Add profile links</button>
            )}
          </ProfilePanel>
        </aside>}
      </div>

      {/* ── OVERVIEW TAB ─────────────────────────────────────── */}
      {false && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {/* Bio */}
          <div className="card">
            <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10 }}>About</h3>
            <p style={{ fontSize:'.9rem', lineHeight:1.7, color: profile.bio ? 'var(--text)' : 'var(--muted)' }}>
              {profile.bio || 'No bio yet - click Edit profile to add one.'}
            </p>
          </div>

          {/* Skills */}
          {Array.isArray(profile.skills) && profile.skills.length > 0 && (
            <div className="card">
              <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:10 }}>Skills</h3>
              <div className="tags">
                {profile.skills.map((s) => <span key={s} className="tag tag-primary">{s}</span>)}
              </div>
            </div>
          )}

          {/* Visibility */}
          <div className="card">
            <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:12 }}>Visibility</h3>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 }}>
              <div>
                <div style={{ fontWeight:600, fontSize:'.9rem', marginBottom:3 }}>
                  Profile visible to members
                </div>
                <div style={{ fontSize:'.8rem', color:'var(--muted)', lineHeight:1.5 }}>
                  Everyone with an account can find your profile, follow you, view your posts, and message you.
                </div>
              </div>
              <span style={{ flexShrink:0, fontSize:'.72rem', fontWeight:700, color:'#059669', background:'#ECFDF5', padding:'4px 10px', borderRadius:10 }}>
                Active
              </span>
            </div>
          </div>

          {/* Command Center */}
          <div
            className="card"
            style={{
              background: 'linear-gradient(135deg, #EDE4FF 0%, #E0F2FE 100%)',
              border: '1px solid #DDD6FE', cursor: 'pointer',
            }}
            onClick={() => navigate('/command-center')}
          >
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'#6D28D9', textTransform:'uppercase', letterSpacing:'.5px', margin:0 }}>
                    Command Center
                  </h3>
                  {profile.plan === 'free' && (
                    <span style={{ fontSize:'.62rem', fontWeight:800, color:'#fff', background:'#7C3AED', padding:'2px 7px', borderRadius:8, letterSpacing:'.4px' }}>
                      PRO
                    </span>
                  )}
                </div>
                <p style={{ fontSize:'.78rem', color:'#5B21B6', margin:0, lineHeight:1.5 }}>
                  Every connected account in one place - organized by source, AI content drafts, and job tracking.
                </p>
              </div>
              <button
                className="btn btn-sm"
                type="button"
                onClick={(e) => { e.stopPropagation(); navigate('/command-center'); }}
                style={{ flexShrink:0, background:'#7C3AED', color:'#fff', border:'none' }}
              >
                Open →
              </button>
            </div>
          </div>

          {/* Connected Accounts */}
          <div className="card" id="social">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
              <div>
                <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4 }}>Connected Accounts</h3>
                <p style={{ fontSize:'.78rem', color:'var(--muted)', margin:0, lineHeight:1.5 }}>
                  Connect your social accounts to bring your existing feeds into UFIconnect.
                </p>
              </div>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/connected-accounts')} style={{ flexShrink:0 }}>
                Manage →
              </button>
            </div>
          </div>

          {/* Preferences */}
          {profile.preferences && (
            <div className="card">
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', margin:0 }}>Preferences</h3>
                <Link to="/settings?tab=preferences">
                  <button className="btn btn-ghost btn-sm" type="button">Edit →</button>
                </Link>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                {profile.preferences.role && (
                  <div>
                    <div style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:3 }}>Role</div>
                    <div style={{ fontWeight:600, fontSize:'.875rem' }}>{profile.preferences.role}</div>
                  </div>
                )}
                {profile.preferences.experience && (
                  <div>
                    <div style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:3 }}>Experience</div>
                    <div style={{ fontWeight:600, fontSize:'.875rem' }}>{profile.preferences.experience}</div>
                  </div>
                )}
                {profile.preferences.goals?.length > 0 && (
                  <div style={{ gridColumn:'1/-1' }}>
                    <div style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:6 }}>Goals</div>
                    <div className="tags">{profile.preferences.goals.map((g) => <span key={g} className="tag">{g}</span>)}</div>
                  </div>
                )}
                {profile.preferences.interests?.length > 0 && (
                  <div style={{ gridColumn:'1/-1' }}>
                    <div style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:6 }}>Interests</div>
                    <div className="tags">{profile.preferences.interests.map((i) => <span key={i} className="tag tag-secondary">{i}</span>)}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── OVERVIEW EDIT FORM ───────────────────────────────── */}
      {false && (
        <form className="card" onSubmit={handleSave}>
          {error && <div className="auth-error" style={{ marginBottom:14 }}>{error}</div>}
          <div className="form-group">
            <label className="form-label">Full name</label>
            <input className="form-input" name="name" value={form.name} onChange={handleChange} />
          </div>
          <div className="form-group">
            <label className="form-label">Professional title</label>
            <input className="form-input" name="title" value={form.title} onChange={handleChange} placeholder="e.g. Senior Product Manager" />
          </div>
          <div className="form-group">
            <label className="form-label">Organization</label>
            <input className="form-input" name="organization" value={form.organization} onChange={handleChange} placeholder="Where do you work / study?" />
          </div>
          <div className="form-group">
            <label className="form-label">Bio</label>
            <textarea className="form-textarea" name="bio" value={form.bio} onChange={handleChange} placeholder="Tell people what you're working on..." />
          </div>
          <div className="form-group">
            <label className="form-label">Skills <span style={{ color:'var(--muted)', fontWeight:400 }}>(comma-separated)</span></label>
            <input className="form-input" name="skills" value={form.skills} onChange={handleChange} placeholder="React, Python, Product Strategy..." />
          </div>
          <div style={{ display:'flex', gap:10, marginTop:4 }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? <span className="spinner" /> : 'Save changes'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* ── POSTS TAB ───────────────────────────────────────── */}
      {false && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div className="card" style={{ maxWidth: 640 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
              <div>
                <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:4 }}>Your Posts</h3>
                <p style={{ fontSize:'.84rem', color:'var(--muted)', margin:0 }}>Posts you share with the UFIconnect community appear here.</p>
              </div>
              <Link to="/post" className="btn btn-primary btn-sm" style={{ textDecoration:'none' }}>Write a post</Link>
            </div>
          </div>
          <PostList
            posts={posts}
            loading={postsLoading}
            emptyTitle="No posts yet"
            emptyDesc="Write your first community post and it will appear on your profile."
            emptyAction={<Link to="/post" className="btn btn-primary btn-sm" style={{ textDecoration:'none' }}>Write a post</Link>}
            currentUserId={profile?.id}
            onPostDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
            onNearEnd={loadMorePosts}
          />
        </div>
      )}

      {/* ── SKILLS TAB ───────────────────────────────────────── */}
      {false && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <h3 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Your Skills</h3>

            {/* Existing badges */}
            {skills.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                {skills.map(s => (
                  <span
                    key={s}
                    className="tag tag-primary"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: '.82rem' }}
                  >
                    {s}
                    <button
                      type="button"
                      onClick={() => removeSkill(s)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1, fontSize: '.85rem', opacity: .7 }}
                    >×</button>
                  </span>
                ))}
              </div>
            ) : (
              <p style={{ color: 'var(--muted)', fontSize: '.88rem', marginBottom: 14 }}>No skills added yet. Add some below.</p>
            )}

            {/* Add input */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="form-input"
                placeholder="Add a skill (e.g. React, Python, UX Design)..."
                value={skillInput}
                onChange={e => setSkillInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSkill(); } }}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary btn-sm" type="button" onClick={addSkill} style={{ flexShrink: 0 }}>
                Add
              </button>
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
              <button className="btn btn-primary btn-sm" onClick={saveSkills} disabled={skillSaving}>
                {skillSaving ? <span className="spinner" /> : 'Save skills'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ATTACHMENTS TAB ──────────────────────────────────── */}
      {false && (
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          {/* Resume upload + ATS score */}
          <div className="card">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' }}>Resume / CV</h3>
              <span style={{ fontSize:'.72rem', color:'var(--muted)' }}>ATS-style scoring</span>
            </div>

            <label style={{
              display:'flex', alignItems:'center', gap:10, padding:'12px 14px',
              border:'2px dashed var(--border)', borderRadius:8, cursor: uploading ? 'default' : 'pointer',
              fontSize:'.875rem', color:'var(--muted)', opacity: uploading ? 0.6 : 1, marginBottom: uploadError ? 8 : 0,
            }}>
              {uploading && <span className="spinner" style={{ width:16, height:16 }} />}
              {uploading ? 'Uploading and scoring...' : 'Click to upload a resume (PDF, DOCX, or TXT - 8MB max)'}
              <input type="file" accept=".pdf,.docx,.txt" style={{ display:'none' }} disabled={uploading}
                onChange={e => { const file = e.target.files[0]; e.target.value = ''; handleAttachmentUpload(file); }} />
            </label>
            {uploadError && <div className="auth-error" style={{ marginTop: 8 }}>{uploadError}</div>}

            <div style={{ marginTop: 14, display:'flex', flexDirection:'column', gap:10 }}>
              {attachmentsLoading ? (
                <div style={{ display:'flex', justifyContent:'center', padding:'16px 0' }}><span className="spinner spinner-primary" /></div>
              ) : attachments.length === 0 ? (
                <div className="empty-state" style={{ padding:'20px 0' }}>
                  <div className="empty-icon">CV</div>
                  <div className="empty-title">No resume uploaded yet</div>
                  <div className="empty-desc">Upload one to get an ATS-style score and see which opportunities best match it.</div>
                </div>
              ) : attachments.map((a, idx) => {
                const colors = scoreColor(a.atsScore);
                const isExpanded = expandedAttachment === a.id;
                return (
                  <div key={a.id} style={{ border:'1.5px solid var(--border)', borderRadius:'var(--radius-sm)', overflow:'hidden' }}>
                    <button
                      onClick={() => setExpandedAttachment(isExpanded ? null : a.id)}
                      style={{ all:'unset', display:'flex', alignItems:'center', gap:12, padding:'12px 14px', width:'100%', boxSizing:'border-box', cursor:'pointer' }}
                    >
                      <span style={{ fontSize:'.8rem', fontWeight:800 }}>CV</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:600, fontSize:'.875rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.filename}</div>
                        <div style={{ fontSize:'.72rem', color:'var(--muted)' }}>
                          {new Date(a.createdAt).toLocaleDateString()} · {(a.fileSize / 1024).toFixed(0)} KB
                          {a.isPrimary && attachments.length > 1 && <span style={{ color:'var(--primary)', fontWeight:600 }}> · Used for opportunity matching</span>}
                        </div>
                      </div>
                      {/* Explicit selection (see POST /profile/attachments/:id/select) —
                          this used to be purely "whichever was uploaded most
                          recently," with no way to pick an older, more
                          relevant resume back up once a newer one existed. */}
                      {!a.isPrimary && attachments.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleAttachmentSelect(a.id); }}
                          disabled={selectingAttachment === a.id}
                          style={{
                            flexShrink: 0, fontSize: '.7rem', fontWeight: 600, padding: '4px 9px',
                            borderRadius: 'var(--radius-xs)', border: '1.5px solid var(--border)',
                            background: 'var(--surface)', color: 'var(--text)',
                            cursor: selectingAttachment === a.id ? 'default' : 'pointer',
                            opacity: selectingAttachment === a.id ? 0.6 : 1,
                          }}
                        >
                          {selectingAttachment === a.id ? '...' : 'Use for matching'}
                        </button>
                      )}
                      {/* Score next to the attachment, as asked */}
                      <span style={{
                        fontSize:'.8rem', fontWeight:800, padding:'4px 10px', borderRadius:20,
                        color: colors.text, background: colors.bg, border: `1px solid ${colors.border}`, flexShrink:0,
                      }}>
                        {a.atsScore}/100
                      </span>
                      <span style={{ color:'var(--muted)', fontSize:'.8rem', flexShrink:0 }}>{isExpanded ? '▲' : '▼'}</span>
                    </button>

                    {isExpanded && (
                      <div style={{ padding:'0 14px 14px', borderTop:'1px solid var(--border)' }}>
                        <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:12 }}>
                          {(a.atsChecks || []).map((c, i) => (
                            <div key={i} style={{ display:'flex', gap:8, fontSize:'.8rem', lineHeight:1.5 }}>
                              <span style={{ color: c.passed ? '#059669' : '#DC2626', flexShrink:0, fontWeight: 800 }}>{c.passed ? 'OK' : 'Fix'}</span>
                              <div>
                                <span style={{ fontWeight:600 }}>{c.label}</span>
                                {c.detail && <div style={{ color:'var(--muted)' }}>{c.detail}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div style={{ display:'flex', gap:8, marginTop:14 }}>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleAttachmentDownload(a)}>
                            Download
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleAttachmentDelete(a.id)}
                            disabled={deletingAttachment === a.id}
                            style={{ color:'#DC2626' }}
                          >
                            {deletingAttachment === a.id ? <span className="spinner" /> : 'Delete'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
              <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px' }}>Files &amp; Links</h3>
            </div>
            {hasLinks ? (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {LINK_FIELDS.filter(f => profileLinks[f.key]).map(({ key, label, icon }) => (
                  <a key={key} href={profileLinks[key]} target="_blank" rel="noopener noreferrer"
                    style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', border:'1.5px solid var(--border)', borderRadius:'var(--radius-sm)', textDecoration:'none', color:'var(--text)', transition:'all .15s' }}
                    onMouseOver={e => e.currentTarget.style.borderColor='var(--primary)'}
                    onMouseOut={e => e.currentTarget.style.borderColor='var(--border)'}
                  >
                    <span style={{ fontSize:'1.2rem' }}>{icon}</span>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:600, fontSize:'.875rem' }}>{label}</div>
                      <div style={{ fontSize:'.75rem', color:'var(--muted)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:280 }}>{profileLinks[key]}</div>
                    </div>
                    <span style={{ color:'var(--primary)', fontSize:'.8rem' }}>→</span>
                  </a>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ padding:'32px 0' }}>
                <div className="empty-icon">Files</div>
                <div className="empty-title">No files or links yet</div>
                <div className="empty-desc" style={{ marginBottom:14 }}>Upload your resume or add links to your portfolio, GitHub, and LinkedIn.</div>
                <button className="btn btn-primary btn-sm" onClick={startEdit}>Add files</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── ATTACHMENTS EDIT FORM ────────────────────────────── */}
      {false && (
        <form className="card" onSubmit={handleSave}>
          {error && <div className="auth-error" style={{ marginBottom:14 }}>{error}</div>}
          <h3 style={{ fontSize:'.85rem', fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.5px', marginBottom:16 }}>Files &amp; Links</h3>

          {/* Resume link (file uploads + ATS scoring happen from the Attachments tab directly) */}
          <div className="form-group">
            <label className="form-label">Resume / CV link <span style={{ color:'var(--muted)', fontWeight:400 }}>(optional, e.g. Google Drive)</span></label>
            <input className="form-input" type="url" name="resume"
              value={links?.resume?.startsWith('[') ? '' : (links?.resume || '')}
              onChange={handleLinkChange} placeholder="https://drive.google.com/..." />
            <span style={{ fontSize:'.72rem', color:'var(--muted)' }}>To upload a resume file and get an ATS score, use the upload box on the Attachments tab.</span>
          </div>

          {LINK_FIELDS.filter(f => f.key !== 'resume').map(({ key, label, icon, placeholder }) => (
            <div className="form-group" key={key}>
              <label className="form-label">{icon} {label}</label>
              <input className="form-input" type="url" name={key}
                value={links?.[key] || ''} onChange={handleLinkChange} placeholder={placeholder} />
            </div>
          ))}
          <div style={{ display:'flex', gap:10, marginTop:4 }}>
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? <span className="spinner" /> : 'Save'}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
    </Layout>
  );
}
