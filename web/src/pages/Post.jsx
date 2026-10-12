import PublishingTargets, { usePublishingTargets } from '../components/PublishingTargets';
import SnapFeedRail from '../components/SnapFeedRail';
﻿import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Link, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import PostList from '../components/PostList';
import PostPagesNavigation from '../components/PostPagesNavigation';
import usePostPages from '../hooks/usePostPages';
import client from '../api/client';
import { uploadMedia, MAX_UPLOAD_BYTES } from '../api/upload';
import { useToast } from '../contexts/ToastContext';
import EmojiPicker from '../components/EmojiPicker';
import PhotoPickerButton from '../components/PhotoPickerButton';
import { useScrollToRefresh } from '../hooks/useScrollToRefresh';
import { orderNewestFeedCohorts } from '../utils/feedOrdering';
import { SHOP_CURRENCIES, formatShopPost } from '../utils/shopPost.mjs';
import '../components/ShopPosts.css';

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

export function UfiFeedContent({ embedded = false, initialShop = false, composeOnly = false, categoryLabel = '', initialContent = '', initiallyOpen = false }) {
  return <UfiPostArea key={categoryLabel || (initialShop ? 'shop' : 'ufi')} embedded={embedded} initialShop={initialShop} composeOnly={composeOnly} categoryLabel={categoryLabel} initialContent={initialContent} initiallyOpen={initiallyOpen} />;
}

function UfiPostArea({ embedded, initialShop, composeOnly, categoryLabel, initialContent = '', initiallyOpen = false }) {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const composeRequested = searchParams.get('compose') === '1';
  const textareaRef = useRef(null);
  const topicButtonRef = useRef(null);
  const topicPanelRef = useRef(null);

  const [groups,   setGroups]   = useState([]);
  const groupId = initialShop ? 'ufi-shop' : 'ufi-general';
  const [selectedTopicIds, setSelectedTopicIds] = useState(initialShop ? ['ufi-shop'] : []);
  const [draftTopicIds, setDraftTopicIds] = useState([]);
  const [topicFilterOpen, setTopicFilterOpen] = useState(false);
  const [topicSearch, setTopicSearch] = useState('');
  const [content,  setContent]  = useState(initialContent);
  const [shopTitle, setShopTitle] = useState('');
  const [shopPrice, setShopPrice] = useState('');
  const [shopCurrency, setShopCurrency] = useState('USD');
  const [composing, setComposing] = useState(initiallyOpen);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // Photo/video attachment — uploads straight to Cloudinary the moment a
  // file is picked (see api/upload.js), not on submit, so the compose
  // button isn't sitting there uploading a video while the user waits.
  const [mediaFile,     setMediaFile]     = useState(null);
  const [mediaPreview,  setMediaPreview]  = useState(null);
  const [uploadedMedia, setUploadedMedia] = useState(null); // { url, type }
  const [uploading,     setUploading]     = useState(false);
  const [uploadProgress,setUploadProgress]= useState(0);
  const targets = usePublishingTargets({ enabled: composing, media: uploadedMedia });
  const [mediaError,    setMediaError]    = useState('');

  const placeholder = initialShop ? 'Describe the item, its condition, and collection or delivery details.' : categoryLabel ? 'What would you like to share about ' + categoryLabel.toLowerCase() + '?' : PROMPTS[Math.floor(Math.random() * PROMPTS.length)];

  useEffect(() => {
    if (composeOnly) return;
    client.get('/groups/internal')
      .then(({ data }) => {
        const internal = data.groups || [];
        setGroups(internal);
      })
      .catch(() => {});
  }, [initialShop, composeOnly]);

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
  const feedParams = new URLSearchParams();
  if (selectedTopicKey) feedParams.set('groupIds', selectedTopicKey);
  if (!initialShop) feedParams.set('scope', 'ufi');
  const feedPages = usePostPages({ endpoint: `/posts?${feedParams}`, viewerId: profile?.id,
    enabled: !composeOnly, orderPosts: orderNewestFeedCohorts });
  const feedTargetId = initialShop ? 'ufi-shop-posts' : 'ufi-community-posts';
  const scrollRefresh = useScrollToRefresh(feedPages.refresh,
    { enabled: !composeOnly && !feedPages.loading && feedPages.page === 1 });

  useEffect(() => {
    if (composeOnly) return undefined;
    const refreshSelectedFeed = () => feedPages.refresh();
    window.addEventListener('ufi:refresh-selected-feed', refreshSelectedFeed);
    return () => window.removeEventListener('ufi:refresh-selected-feed', refreshSelectedFeed);
  }, [composeOnly, feedPages.refresh]);

  const openCompose = useCallback(() => {
    setComposing(true);
    setTopicFilterOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    if (!composeRequested) return;
    openCompose();
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      next.delete('compose');
      return next;
    }, { replace: true });
  }, [composeRequested, openCompose, setSearchParams]);

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
    if (loading) return;
    if (uploading) { setError('Your photo/video is still uploading — one moment.'); return; }
    let postContent = content.trim();
    if (initialShop) {
      try { postContent = formatShopPost({ title: shopTitle, price: shopPrice, currency: shopCurrency, description: content }); }
      catch (failure) { setError(failure.message); return; }
    }
    setError('');
    setLoading(true);
    try {
      const payload = { content: postContent, mediaUrl: uploadedMedia?.url, mediaType: uploadedMedia?.type };
      await targets.publish(() => client.post(`/groups/${groupId}/posts`, payload), payload);
      setContent('');
      setShopTitle(''); setShopPrice('');
      resetMedia();
      setComposing(false);
      void feedPages.refresh();
      showToast('Post published!', 'success');
    } catch (failure) {
      setError(failure.message || 'Failed to publish. Please try again.');
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

      {!composeOnly && !initialShop && <div style={{ maxWidth: embedded ? 'none' : 640 }}><SnapFeedRail mode="ufi" /></div>}
      {!composeOnly && <div className="ufi-feed-toolbar" style={{ maxWidth: embedded ? 'none' : 640 }}>
        {initialShop && <Link to="/maps?landmark=shopping" className="btn btn-ghost btn-sm feed-toolbar-control">Shopping center map</Link>}
        <button type="button" className="btn btn-primary btn-sm feed-toolbar-control feed-toolbar-primary-action ufi-compose-button ufi-post-action" onClick={openCompose}>
          Post
        </button>
        {!initialShop && <div className="feed-topic-filter ufi-topic-filter">
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
        </div>}
      </div>}

      {composing && (
        <div className="card ufi-compose-card" style={{ maxWidth: embedded ? 'none' : 640 }}>
          {categoryLabel && <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 14px' }}>Post to {categoryLabel}</h2>}
          {initialShop && <><h2 className="shop-compose-heading">Create a Shop post</h2><p className="shop-compose-helper">Add your item details, then choose where to share it.</p></>}
          <form onSubmit={handleSubmit} aria-label={categoryLabel ? 'Create ' + categoryLabel + ' post' : initialShop ? 'Create Shop post' : 'Create UFI post'}>
            <PublishingTargets targets={targets} disabled={loading || uploading} />
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

            {initialShop && <div className="shop-compose-fields">
              <label>Item title<input className="form-input" required maxLength={120} value={shopTitle} onChange={event => { setShopTitle(event.target.value); setError(''); }} placeholder="What are you selling?" /></label>
              <label>Price<input className="form-input" required inputMode="decimal" maxLength={11} pattern="[0-9]{1,8}(\.[0-9]{1,2})?" value={shopPrice} onChange={event => { setShopPrice(event.target.value); setError(''); }} placeholder="0.00" /></label>
              <label>Currency<select aria-label="Currency" className="form-input" value={shopCurrency} onChange={event => setShopCurrency(event.target.value)}>{SHOP_CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}</select></label>
            </div>}
            {initialShop && <label className="form-label" htmlFor="ufi-shop-description">Description</label>}
            <textarea
              id={initialShop ? 'ufi-shop-description' : undefined}
              ref={textareaRef}
              className="form-textarea"
              rows={4}
              placeholder={placeholder}
              value={content}
              required={initialShop}
              maxLength={initialShop ? 1800 : 2000}
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
                  {content.length} / {initialShop ? 1800 : 2000}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setComposing(false); setContent(''); setShopTitle(''); setShopPrice(''); setError(''); resetMedia(); }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm ufi-post-action"
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
      {!composeOnly && <div id={feedTargetId} style={{ width: '100%', minWidth: 0, scrollMarginTop: 80 }}>
        <PostList
          posts={feedPages.items}
          shopMode={initialShop}
          loading={feedPages.loading && feedPages.items.length === 0}
          emptyTitle={shopActive ? 'No Shop posts yet' : 'Nothing here yet'}
          emptyDesc={shopActive ? 'Be the first member to share something in Shop.' : 'Be the first to post to the UFIconnect community.'}
          emptyAction={<button className="btn btn-primary btn-sm ufi-post-action" onClick={openCompose}>{shopActive ? 'Create a Shop post' : 'Write a post'}</button>}
          currentUserId={profile?.id}
          onPostUpdated={updated => feedPages.updateItems(posts => posts.map(post => post.id === updated.id ? { ...post, ...updated } : post))}
          onPostDeleted={() => feedPages.refresh()}
          maxWidth={null}
        />
        <PostPagesNavigation results={feedPages} targetId={feedTargetId} label={initialShop ? 'Shop post pages' : 'Community post pages'} />
      </div>}
    </ContentShell>
  );
}

export default function Post() {
  return <UfiFeedContent />;
}
