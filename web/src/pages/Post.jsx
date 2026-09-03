import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import PostList from '../components/PostList';
import client from '../api/client';
import { uploadMedia, MAX_UPLOAD_BYTES } from '../api/upload';
import { useToast } from '../contexts/ToastContext';
import EmojiPicker from '../components/EmojiPicker';
import PhotoPickerButton from '../components/PhotoPickerButton';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { orderNewestFeedCohorts } from '../utils/feedOrdering';

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

const PROMPTS = [
  "What are you working on this week?",
  "Share a lesson you learned recently.",
  "What's a tool or resource you'd recommend?",
  "What insight or win would you like to share?",
  "Ask the community something you've been wondering about.",
  "What's one thing you wish someone had told you earlier?",
];

const COMMUNITY_ICONS = {
  'ufi-general':  'GEN',
  'ufi-tech':     'TECH',
  'ufi-business': 'BIZ',
  'ufi-creative': 'CRT',
  'ufi-career':   'JOB',
  'ufi-wellness': 'WELL',
};

export function UfiFeedContent({ embedded = false }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const textareaRef = useRef(null);

  const [groups,   setGroups]   = useState([]);
  const [groupId,  setGroupId]  = useState('ufi-general');
  const [content,  setContent]  = useState('');
  const [composing, setComposing] = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [posted,   setPosted]   = useState(false);
  const [error,    setError]    = useState('');
  const [feed,     setFeed]     = useState([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const FEED_PAGE_SIZE = 40;

  // Photo/video attachment — uploads straight to Cloudinary the moment a
  // file is picked (see api/upload.js), not on submit, so the compose
  // button isn't sitting there uploading a video while the user waits.
  const [mediaFile,     setMediaFile]     = useState(null);
  const [mediaPreview,  setMediaPreview]  = useState(null);
  const [uploadedMedia, setUploadedMedia] = useState(null); // { url, type }
  const [uploading,     setUploading]     = useState(false);
  const [uploadProgress,setUploadProgress]= useState(0);
  const [mediaError,    setMediaError]    = useState('');

  const placeholder = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

  useEffect(() => {
    client.get('/groups/internal')
      .then(({ data }) => {
        const internal = data.groups || [];
        setGroups(internal);
        if (internal.length > 0) {
          const gen = internal.find(g => g.id === 'ufi-general');
          setGroupId(gen ? gen.id : internal[0].id);
        }
      })
      .catch(() => {});
  }, []);

  const loadRecentFeed = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setFeedLoading(true);
    try {
      const { data } = await client.get('/posts', { params: { limit: FEED_PAGE_SIZE } });
      setFeed(orderNewestFeedCohorts(data.posts || []));
      setFeedHasMore(!!data.hasMore);
    } catch {
      // Keep the last successful page visible during a refresh failure.
    } finally {
      setFeedLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecentFeed();
  }, [posted, loadRecentFeed]);

  useScrollToRefresh(
    () => loadRecentFeed({ silent: true }),
    { enabled: !feedLoading && !feedLoadingMore }
  );

  // Lets ImageLightbox's "max view" (opened from a post's photo/video) keep
  // pulling in more posts as the viewer scrolls near the end of what's
  // already loaded — see PostList's onNearEnd. Offset by feed.length rather
  // than a separate page counter since this list only ever grows by
  // appending here (a real refresh — `posted` toggling — replaces it
  // wholesale via the effect above, not through this path).
  async function loadMoreFeed() {
    if (feedLoadingMore || !feedHasMore) return;
    setFeedLoadingMore(true);
    try {
      const { data } = await client.get('/posts', { params: { limit: FEED_PAGE_SIZE, offset: feed.length } });
      const incoming = data.posts || [];
      setFeed(prev => {
        const knownIds = new Set(prev.map(p => p.id));
        return orderNewestFeedCohorts([...prev, ...incoming.filter(p => !knownIds.has(p.id))]);
      });
      setFeedHasMore(!!data.hasMore);
    } catch {}
    finally { setFeedLoadingMore(false); }
  }

  function openCompose() {
    setComposing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
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
      // err is either the /media/upload-signature request rejecting (axios
      // error, real backend message in err.response.data.message — e.g.
      // "Media upload is not configured yet." when Cloudinary env vars
      // aren't set) or the Cloudinary upload itself rejecting (plain Error
      // with Cloudinary's own message, see upload.js). Showing the real
      // message instead of a flat "try again" actually tells the user
      // whether retrying can possibly help.
      setMediaError(err?.response?.data?.message || err?.message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!content.trim() && !uploadedMedia) { setError('Write something or attach a photo/video before posting.'); return; }
    if (!groupId) { setError('Select a community to post in.'); return; }
    if (uploading) { setError('Your photo/video is still uploading — one moment.'); return; }
    setError('');
    setLoading(true);
    try {
      await client.post(`/groups/${groupId}/posts`, {
        content: content.trim(),
        mediaUrl: uploadedMedia?.url || undefined,
        mediaType: uploadedMedia?.type || undefined,
      });
      setContent('');
      resetMedia();
      setComposing(false);
      setPosted(p => !p); // trigger feed reload
      showToast('Post published!', 'success');
    } catch {
      setError('Failed to publish. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const ContentShell = embedded ? 'section' : Layout;

  return (
    <ContentShell className={embedded ? 'home-embedded-feed' : undefined}>
      {!embedded && <h1 className="page-title" style={{ marginBottom: 20 }}>UFI</h1>}

      {/* ── Compose card ── */}
      <div className="card" style={{ maxWidth: embedded ? 'none' : 640, marginBottom: 16 }}>
        {!composing ? (
          /* Collapsed — click to open */
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'text' }}
            onClick={openCompose}
          >
            <div className="avatar avatar-md" style={{ flexShrink: 0 }}>
              {initials(profile?.name)}
            </div>
            <div
              style={{
                flex: 1, padding: '10px 16px', borderRadius: 22,
                border: '1.5px solid var(--border)', background: 'var(--surface)',
                color: 'var(--muted)', fontSize: '.9rem',
              }}
            >
              {placeholder}
            </div>
            <button className="btn btn-primary btn-sm" style={{ minWidth: 80 }}>
              Post
            </button>
          </div>
        ) : (
          /* Expanded compose form */
          <form onSubmit={handleSubmit}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <div className="avatar avatar-md" style={{ flexShrink: 0, marginTop: 4 }}>
                {initials(profile?.name)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '.85rem', marginBottom: 2 }}>{profile?.name || 'You'}</div>
                <div style={{ fontSize: '.75rem', color: 'var(--muted)' }}>
                  {profile?.preferences?.role || profile?.title || 'UFIconnect Member'}
                </div>
              </div>
            </div>

            <textarea
              ref={textareaRef}
              className="form-textarea"
              rows={4}
              placeholder={placeholder}
              value={content}
              onChange={e => { setContent(e.target.value); setError(''); }}
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

            {/* Community pills */}
            {groups.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: '.73rem', color: 'var(--muted)', alignSelf: 'center', marginRight: 2 }}>Post to:</span>
                {groups.map(g => {
                  const sel = groupId === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGroupId(g.id)}
                      style={{
                        padding: '4px 12px', borderRadius: 'var(--radius-sm)', fontSize: '.78rem', fontWeight: sel ? 700 : 500,
                        border: `1.5px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                        background: sel ? 'var(--primary)' : 'var(--surface)',
                        color: sel ? '#fff' : 'var(--text)', cursor: 'pointer',
                      }}
                    >
                      {COMMUNITY_ICONS[g.id] || 'GR'} {g.name}
                    </button>
                  );
                })}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <PhotoPickerButton
                  onFileSelected={handleFileSelect}
                  accept="image/*,video/*"
                  disabled={!!mediaFile}
                  className="btn btn-ghost btn-sm"
                  label="Photo/Video"
                />
                <EmojiPicker textareaRef={textareaRef} value={content} onChange={setContent} />
                <span style={{ fontSize: '.72rem', color: content.length > 1800 ? '#DC2626' : 'var(--muted)' }}>
                  {content.length} / 2000
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setComposing(false); setContent(''); setError(''); resetMedia(); }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={loading || uploading || (!content.trim() && !uploadedMedia) || !groupId}
                  style={{ minWidth: 90 }}
                >
                  {loading ? <span className="spinner" /> : uploading ? 'Uploading...' : 'Publish'}
                </button>
              </div>
            </div>
            {error && <div className="auth-error" style={{ marginTop: 8 }}>{error}</div>}
          </form>
        )}
      </div>

      {/* ── Community feed ── */}
      <div style={{ maxWidth: embedded ? 'none' : 640 }}>
        <PostList
          posts={feed}
          loading={feedLoading}
          emptyTitle="Nothing here yet"
          emptyDesc="Be the first to post to the UFIconnect community."
          emptyAction={<button className="btn btn-primary btn-sm" onClick={openCompose}>Write a post</button>}
          currentUserId={profile?.id}
          onNearEnd={loadMoreFeed}
          maxWidth={embedded ? 'none' : 640}
        />
      </div>
    </ContentShell>
  );
}

export default function Post() {
  return <UfiFeedContent />;
}
