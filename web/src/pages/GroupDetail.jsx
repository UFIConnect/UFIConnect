import PostPagesNavigation from '../components/PostPagesNavigation';
import usePostPages from '../hooks/usePostPages';
import PublishingTargets, { usePublishingTargets } from '../components/PublishingTargets';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import PostList from '../components/PostList';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { uploadMedia, MAX_UPLOAD_BYTES } from '../api/upload';
import EmojiPicker from '../components/EmojiPicker';
import PhotoPickerButton from '../components/PhotoPickerButton';
import { orderNewestFeedCohorts } from '../utils/feedOrdering';
import { GroupInformation } from './Groups';
import ConfirmActionDialog from '../components/ConfirmActionDialog';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export default function GroupDetail() {
  const { id } = useParams();
  return <GroupPostArea key={id} id={id} />;
}

function GroupPostArea({ id }) {
  const navigate = useNavigate();
  const { profile, updateProfileLocally } = useAuth();
  const [group,   setGroup]   = useState(null);
  const [members, setMembers] = useState([]);
  const [joined,  setJoined]  = useState(false);
  const [joining, setJoining] = useState(false);
  const [loading, setLoading] = useState(true);

  const postPages = usePostPages({ endpoint: `/groups/${id}/posts`, viewerId: profile?.id, orderPosts: orderNewestFeedCohorts });
  const groupPosts = postPages.items;
  const postsLoading = postPages.loading && !groupPosts.length;
  const [composing,     setComposing]     = useState(false);
  const [content,       setContent]       = useState('');
  const [posting,       setPosting]       = useState(false);
  const [postError,     setPostError]     = useState('');
  const textareaRef = useRef(null);

  // Photo/video attachment — same direct-to-Cloudinary-on-select pattern as
  // Post.jsx's own composer (see api/upload.js): uploads the moment a file
  // is picked, not on submit, so Publish isn't sitting there uploading a
  // video while the user waits.
  const [mediaFile,     setMediaFile]     = useState(null);
  const [mediaPreview,  setMediaPreview]  = useState(null);
  const [uploadedMedia, setUploadedMedia] = useState(null); // { url, type }
  const [uploading,     setUploading]     = useState(false);
  const [uploadProgress,setUploadProgress]= useState(0);
  const targets = usePublishingTargets({ enabled: composing, group: true, media: uploadedMedia, content });
  const [mediaError,    setMediaError]    = useState('');

  // Only the group's own creator gets this at all — external/seeded groups
  // (subreddit-backed, etc.) have no createdBy, so this naturally never
  // shows for those regardless of who's viewing. The server also checks ownership.
  const [deleteModal,   setDeleteModal]   = useState(false);

  useEffect(() => {
    Promise.all([
      client.get(`/groups/${id}`),
      client.get(`/groups/${id}/members`),
    ]).then(([gRes, mRes]) => {
      const found = gRes.data.group || null;
      setGroup(found);
      setMembers(mRes.data.members || []);
      setJoined(Boolean(found?.isJoined));
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  useScrollToRefresh(postPages.refresh, { enabled: postPages.page === 1 && !postPages.loading });

  async function handleJoin() {
    if (joining || group?.isExternal || group?.canJoin === false) return;
    setJoining(true);
    try {
      const { data } = joined
        ? await client.delete(`/groups/${id}/join`)
        : await client.post(`/groups/${id}/join`);
      const nextJoined = Array.isArray(data.joinedGroups) ? data.joinedGroups : [];
      const nextGroup = data.group || {
        ...group,
        isJoined: !joined,
        members: Math.max(0, (group?.members || 0) + (joined ? -1 : 1)),
      };
      setJoined(Boolean(nextGroup.isJoined));
      setGroup(nextGroup);
      updateProfileLocally({ joinedGroups: nextJoined });
    } catch (err) { console.error(err); }
    finally { setJoining(false); }
  }

  async function handleDeleteGroup() {
    await client.delete(`/groups/${id}`);
    navigate('/?feed=groups');
  }

  useLayoutEffect(() => {
    if (composing) textareaRef.current?.focus();
  }, [composing]);

  function openCompose() {
    textareaRef.current?.focus();
    setComposing(true);
  }

  // Local preview URLs are only ever released explicitly (resetMedia) or on
  // unmount — revoking here too covers navigating away mid-compose.
  useEffect(() => () => { if (mediaPreview) URL.revokeObjectURL(mediaPreview); }, [mediaPreview]);

  function resetMedia() {
    if (mediaPreview) URL.revokeObjectURL(mediaPreview);
    setMediaFile(null);
    setMediaPreview(null);
    setUploadedMedia(null);
    setUploading(false);
    setUploadProgress(0);
    setMediaError('');
  }

  async function handleFileSelect(file) {
    if (!file) return;
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      setMediaError('Only photos and videos are supported.');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setMediaError(`File is too large (max ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB).`);
      return;
    }
    setMediaError('');
    setUploadedMedia(null);
    setMediaFile(file);
    setMediaPreview(URL.createObjectURL(file));
    setUploading(true);
    setUploadProgress(0);
    try {
      const result = await uploadMedia(file, setUploadProgress);
      setUploadedMedia(result);
    } catch (err) {
      setMediaError(err?.response?.data?.message || err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function handlePost(e) {
    e.preventDefault();
    if (!content.trim() && !uploadedMedia) { setPostError('Write something or attach a photo/video before posting.'); return; }
    if (posting) return;
    if (uploading) { setPostError('Your photo/video is still uploading — one moment.'); return; }
    setPostError('');
    setPosting(true);
    try {
      const payload = { content: content.trim(), mediaUrl: uploadedMedia?.url, mediaType: uploadedMedia?.type };
      const result = await targets.publish(() => client.post(`/groups/${id}/posts`, payload), payload);
      if (result?.data?.post) await postPages.refresh();
      setContent('');
      resetMedia();
      setComposing(false);
    } catch (err) {
      setPostError(err.response?.data?.message || err.message || 'Failed to publish. Please try again.');
    } finally {
      setPosting(false);
    }
  }

  if (loading) return <Layout><div style={{ textAlign:'center', padding:48 }}><span className="spinner spinner-primary" /></div></Layout>;
  if (!group)  return <Layout><div className="empty-state"><div className="empty-title">Group not found</div></div></Layout>;

  return (
    <Layout>
      {/* Back */}
      <button className="btn-back" style={{ marginBottom: 16 }} onClick={() => navigate(group.isExternal ? '/groups' : '/?feed=groups')}>
        <span className="btn-back-icon">‹</span> Back to Groups
      </button>

      <div style={{ marginBottom: 16 }}>
        <GroupInformation
          group={group}
          isJoined={joined}
          joining={joining}
          onJoin={handleJoin}
          onOpen={() => document.getElementById('group-posts')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          standalone
        />
      </div>

      {/* Danger zone — only the group's own creator ever sees this */}
      {group.createdBy && group.createdBy === profile?.id && (
        <div className="card" style={{ marginBottom: 16, borderColor: '#FCA5A5' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '.875rem' }}>Delete group</div>
              <div style={{ fontSize: '.75rem', color: 'var(--muted)', marginTop: 2 }}>
                Permanently remove {group.name} for everyone. This cannot be undone.
              </div>
            </div>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeleteModal(true)}>Delete group</button>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteModal && (
        <ConfirmActionDialog
          title={`Delete ${group.name}?`}
          errorMessage="Failed to delete group. Please try again."
          onClose={() => setDeleteModal(false)}
          onConfirm={handleDeleteGroup}
        >
          This will permanently delete the group and remove it from every member's joined groups. This action <strong>cannot be undone</strong>.
        </ConfirmActionDialog>
      )}

      {/* Post composer — only for joined members */}
      {joined && !group.isExternal && (
        <div className="card" style={{ marginBottom: 16 }}>
          {!composing ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'text' }} onClick={openCompose}>
              <div className="avatar avatar-md" style={{ flexShrink: 0 }}>{initials(profile?.name)}</div>
              <div style={{
                flex: 1, padding: '10px 16px', borderRadius: 22,
                border: '1.5px solid var(--border)', background: 'var(--surface)',
                color: 'var(--muted)', fontSize: '.9rem',
              }}>
                Share something with {group.name}…
              </div>
              <button className="btn btn-primary btn-sm ufi-post-action" style={{ minWidth: 80 }}>
                Post
              </button>
            </div>
          ) : (
            <form onSubmit={handlePost} aria-label={`Create post in ${group.name}`}>
              <PublishingTargets targets={targets} disabled={posting || uploading} />
              <textarea
                ref={textareaRef}
                className="form-textarea"
                rows={4}
                placeholder={`Share something with ${group.name}…`}
                value={content}
                onChange={(e) => { setContent(e.target.value); setPostError(''); }}
                style={{ resize: 'vertical', fontSize: '.93rem', lineHeight: 1.6, marginBottom: 10 }}
              />

              {/* Media preview */}
              {mediaPreview && (
                <div style={{ position: 'relative', marginBottom: 10, borderRadius: 'var(--radius)', overflow: 'hidden', background: '#000', maxHeight: 320 }}>
                  {mediaFile?.type.startsWith('video/') ? (
                    <video src={mediaPreview} controls style={{ width: '100%', maxHeight: 320, display: 'block' }} />
                  ) : (
                    <img src={mediaPreview} alt="" style={{ width: '100%', maxHeight: 320, objectFit: 'contain', display: 'block' }} />
                  )}
                  <button
                    type="button"
                    onClick={resetMedia}
                    aria-label="Remove media"
                    style={{
                      position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: '50%',
                      background: 'rgba(0,0,0,.6)', border: 'none', color: '#fff', fontSize: '1rem', cursor: 'pointer',
                    }}
                  >×</button>
                  {uploading && (
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: 'rgba(255,255,255,.3)' }}>
                      <div style={{ height: '100%', width: `${Math.round(uploadProgress * 100)}%`, background: 'var(--primary)', transition: 'width .15s' }} />
                    </div>
                  )}
                </div>
              )}
              {mediaError && <div className="auth-error" style={{ marginBottom: 10 }}>{mediaError}</div>}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <PhotoPickerButton
                    onFileSelected={handleFileSelect}
                    accept="image/*,video/*"
                    disabled={!!mediaFile}
                    className="btn btn-ghost btn-sm"
                    label="Photo/Video"
                  />
                  <EmojiPicker textareaRef={textareaRef} value={content} onChange={setContent} />
                  <span style={{ fontSize: '.72rem', whiteSpace: 'nowrap', color: content.length > 1800 ? '#DC2626' : 'var(--muted)' }}>
                    {content.length} / 2000
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setComposing(false); setContent(''); setPostError(''); resetMedia(); }}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm ufi-post-action" disabled={posting || uploading || (!content.trim() && !uploadedMedia)} style={{ minWidth: 90 }}>
                    {posting ? <span className="spinner" /> : uploading ? 'Uploading...' : 'Publish'}
                  </button>
                </div>
              </div>
              {postError && <div className="auth-error" style={{ marginTop: 8 }}>{postError}</div>}
            </form>
          )}
        </div>
      )}

      {/* Group posts */}
      <div id="group-posts" style={{ marginBottom: 16, scrollMarginTop: 80 }}>
        <PostList
          posts={groupPosts}
          loading={postsLoading}
          emptyTitle="No posts yet"
          emptyDesc={group.isExternal
            ? 'Posts will appear here when they are available from the source.'
            : joined ? 'Be the first to post in this group.' : 'Join the group to start the conversation.'}
          emptyAction={joined && !group.isExternal ? <button className="btn btn-primary btn-sm ufi-post-action" onClick={openCompose}>Write a post</button> : null}
          currentUserId={profile?.id}
          onPostDeleted={() => postPages.refresh()}
          maxWidth={null}
        />
        <PostPagesNavigation results={postPages} targetId="group-posts" label="Group post pages" />
      </div>

      {/* Members */}
      {!group.isExternal && <div className="card">
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 16 }}>
          Members ({members.length})
        </h2>
        {members.length === 0 ? (
          <div className="empty-state">
            <div className="empty-desc">No members listed yet.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {members.map((m) => (
              <div
                key={m.id}
                style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                onClick={() => navigate(m.id === profile?.id ? '/profile' : `/u/${m.id}`)}
              >
                <div className="avatar avatar-md">{initials(m.name)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '.9rem' }}>{m.name}</div>
                  <div style={{ fontSize: '.78rem', color: 'var(--muted)' }}>{m.title}</div>
                </div>
                {m.organization && (
                  <span style={{ fontSize: '.75rem', color: 'var(--muted)' }}>{m.organization}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>}
    </Layout>
  );
}
