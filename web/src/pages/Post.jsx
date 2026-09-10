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
  'ufi-shop':     'SHOP',
};

export function UfiFeedContent({ embedded = false, initialShop = false }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const textareaRef = useRef(null);
  const topicButtonRef = useRef(null);
  const topicPanelRef = useRef(null);

  const [groups,   setGroups]   = useState([]);
  const [groupId,  setGroupId]  = useState(initialShop ? 'ufi-shop' : 'ufi-general');
  const [selectedTopicIds, setSelectedTopicIds] = useState(initialShop ? ['ufi-shop'] : []);
  const [draftTopicIds, setDraftTopicIds] = useState([]);
  const [topicFilterOpen, setTopicFilterOpen] = useState(false);
  const [topicSearch, setTopicSearch] = useState('');
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
        if (initialShop && internal.some(group => group.id === 'ufi-shop')) {
          setGroupId('ufi-shop');
        } else if (internal.length > 0) {
          const gen = internal.find(g => g.id === 'ufi-general');
          setGroupId(gen ? gen.id : internal[0].id);
        }
      })
      .catch(() => {});
  }, [initialShop]);

  useEffect(() => {
    if (initialShop) {
      setSelectedTopicIds(['ufi-shop']);
      setGroupId('ufi-shop');
      return;
    }
    setSelectedTopicIds(current => (
      current.length === 1 && current[0] === 'ufi-shop' ? [] : current
    ));
    setGroupId(current => (
      current === 'ufi-shop'
        ? (groups.find(group => group.id === 'ufi-general')?.id || groups[0]?.id || 'ufi-general')
        : current
    ));
  }, [groups, initialShop]);

  useEffect(() => {
    if (!topicFilterOpen) return undefined;
    setDraftTopicIds(selectedTopicIds.filter(id => id !== 'ufi-shop'));
    setTopicSearch('');

    function closeTopics(event) {
      if (topicButtonRef.current?.contains(event.target) || topicPanelRef.current?.contains(event.target)) return;
      setTopicFilterOpen(false);
    }

    function closeTopicsOnEscape(event) {
      if (event.key === 'Escape') setTopicFilterOpen(false);
    }

    document.addEventListener('pointerdown', closeTopics);
    document.addEventListener('keydown', closeTopicsOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeTopics);
      document.removeEventListener('keydown', closeTopicsOnEscape);
    };
  }, [topicFilterOpen, selectedTopicIds]);

  const selectedTopicKey = selectedTopicIds.join(',');
  const loadRecentFeed = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setFeedLoading(true);
    try {
      const params = { limit: FEED_PAGE_SIZE };
      if (selectedTopicKey) params.groupIds = selectedTopicKey;
      const { data } = await client.get('/posts', { params: { ...params, scope: 'joined' } });
      setFeed(orderNewestFeedCohorts(data.posts || []));
      setFeedHasMore(!!data.hasMore);
    } catch {
      // Keep the last successful page visible during a refresh failure.
    } finally {
      setFeedLoading(false);
    }
  }, [selectedTopicKey]);

  useEffect(() => {
    loadRecentFeed();
  }, [posted, loadRecentFeed]);

  const scrollRefresh = useScrollToRefresh(
    () => loadRecentFeed({ silent: true }),
    { enabled: !feedLoading && !feedLoadingMore }
  );

  useEffect(() => {
    const refreshSelectedFeed = () => loadRecentFeed({ silent: true });
    window.addEventListener('ufi:refresh-selected-feed', refreshSelectedFeed);
    return () => window.removeEventListener('ufi:refresh-selected-feed', refreshSelectedFeed);
  }, [loadRecentFeed]);

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
      const params = { limit: FEED_PAGE_SIZE, offset: feed.length };
      if (selectedTopicKey) params.groupIds = selectedTopicKey;
      const { data } = await client.get('/posts', { params: { ...params, scope: 'joined' } });
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
    setTopicFilterOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }

  function toggleDraftTopic(topicId) {
    setDraftTopicIds(current => current.includes(topicId)
      ? current.filter(id => id !== topicId)
      : [...current, topicId]);
  }

  function applyTopicFilter() {
    setSelectedTopicIds(draftTopicIds.filter(id => id !== 'ufi-shop'));
    setTopicFilterOpen(false);
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
  const shopActive = selectedTopicIds.length === 1 && selectedTopicIds[0] === 'ufi-shop';
  const selectedTopicCount = shopActive ? 0 : selectedTopicIds.length;
  const normalizedTopicSearch = topicSearch.trim().toLowerCase();
  const topicGroups = groups.filter(group => group.id !== 'ufi-shop');
  const visibleTopicGroups = normalizedTopicSearch
    ? topicGroups.filter(group => `${group.name} ${group.category || ''}`.toLowerCase().includes(normalizedTopicSearch))
    : topicGroups;

  return (
    <ContentShell className={embedded ? 'home-embedded-feed' : undefined}>
      {(scrollRefresh.pulling || scrollRefresh.refreshing) && (
        <div className="scroll-refresh-status" role="status" aria-live="polite">
          {scrollRefresh.refreshing
            ? <span className="spinner spinner-primary" />
            : <span className="scroll-refresh-progress" style={{ '--scroll-refresh-progress': scrollRefresh.progress }} />}
          <span>{scrollRefresh.refreshing ? 'Refreshing UFI' : scrollRefresh.progress >= 1 ? 'Release to refresh' : 'Pull to refresh'}</span>
        </div>
      )}
      {!embedded && <h1 className="page-title" style={{ marginBottom: 20 }}>UFI</h1>}

      <div className="ufi-feed-toolbar" style={{ maxWidth: embedded ? 'none' : 640 }}>
        <button type="button" className="btn btn-primary btn-sm feed-toolbar-control feed-toolbar-primary-action ufi-compose-button" onClick={openCompose}>
          Post
        </button>
        <div className="feed-topic-filter ufi-topic-filter">
          <button
            ref={topicButtonRef}
            type="button"
            className={`feed-toolbar-control feed-topic-filter-trigger${topicFilterOpen || selectedTopicCount ? ' active' : ''}`}
            aria-label="Filter UFI posts by topic"
            aria-expanded={topicFilterOpen}
            aria-controls="ufi-topic-filter-panel"
            onClick={() => setTopicFilterOpen(open => !open)}
          >
            Topics{selectedTopicCount ? ` (${selectedTopicCount})` : ''}
          </button>
          {topicFilterOpen && (
            <div ref={topicPanelRef} id="ufi-topic-filter-panel" className="feed-topic-filter-popover">
              <div className="feed-topic-filter-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={draftTopicIds.length === 0}
                  onClick={() => setDraftTopicIds([])}
                >
                  Clear
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={applyTopicFilter}>
                  Apply topics
                </button>
              </div>
              <label className="feed-topic-filter-search">
                <input
                  type="search"
                  className="form-input"
                  aria-label="Search UFI topics"
                  value={topicSearch}
                  placeholder="Search topics"
                  autoFocus
                  onChange={event => setTopicSearch(event.target.value)}
                />
              </label>
              <div className="feed-topic-filter-count" aria-live="polite">
                {draftTopicIds.length ? `${draftTopicIds.length} selected` : 'All topics'}
              </div>
              {visibleTopicGroups.length > 0 ? (
                <div className="feed-topic-filter-options" role="group" aria-label="UFI topics">
                  {visibleTopicGroups.map(group => {
                    const active = draftTopicIds.includes(group.id);
                    return (
                      <button
                        key={group.id}
                        type="button"
                        className={`feed-topic-filter-option${active ? ' active' : ''}`}
                        aria-pressed={active}
                        onClick={() => toggleDraftTopic(group.id)}
                      >
                        {group.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="feed-topic-filter-empty">No matching topics</div>
              )}
            </div>
          )}
        </div>
      </div>

      {composing && (
        <div className="card ufi-compose-card" style={{ maxWidth: embedded ? 'none' : 640 }}>
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
        </div>
      )}

      {/* ── Community feed ── */}
      <div style={{ maxWidth: embedded ? 'none' : 640 }}>
        <PostList
          posts={feed}
          loading={feedLoading}
          emptyTitle={shopActive ? 'No Shop posts yet' : 'Nothing here yet'}
          emptyDesc={shopActive ? 'Be the first member to share something in Shop.' : 'Be the first to post to the UFIconnect community.'}
          emptyAction={<button className="btn btn-primary btn-sm" onClick={openCompose}>{shopActive ? 'Create a Shop post' : 'Write a post'}</button>}
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
