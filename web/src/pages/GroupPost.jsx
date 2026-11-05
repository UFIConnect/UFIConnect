import PublishingTargets, { usePublishingTargets } from '../components/PublishingTargets';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PhotoPickerButton from '../components/PhotoPickerButton';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import { uploadMedia, MAX_UPLOAD_BYTES } from '../api/upload';

export default function GroupPost() {
  const { profile } = useAuth();
  const [params] = useSearchParams();
  const [groups, setGroups] = useState([]);
  const [groupId, setGroupId] = useState(params.get('group') || '');
  const [content, setContent] = useState('');
  const [media, setMedia] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const [postedGroup, setPostedGroup] = useState(null);
  const [retry, setRetry] = useState(0);
  const targets = usePublishingTargets({ group: true, media, content });
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setGroups([]);
    client.get('/groups/internal').then(({ data }) => {
      if (cancelled) return;
      const joined = new Set(profile?.joinedGroups || []);
      const available = (data.groups || []).filter(group => !group.isExternal && !['ufi-general', 'ufi-shop'].includes(group.id) && (joined.has(group.id) || group.createdBy === profile?.id || group.isJoined));
      setGroups(available);
      setGroupId(current => available.some(group => group.id === current) ? current : '');
    }).catch(() => { if (!cancelled) setError('Your groups could not be loaded. Please try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [profile?.id, JSON.stringify(profile?.joinedGroups), retry]);

  async function attach(file) {
    if (!file) return;
    if (!/^(image|video)\//.test(file.type) || file.size > MAX_UPLOAD_BYTES) { setError('Choose a photo or video no larger than 100 MB.'); return; }
    setUploading(true); setError('');
    try { const result = await uploadMedia(file); setMedia(result); }
    catch (err) { setError(err.message || 'The attachment could not be uploaded.'); }
    finally { setUploading(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (posting || uploading || !groupId || !groups.some(group => group.id === groupId) || (!content.trim() && !media)) return;
    setPosting(true); setError('');
    try {
      const payload = { content: content.trim(), mediaUrl: media?.url, mediaType: media?.type };
      const groupResult = await targets.publish(() => client.post(`/groups/${encodeURIComponent(groupId)}/posts`, payload), payload);
      setPostedGroup(groupResult ? groups.find(group => group.id === groupId) : null); setContent(''); setMedia(null);
    } catch (err) { setError(err.response?.data?.message || err.message || 'Your post could not be published. Please try again.'); }
    finally { setPosting(false); }
  }
  return <Layout><main className="saved-page">
    <h1>Post to your group</h1><p>Share an update with a community you have joined.</p>
    {error && <div className="auth-error" role="alert">{error}{!groups.length && <button className="btn btn-ghost" onClick={() => setRetry(value => value + 1)}>Try again</button>}</div>}
    {postedGroup && <div className="card" role="status">Posted to {postedGroup.name}. <Link to={`/groups/${encodeURIComponent(postedGroup.id)}`}>View group</Link></div>}
    {loading ? <p role="status">Loading your groups…</p> : !groups.length ? <div className="card"><p>Join or create a UFIconnect group to share a post.</p><Link className="btn btn-primary" to="/groups">Find a group</Link></div> : <form className="card" onSubmit={submit}>
      <PublishingTargets targets={targets} disabled={posting || uploading} />
      <label className="form-label" htmlFor="post-group">Select a group to post to</label>
      <select id="post-group" className="form-input" value={groupId} disabled={posting} onChange={event => { setGroupId(event.target.value); setPostedGroup(null); }} required>
        <option value="">Select a group</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}{group.isPrivate ? ' (Private)' : ''}</option>)}
      </select>
      <label className="form-label" htmlFor="group-post-content" style={{ marginTop: 18 }}>Your post</label>
      <textarea id="group-post-content" className="form-textarea" rows={6} maxLength={5000} value={content} disabled={posting} onChange={event => setContent(event.target.value)} placeholder="What would you like to share?" />
      {media && <div>{media.type === 'video' ? <video controls src={media.url} style={{ maxWidth: '100%' }} /> : <img alt="Attachment preview" src={media.url} style={{ maxWidth: '100%', maxHeight: 280 }} />}<button type="button" className="btn btn-ghost" disabled={posting} onClick={() => setMedia(null)}>Remove attachment</button></div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14 }}><PhotoPickerButton onFileSelected={attach} accept="image/*,video/*" disabled={uploading || posting} />
        <button className="btn btn-primary ufi-post-action" type="submit" disabled={posting || uploading || !groupId || (!content.trim() && !media)}>{uploading ? 'Uploading…' : posting ? 'Publishing…' : 'Post to group'}</button></div>
    </form>}
  </main></Layout>;
}
