import { privateSessionStorage } from '../auth/session';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Workflow, Link2, BriefcaseBusiness, Sparkles, Clapperboard, Send, Newspaper, Image, Video, Hash, PencilLine } from 'lucide-react';
import Layout from '../components/Layout';
import PricingModal, { TIERS } from '../components/PricingModal';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import client, { publicOAuthRequestConfig } from '../api/client';
import { SOURCE_META, CONNECTED_SOCIAL_PLATFORMS, CAREER_ACCOUNT_PLATFORMS, withCareerAccountFallback } from '../components/sourceMeta';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import PhotoPickerButton from '../components/PhotoPickerButton';
import { uploadMedia, MAX_UPLOAD_BYTES } from '../api/upload';
import { useSavedItems } from '../contexts/SavedItemsContext';
import GeneratedContentHistory from '../components/GeneratedContentHistory';
import PostInlineText from '../components/PostInlineText';
import PostLinkPreviews from '../components/PostLinkPreviews';
import { safePostLink } from '../../../backend/post-links.mjs';

import VideoDurationControl, { VIDEO_DURATION_LIMIT } from '../components/VideoDurationControl';
import { DirectoryControls, AccountSiteLink } from '../components/DirectoryControls';
import { ACCOUNT_STATUSES, accountSections, filterAccounts } from '../components/sourceDirectory';
import { DISCOVERY_CATEGORIES, discoveryPostContext } from '../components/discoveryCategories';
import '../components/DiscoveryCategoryBar.css';
import './CommandCenterPlatforms.css';
import CONTENT_PLATFORMS from '../../../backend/content-platforms.json';

// Compatibility with an older API during a rolling deployment. New own-post
// integrations activate only when the server advertises their capability.
// A working account connection alone does not imply own-post access.
const OWN_CONTENT_PLATFORMS = ['github', 'gitlab', 'youtube', 'reddit', 'twitch', 'instagram', 'tiktok', 'threads', 'bluesky', 'mastodon'];

function supportsOwnContent(platform, catalog = {}) {
  const supported = catalog[platform]?.ownContent?.supported;
  return typeof supported === 'boolean' ? supported : OWN_CONTENT_PLATFORMS.includes(platform);
}

function SourceMark({ source, label, active = false }) {
  const meta = SOURCE_META[source] || {};
  if (hasBrandIcon(source)) {
    return (
      <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', background: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)', flexShrink: 0 }}>
        <BrandIcon platform={source} size={14} />
      </span>
    );
  }
  return (
    <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: '50%', background: active ? 'rgba(255,255,255,.22)' : `${meta.color || 'var(--primary)'}18`, color: active ? '#fff' : meta.color || 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 900, flexShrink: 0 }}>
      {String(label || meta.icon || source || 'UFI').slice(0, 3).toUpperCase()}
    </span>
  );
}

const SECTIONS = [
  { key: 'automation', label: 'Automation', icon: Workflow },
  { key: 'accounts',   label: 'Connected Accounts', icon: Link2 },
  { key: 'jobs',       label: 'Job Tracker', icon: BriefcaseBusiness },
  { key: 'content',    label: 'AI Content Hub', icon: Sparkles },
  { key: 'media',      label: 'Media Studio', icon: Clapperboard },
  { key: 'crosspost',  label: 'Cross-Post', icon: Send },
  { key: 'yourfeed',   label: 'Your Feed', icon: Newspaper },
];
const SECTION_KEYS = new Set(SECTIONS.map(section => section.key));

function commandCenterSection(search) {
  const requested = new URLSearchParams(search).get('tab');
  return SECTION_KEYS.has(requested) ? requested : 'automation';
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function StatChip({ label, value }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 16px', minWidth: 96 }}>
      <div style={{ fontSize: '1.3rem', fontWeight: 800, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '.68rem', color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
    </div>
  );
}

function LockedState({ onUpgrade }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: '52px 24px' }}>
      <div style={{ fontSize: '.8rem', fontWeight: 900, letterSpacing: '.08em', color: 'var(--primary)', marginBottom: 12 }}>COMMAND CENTER</div>
      <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 8px' }}>Unlock the Command Center</h2>
      <p style={{ color: 'var(--muted)', fontSize: '.88rem', maxWidth: 440, margin: '0 auto 22px', lineHeight: 1.6 }}>
        See everything from your connected accounts in one place, draft social
        content with AI, and track your job search with Pro. Business membership
        provides a workspace for recruiting companies.
      </p>
      <div className="command-center-pricing" aria-label="Command Center plans">
        {TIERS.map((tier) => (
          <div className="command-center-price" key={tier.tier}>
            <span className="command-center-price-name">
              {tier.name}
            </span>
            <strong>${tier.price}<small>/mo</small></strong>
          </div>
        ))}
      </div>
      <button className="btn btn-primary" type="button" onClick={onUpgrade}>Upgrade to unlock</button>
    </div>
  );
}

function SectionError({ message, onRetry }) {
  return (
    <div className="card command-center-error" role="alert">
      <span>{message}</span>
      {onRetry && <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

function DraftPlatformSelect({ value, onChange, label }) {
  const groups = [['social', 'Social'], ['video', 'Video & Streaming'], ['work', 'Work & Development'], ['publishing', 'Publishing']].map(([id, label]) => ({ id, label, items: CONTENT_PLATFORMS.filter(platform => platform.category === id) }));
  return (
    <label className="cc-draft-platform">
      <span>{label}</span>
      <div className="cc-draft-platform-control">
        {value === 'general' || value === 'hashnode' ? <PencilLine size={20} aria-hidden="true" /> : <SourceMark source={value} />}
        <select className="form-select" aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
          {groups.map(group => <optgroup key={group.id} label={group.label}>
            {group.items.map(platform => <option key={platform.id} value={platform.id}>{platform.label}</option>)}
          </optgroup>)}
          <option value="general">General</option>
        </select>
      </div>
    </label>
  );
}

function ContentDraftResults({ drafts, hashtagGroups, onCopy }) {
  if (!drafts?.length && !hashtagGroups?.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {drafts?.map((draft, index) => (
        <div key={`draft-${index}`} className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: '.86rem', lineHeight: 1.6, flex: 1 }}>{draft}</p>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => onCopy(draft)} style={{ flexShrink: 0 }}>Copy</button>
          </div>
        </div>
      ))}
      {hashtagGroups?.map((group, index) => {
        const text = group.hashtags.join(' ');
        return (
          <div key={`${group.label}-${index}`} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <strong style={{ fontSize: '.85rem' }}>{group.label}</strong>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => onCopy(text)}>Copy set</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {group.hashtags.map(tag => <span key={tag} className="tag tag-primary">{tag}</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Drafting targets do not imply publishing access. Cross-Post separately checks
// the member's connections and the server's current publishing capabilities.
function ContentHubSection({ readOnly = false }) {
  const { showToast } = useToast();
  const [platform, setPlatform] = useState('tiktok');
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState(null);
  const [draftError, setDraftError] = useState('');
  const [historyRevision, setHistoryRevision] = useState(0);
  const formTop = useRef(null);
  const [hashtagPlatform, setHashtagPlatform] = useState('tiktok');
  const [hashtagTopic, setHashtagTopic] = useState('');
  const [hashtagAudience, setHashtagAudience] = useState('');
  const [hashtagLocation, setHashtagLocation] = useState('');
  const [draftingHashtags, setDraftingHashtags] = useState(false);
  const [hashtagGroups, setHashtagGroups] = useState(null);

  async function handleDraft(e) {
    e.preventDefault();
    if (!topic.trim() || drafting) return;
    setDrafting(true);
    setDrafts(null);
    setDraftError('');
    try {
      const { data } = await client.post('/command-center/content-draft', { platform, topic, tone }, { timeout: 90000 });
      setDrafts(data.drafts || []);
      setHashtagTopic(current => current.trim() ? current : topic.trim());
      setHistoryRevision(value => value + 1);
    } catch (err) {
      if (err?.response?.data?.drafts) setDrafts(err.response.data.drafts);
      setDraftError(err?.response?.data?.message || 'Could not generate drafts. Please try again.');
    } finally {
      setDrafting(false);
    }
  }

  function copyDraft(text) {
    navigator.clipboard?.writeText(text)
      .then(() => showToast('Copied to clipboard', 'success'))
      .catch(() => showToast('Could not copy — select and copy manually.', 'error'));
  }

  async function handleHashtagDraft(e) {
    e.preventDefault();
    const topicForHashtags = hashtagTopic.trim() || topic.trim();
    if (!topicForHashtags) {
      showToast('Add a topic before drafting hashtags.', 'error');
      return;
    }
    if (draftingHashtags) return;
    setDraftingHashtags(true);
    setHashtagGroups(null);
    setDraftError('');
    try {
      const { data } = await client.post('/command-center/hashtag-draft', {
        platform: hashtagPlatform,
        topic: topicForHashtags,
        audience: hashtagAudience,
        location: hashtagLocation,
      }, { timeout: 90000 });
      setHashtagGroups(data.groups || []);
      setHistoryRevision(value => value + 1);
    } catch (err) {
      if (err?.response?.data?.groups) setHashtagGroups(err.response.data.groups);
      setDraftError(err?.response?.data?.message || 'Could not generate hashtags. Please try again.');
    } finally {
      setDraftingHashtags(false);
    }
  }

  return (
    <div ref={formTop} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {draftError && <div role="alert"><SectionError message={draftError} /></div>}
      {!readOnly && <>
      <div className="card">
        <h3 style={{ margin: '0 0 4px', fontSize: '.95rem', display: 'flex', alignItems: 'center', gap: 8 }}><Sparkles size={19} aria-hidden="true" /> Draft new content</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.8rem', margin: 0 }}>
          Create platform-specific posts, captions, and article drafts. Review the result, then copy it to your platform or use an available Cross-Post connection.
        </p>
        <form onSubmit={handleDraft} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <DraftPlatformSelect value={platform} onChange={setPlatform} label="Content platform" />
          <div>
            <label style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>What's the post about?</label>
            <textarea
              value={topic} onChange={e => setTopic(e.target.value)} rows={3}
              placeholder="e.g. Launching my new side project, a productivity app for freelancers"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.85rem', fontFamily: 'inherit', resize: 'vertical' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>Tone (optional)</label>
            <input
              value={tone} onChange={e => setTone(e.target.value)}
              placeholder="e.g. playful, professional, bold"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.85rem' }}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={drafting || !topic.trim()} style={{ alignSelf: 'flex-start' }}>
            {drafting ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Draft with AI'}
          </button>
        </form>
      </div>
      <ContentDraftResults drafts={drafts} onCopy={copyDraft} />

      <div className="card">
        <h3 style={{ margin: '0 0 4px', fontSize: '.95rem', display: 'flex', alignItems: 'center', gap: 8 }}><Hash size={19} aria-hidden="true" /> Hashtag creator</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.8rem', margin: 0 }}>
          Draft focused hashtag sets for the post and audience you have in mind.
        </p>
        <form onSubmit={handleHashtagDraft} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <DraftPlatformSelect value={hashtagPlatform} onChange={setHashtagPlatform} label="Hashtag platform" />
          <div>
            <label style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 6 }}>What's the post about?</label>
            <textarea
              value={hashtagTopic} onChange={e => setHashtagTopic(e.target.value)} rows={2}
              placeholder="e.g. Showing the first demo of my budgeting app"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.85rem', fontFamily: 'inherit', resize: 'vertical' }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
            <input
              value={hashtagAudience} onChange={e => setHashtagAudience(e.target.value)}
              placeholder="Audience (optional)"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.85rem' }}
            />
            <input
              value={hashtagLocation} onChange={e => setHashtagLocation(e.target.value)}
              placeholder="Location (optional)"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.85rem' }}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={draftingHashtags} style={{ alignSelf: 'flex-start' }}>
            {draftingHashtags ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Draft hashtags'}
          </button>
        </form>
      </div>
      <ContentDraftResults hashtagGroups={hashtagGroups} onCopy={copyDraft} />
      </>}
      <GeneratedContentHistory section="content" revision={historyRevision} onReuse={readOnly || drafting || draftingHashtags ? undefined : item => {
        if (item.kind === 'hashtags') {
          setHashtagTopic(item.prompt); setHashtagPlatform(item.input.platform || 'general');
          setHashtagAudience(item.input.audience || ''); setHashtagLocation(item.input.location || '');
          setHashtagGroups(item.output.groups || null);
        } else {
          setTopic(item.prompt); setPlatform(item.input.platform || 'general'); setTone(item.input.tone || '');
          setDrafts(item.output.drafts || null);
        }
        formTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }} />
    </div>
  );
}

function dataUrlToFile(dataUrl, name) {
  const [header, encoded] = String(dataUrl || '').split(',');
  const mime = header.match(/data:([^;]+)/)?.[1] || 'image/png';
  const binary = atob(encoded || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

function MediaStudioSection({ onOpenCrossPost, readOnly = false }) {
  const [type, setType] = useState('image');
  const [prompt, setPrompt] = useState('');
  const [videoSeconds, setVideoSeconds] = useState(12);
  const [videoOptions, setVideoOptions] = useState(null);
  const [videoOptionsError, setVideoOptionsError] = useState('');
  const [optionsRevision, setOptionsRevision] = useState(0);
  const { profile: studioProfile } = useAuth();
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [asset, setAsset] = useState(null);
  const [error, setError] = useState('');
  const [generationStatus, setGenerationStatus] = useState('');
  const generationRequest = useRef(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const formTop = useRef(null);

  useEffect(() => {
    if (type !== 'video' || readOnly) return undefined;
    let cancelled = false;
    setVideoOptions(null); setVideoOptionsError('');
    client.get('/command-center/media-options').then(({ data }) => {
      if (cancelled) return;
      if (!data.video || !Array.isArray(data.video.shortClipSeconds)) throw new Error('Invalid video options');
      setVideoOptions(data.video);
    }).catch(() => { if (!cancelled) setVideoOptionsError('Video availability could not be checked.'); });
    return () => { cancelled = true; };
  }, [type, readOnly, studioProfile?.id, optionsRevision]);

  const durationSeconds = Number(videoSeconds);
  const validDuration = Number.isInteger(durationSeconds) && durationSeconds >= 4 && durationSeconds <= VIDEO_DURATION_LIMIT;
  const videoAvailable = validDuration && videoOptions
    && (videoOptions.longFormConfigured || videoOptions.shortClipSeconds.includes(durationSeconds));

  useEffect(() => () => {
    generationRequest.current += 1;
  }, []);

  async function waitForVideo(job, requestId, historyId) {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      if (requestId !== generationRequest.current) return null;
      const response = historyId
        ? await client.post(`/command-center/history/${encodeURIComponent(historyId)}/refresh`, {}, { timeout: 180000 })
        : await client.get(`/command-center/media-generate/${encodeURIComponent(job.id)}`, {
        params: { ticket: job.ticket },
        timeout: 180000,
      });
      const data = historyId ? { ...response.data.item?.output,
        job: { status: response.data.item?.status, error: response.data.item?.output?.error } } : response.data;
      if (requestId !== generationRequest.current) return null;
      const latest = data.job || {};
      if (latest.status === 'failed') throw new Error(latest.error || 'Video generation failed.');
      if (latest.status === 'completed') {
        if (data.mediaUrl) {
          setHistoryRevision(value => value + 1);
          return { url: data.mediaUrl, type: 'video' };
        }
        if (!data.downloadPath) throw new Error('The finished video is not available yet. Please try again.');
        setGenerationStatus('Saving your finished video...');
        setUploading(true);
        const download = await client.get(data.downloadPath, { responseType: 'blob' });
        if (requestId !== generationRequest.current) return null;
        const blob = download.data;
        if (!blob?.size) throw new Error('The finished video download was empty. Please try again.');
        if (blob.size > MAX_UPLOAD_BYTES) throw new Error('The finished video is larger than the upload limit.');
        const file = new File([blob], `ufi-video-${Date.now()}.mp4`, { type: blob.type || 'video/mp4' });
        const uploaded = await uploadMedia(file, null, 'crossposts');
        if (requestId !== generationRequest.current) return null;
        return { url: uploaded.url, type: 'video' };
      }
      const progress = Number(latest.progress);
      const percentage = Number.isFinite(progress) && progress > 0 ? ` (${Math.round(progress)}%)` : '';
      setGenerationStatus(latest.status === 'queued'
        ? `Your video is queued${percentage}`
        : `Creating your video${percentage}`);
      await new Promise(resolve => window.setTimeout(resolve, historyId ? 5000 : 2500));
    }
    throw new Error('Your video is still processing. Check its status in your saved media shortly; you do not need to generate it again.');
  }

  async function generate(e) {
    e.preventDefault();
    if (!prompt.trim() || generating || (type === 'video' && !videoAvailable)) return;
    const requestId = generationRequest.current + 1;
    generationRequest.current = requestId;
    setGenerating(true); setUploading(false); setError(''); setAsset(null); setGenerationStatus('Preparing your request...');
    try {
      const { data } = await client.post('/command-center/media-generate', {
        type,
        prompt: prompt.trim(),
        ...(type === 'video' ? { durationSeconds } : {}),
      }, { timeout: 240000 });
      if (requestId !== generationRequest.current) return;
      setHistoryRevision(value => value + 1);
      if ((data.job?.id && data.job?.ticket) || data.historyItem?.status === 'processing') {
        const video = await waitForVideo(data.job, requestId, data.provider === 'shotstack' ? data.historyItem.id : null);
        if (video && requestId === generationRequest.current) setAsset(video);
        return;
      }
      let url = data.mediaUrl;
      if (data.mediaType === 'image' && url?.startsWith('data:')) {
        setGenerationStatus('Saving your image...');
        setUploading(true);
        const uploaded = await uploadMedia(dataUrlToFile(url, `ufi-media-${Date.now()}.png`), null, 'crossposts');
        url = uploaded.url;
        setUploading(false);
      }
      if (requestId === generationRequest.current) setAsset({ url, type: data.mediaType || type });
    } catch (err) {
      if (requestId === generationRequest.current) {
        setError(err?.response?.data?.message || err?.message || 'Could not create media right now.');
      }
    } finally {
      if (requestId === generationRequest.current) {
        setGenerating(false); setUploading(false); setGenerationStatus('');
      }
    }
  }

  function sendToCrossPost(selected = asset) {
    if (!selected?.url) return;
    try { privateSessionStorage.setItem('ufi_crosspost_media', JSON.stringify(selected)); } catch {}
    onOpenCrossPost();
  }

  return (
    <div ref={formTop} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {!readOnly && <>
      <div className="card">
        <h3 style={{ margin: '0 0 4px', fontSize: '.95rem', display: 'flex', alignItems: 'center', gap: 8 }}><Clapperboard size={19} aria-hidden="true" /> Create media</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.8rem', margin: 0, lineHeight: 1.55 }}>
          Create an image or video for your next post. Choose a video length up to 5 minutes when a compatible video service is connected.
        </p>
        <form onSubmit={generate} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {['image', 'video'].map(option => (
              <button
                key={option} type="button" className="btn btn-sm" disabled={generating || uploading}
                onClick={() => { setType(option); setError(''); setGenerationStatus(''); }}
                style={{ border: 'none', textTransform: 'capitalize', background: type === option ? 'var(--primary)' : 'var(--bg-secondary)', color: type === option ? '#fff' : 'var(--text)' }}
              >
                {option === 'image' ? <Image size={18} aria-hidden="true" /> : <Video size={18} aria-hidden="true" />} {option}
              </button>
            ))}
          </div>
          <textarea
            value={prompt} onChange={e => setPrompt(e.target.value)} rows={4}
            placeholder={type === 'image' ? 'Describe the photo or graphic you want to create' : 'Describe the video you want to create'}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.85rem', fontFamily: 'inherit', resize: 'vertical' }}
          />
          {type === 'video' && (
            <>
              <VideoDurationControl value={videoSeconds} onChange={setVideoSeconds} disabled={generating || uploading} />
              <div style={{ color: 'var(--muted)', fontSize: '.8rem', lineHeight: 1.5 }} role="status">
                {videoOptionsError ? <>{videoOptionsError} <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOptionsRevision(value => value + 1)}>Retry video availability</button></>
                  : !videoOptions ? 'Checking video availability…'
                    : !videoAvailable && validDuration ? (videoOptions.shortClipSeconds.length
                      ? 'This length needs a connected long-form video service. You can currently create clips of 4, 8, or 12 seconds.'
                      : 'Video creation is not connected yet.')
                    : null}
              </div>
            </>
          )}
          <button className="btn btn-primary" type="submit" disabled={generating || uploading || !prompt.trim() || (type === 'video' && !videoAvailable)} style={{ alignSelf: 'flex-start' }}>
            {generating || uploading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : `Generate ${type}`}
          </button>
          {generationStatus && <div role="status" style={{ color: 'var(--muted)', fontSize: '.8rem' }}>{generationStatus}</div>}
        </form>
      </div>

      {error && <div style={{ order: -1 }}><SectionError message={error} /></div>}
      {asset && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, order: -1 }}>
          {asset.type === 'video'
            ? <video src={asset.url} controls playsInline style={{ width: '100%', maxHeight: 420, borderRadius: 8, background: '#111' }} />
            : <img src={asset.url} alt="Generated for your post" style={{ width: '100%', maxHeight: 520, objectFit: 'contain', borderRadius: 8, background: 'var(--bg-secondary)' }} />}
          {(asset.type === 'image' || asset.type === 'video') && (
            <button type="button" className="btn btn-primary btn-sm ufi-post-action" onClick={() => sendToCrossPost()} style={{ alignSelf: 'flex-start' }}>
              Use in Cross-Post
            </button>
          )}
        </div>
      )}
      </>}
      <GeneratedContentHistory section="media" revision={historyRevision}
        onUseMedia={readOnly ? undefined : sendToCrossPost}
        onReuse={readOnly || generating ? undefined : item => {
          setType(item.kind); setPrompt(item.prompt); setVideoSeconds(item.input.durationSeconds || 12);
          setAsset(item.output.mediaUrl ? { url: item.output.mediaUrl, type: item.kind } : null);
          setError(''); formTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }} />
    </div>
  );
}

function YourFeedSection() {
  const { showToast } = useToast();
  const [connected, setConnected] = useState(null);
  const [catalog, setCatalog] = useState({});
  const connectionState = useRef({ connected: {}, catalog: {} });
  const [connectedError, setConnectedError] = useState('');
  const [activePlatform, setActivePlatform] = useState(null);
  const [posts, setPosts] = useState(null);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [postsError, setPostsError] = useState('');
  const platformRequest = useRef(0);

  const openPlatform = useCallback(async (platform) => {
    if (!connectionState.current.connected[platform] || !supportsOwnContent(platform, connectionState.current.catalog)) return;
    const requestId = ++platformRequest.current;
    setActivePlatform(platform);
    setPosts(null);
    setPostsError('');
    setLoadingPosts(true);
    try {
      const { data } = await client.get('/command-center/your-content', { params: { platform } });
      if (requestId !== platformRequest.current) return;
      setPosts(data.posts || []);
    } catch (err) {
      if (requestId !== platformRequest.current) return;
      setPostsError(err?.response?.data?.message || `Couldn't load your ${platform} content.`);
    } finally {
      if (requestId === platformRequest.current) setLoadingPosts(false);
    }
  }, []);

  const loadConnections = useCallback(async () => {
    setConnectedError('');
    try {
      const { data } = await client.get('/social/platforms');
      const nextConnected = data.connected || {};
      const nextCatalog = data.platforms || {};
      connectionState.current = { connected: nextConnected, catalog: nextCatalog };
      setConnected(nextConnected);
      setCatalog(nextCatalog);
      const firstSupported = [...new Set([...CONNECTED_SOCIAL_PLATFORMS, ...Object.keys(nextCatalog)])]
        .find(platform => nextConnected[platform] && supportsOwnContent(platform, nextCatalog));
      if (firstSupported) openPlatform(firstSupported);
    } catch (err) {
      connectionState.current = { connected: {}, catalog: {} };
      setConnected({});
      setCatalog({});
      setConnectedError(err?.response?.data?.message || "Couldn't load your connected accounts.");
    }
  }, [openPlatform]);

  useEffect(() => {
    loadConnections();
    return () => { platformRequest.current += 1; };
  }, [loadConnections]);

  async function downloadText(post) {
    const blob = new Blob([JSON.stringify({ title: post.title, content: post.content, sourceUrl: post.sourceUrl, createdAt: post.createdAt }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${post.id || 'post'}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadImage(post) {
    try {
      const { data } = await client.get('/command-center/your-content/download', {
        params: { url: post.mediaUrl, platform: activePlatform }, responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url; a.download = `${post.id || 'image'}.jpg`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      showToast('Could not download that file.', 'error');
    }
  }

  if (connected === null) return <div className="empty-state"><span className="spinner spinner-primary" /></div>;

  const connectedPlatforms = [...new Set([...CONNECTED_SOCIAL_PLATFORMS, ...Object.keys(catalog)])].filter(p => connected[p]);
  const liveFeedButton = (
    <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '.95rem' }}>Live Your Feed</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.8rem', margin: 0, lineHeight: 1.5 }}>
          Open one equalized scroll of posts from your connected accounts.
        </p>
      </div>
      <Link to="/you" className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}>Open Your Feed</Link>
    </div>
  );

  if (!connectedPlatforms.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {liveFeedButton}
        {connectedError && <SectionError message={connectedError} onRetry={loadConnections} />}
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>No connected accounts yet</div>
          <div style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: 16 }}>Connect a platform to review and download your own posts from it here.</div>
          <Link to="/connected-accounts" className="btn btn-primary btn-sm">Connect an account</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {liveFeedButton}
      {connectedError && <SectionError message={connectedError} onRetry={loadConnections} />}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {connectedPlatforms.map(p => {
          const meta = SOURCE_META[p] || { label: catalog[p]?.name || p, icon: p };
          const supported = supportsOwnContent(p, catalog);
          const active = activePlatform === p;
          return (
            <button
              key={p} type="button" disabled={!supported}
              onClick={() => openPlatform(p)}
              className="btn btn-sm"
              style={{
                background: active ? 'var(--primary)' : 'var(--bg-secondary)',
                color: active ? '#fff' : (supported ? 'var(--text)' : 'var(--muted)'),
                border: 'none', opacity: supported ? 1 : 0.6,
              }}
              title={supported ? undefined : catalog[p]?.ownContent?.note || 'This connection does not provide access to your own posts here.'}
            >
              <SourceMark source={p} label={meta.icon} active={active} /> {meta.label}{!supported && ' · Own posts unavailable'}
            </button>
          );
        })}
      </div>

      {!activePlatform && (
        <div className="card" style={{ textAlign: 'center', padding: 28, color: 'var(--muted)', fontSize: '.85rem' }}>
          Pick a platform above to see your own posts there.
        </div>
      )}

      {activePlatform && loadingPosts && <div className="empty-state"><span className="spinner spinner-primary" /></div>}
      {activePlatform && !loadingPosts && postsError && (
        <SectionError message={postsError} onRetry={() => openPlatform(activePlatform)} />
      )}
      {activePlatform && !loadingPosts && !postsError && posts && !posts.length && (
        <div className="card" style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>Nothing found yet.</div>
      )}
      {activePlatform && !loadingPosts && posts && posts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {posts.map(post => (
            <div key={post.id} className="card">
              <div className="command-center-content-row">
              {post.mediaType === 'image' && post.mediaUrl && (
                <img src={post.mediaUrl} alt="" style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><PostInlineText text={post.title} /></div>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 4 }}>{timeAgo(post.createdAt)}</div>
              </div>
              <div className="command-center-row-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText(post)}>Text</button>
                {post.mediaType === 'image' && post.mediaUrl && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadImage(post)}>Image</button>
                )}
                {post.mediaType === 'video_thumbnail_only' && safePostLink(post.sourceUrl) && (
                  <a href={safePostLink(post.sourceUrl)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">View original</a>
                )}
                {!post.mediaType && safePostLink(post.sourceUrl) && (
                  <a href={safePostLink(post.sourceUrl)} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">View</a>
                )}
              </div>
              </div>
              <PostLinkPreviews post={post} text={`${post.title || ''}\n${post.content || ''}`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MemberAccountsSection() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [platforms, setPlatforms] = useState(null);
  const [connected, setConnected] = useState({});
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(null);
  const [disconnecting, setDisconnecting] = useState(null);
  const [accountFilter, setAccountFilter] = useState('all');
  const isBusinessMembership = profile?.plan === 'business';

  const loadAccounts = useCallback(async () => {
    setError('');
    try {
      const { data } = await client.get('/social/platforms');
      const includeCareer = data.careerOnly === true || isBusinessMembership;
      setPlatforms(Object.entries(withCareerAccountFallback(data.platforms, includeCareer)));
      setConnected(data.connected || {});
    } catch (requestError) {
      setError(requestError?.response?.data?.message || 'Could not load Command Center accounts.');
      setPlatforms([]);
    }
  }, [isBusinessMembership]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const connectedPlatform = params.get('social_connected');
    const failedPlatform = params.get('social_error');
    const reason = params.get('reason');
    const target = connectedPlatform || failedPlatform;
    if (!target || !platforms?.some(([key]) => key === target)) return;

    if (connectedPlatform) {
      setConnected(current => ({ ...current, [connectedPlatform]: true }));
      window.dispatchEvent(new Event('ufi-connections-changed'));
      showToast(`${platforms.find(([key]) => key === connectedPlatform)?.[1]?.name || connectedPlatform} connected successfully.`, 'success');
    } else {
      const name = platforms.find(([key]) => key === failedPlatform)?.[1]?.name || failedPlatform;
      const code = String(reason || '').split(':')[0];
      const explanation = {
        invalid_state: 'The connection expired. Start again from this browser.',
        browser_mismatch: 'The browser session could not be verified. Allow cookies for UFIConnect and start again in this browser.',
        access_denied: 'Access was declined. Connect again and review the requested permissions.',
        authorization_declined: 'Access was declined. Connect again and review the requested permissions.',
        missing_code: 'The provider did not return an authorization code. Start the connection again.',
        account_unavailable: 'This account cannot connect this provider. Check your account membership.',
        account_verification_failed: 'Your account could not be verified after authorization. Try connecting again.',
        token_exchange_failed: 'Authorization could not be completed. Start the connection again.',
      }[code] || 'Check that the provider is available, then try connecting again.';
      showToast(`Could not connect ${name}. ${explanation}`, 'error');
    }
    navigate({ pathname: location.pathname, search: '?tab=accounts' }, { replace: true });
  }, [location.pathname, location.search, navigate, showToast, platforms]);

  async function connectAccount(platform) {
    if (platform === 'mastodon' || platform === 'bluesky') {
      navigate(`/connected-accounts?connect=${platform}&returnTo=command-center`);
      return;
    }
    setConnecting(platform);
    try {
      const { data } = await client.get(
        `/auth/social/${platform}/start`,
        publicOAuthRequestConfig({ params: { returnTo: 'command-center' } }),
      );
      if (!data?.url) throw new Error('Missing provider authorization URL.');
      window.location.assign(data.url);
    } catch (requestError) {
      showToast(requestError?.response?.data?.detail || requestError?.response?.data?.error || 'Could not start this connection.', 'error');
      setConnecting(null);
    }
  }

  async function disconnectAccount(platform) {
    setDisconnecting(platform);
    try {
      await client.delete(`/social/connect/${platform}`);
      setConnected(current => ({ ...current, [platform]: false }));
      window.dispatchEvent(new Event('ufi-connections-changed'));
      showToast('Account disconnected.', 'success');
    } catch (requestError) {
      showToast(requestError?.response?.data?.error || 'Could not disconnect this account.', 'error');
    } finally {
      setDisconnecting(null);
    }
  }

  if (platforms === null) return <div className="empty-state"><span className="spinner spinner-primary" /></div>;

  const memberPlatforms = isBusinessMembership
    ? platforms.filter(([key, platform]) => platform.category === 'career' || CAREER_ACCOUNT_PLATFORMS.includes(key))
    : platforms;
  const displayedAccounts = filterAccounts(memberPlatforms, connected, accountFilter);
  const accountGroups = accountSections(memberPlatforms, connected, accountFilter);
  const connectedCount = memberPlatforms.filter(([key]) => connected[key]).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: '18px 20px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '.98rem' }}>{isBusinessMembership ? 'Business career connections' : 'All account connections'}</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.82rem', lineHeight: 1.55, margin: 0 }}>
          {isBusinessMembership
            ? 'Career providers use the same secure Connect, Connected, and Disconnect flow as other accounts. Job browsing remains in Opportunities.'
            : 'Connect accounts for feeds, replies, and publishing. Each provider shows the tools it supports and whether its connection is ready.'}
        </p>
        <p style={{ margin: '10px 0 0', fontSize: '.8rem', fontWeight: 700 }}>{connectedCount} of {memberPlatforms.length} accounts connected</p>
      </div>
      {error && <SectionError message={error} onRetry={loadAccounts} />}
      <div className="account-directory-page">
        <DirectoryControls label="accounts" filter={accountFilter} onFilterChange={setAccountFilter}
          options={[["all", "All statuses"], ...ACCOUNT_STATUSES]} />
      </div>
      {memberPlatforms.length > 0 && !displayedAccounts.length && <div className="source-directory-empty" role="status">No matching accounts</div>}
      {!memberPlatforms.length && !error && (
        <div className="card" style={{ textAlign: 'center', padding: 28, color: 'var(--muted)', fontSize: '.85rem' }}>{isBusinessMembership ? 'No career account connections are available yet.' : 'No account connections are available yet.'}</div>
      )}
      {accountGroups.map(section => (
        <section key={section.id} className="account-category-section" aria-labelledby={`member-accounts-${section.id}`}>
          <div className="account-category-heading">
            <h3 id={`member-accounts-${section.id}`}>{section.label}</h3>
            <span>{section.connectedCount} of {section.total} connected</span>
          </div>
          <div className="account-category-items">
      {section.items.map(([key, platform]) => {
        const isConnected = !!connected[key];
        const unavailable = !platform.configured || platform.forceComingSoon;
        const accountOnly = ['instagram', 'tiktok', 'threads'].includes(key);
        const accountType = platform.category === 'career' ? 'Career account' : accountOnly ? 'Own posts only' : platform.category === 'publication' ? 'Publishing' : null;
        return (
          <div key={key} className="card member-account-card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ width: 42, height: 42, borderRadius: 8, background: '#fff', border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {hasBrandIcon(key) ? <BrandIcon platform={key} size={23} /> : <span style={{ color: platform.color, fontWeight: 800 }}>{platform.name.slice(0, 2)}</span>}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '.92rem' }}>{platform.name}</strong>
                {accountType && <span style={{ fontSize: '.64rem', fontWeight: 750, color: 'var(--primary)', background: 'var(--primary-light)', padding: '2px 6px', borderRadius: 4 }}>{accountType}</span>}
                {isConnected && <span style={{ fontSize: '.64rem', fontWeight: 750, color: '#059669', background: '#ECFDF5', padding: '2px 6px', borderRadius: 4 }}>Connected</span>}
                {isConnected && platform.reconnectRequired && <span style={{ fontSize: '.7rem', color: 'var(--muted)' }}>Reconnect needed</span>}
                {!isConnected && unavailable && <span style={{ fontSize: '.64rem', fontWeight: 750, color: '#92400E', background: '#FEF3C7', padding: '2px 6px', borderRadius: 4 }}>Coming soon</span>}
              </div>
              <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: '4px 0 0', lineHeight: 1.45 }}>{platform.description}</p>
              {isConnected && platform.reconnectRequired && <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: '4px 0 0', lineHeight: 1.45 }}>{platform.reconnectMessage || `Reconnect ${platform.name} to renew account permissions.`}</p>}
            </div>
            <div className="source-directory-account-actions">
            {isConnected && (platform.reconnectRequired || key === 'mastodon' || key === 'bluesky') && <button type="button" className="btn btn-ghost btn-sm" disabled={unavailable || platform.locked || connecting === key} onClick={() => connectAccount(key)}>Reconnect {platform.name}</button>}
            {isConnected ? (
              <button type="button" className="btn btn-danger btn-sm" onClick={() => disconnectAccount(key)} disabled={disconnecting === key}>
                {disconnecting === key ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : 'Disconnect'}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => connectAccount(key)} disabled={unavailable || platform.locked || connecting === key}>
                {connecting === key ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} /> : unavailable ? 'Coming soon' : platform.locked ? 'Membership' : 'Connect'}
              </button>
            )}
            <AccountSiteLink platform={key} name={platform.name} siteUrl={platform.siteUrl} />
            </div>
          </div>
        );
      })}
          </div>
        </section>
      ))}
    </div>
  );
}

const JOB_STATUSES = ['saved', 'applied', 'viewed'];

// Tracking only — the member sets their own status, nothing here submits an
// application automatically. matchScore/matchReasons come straight from
// /opportunities' own existing resume-match scoring, not recomputed here.
function JobTrackerSection() {
  const { showToast } = useToast();
  const { refreshSavedJobs } = useSavedItems();
  const [opportunities, setOpportunities] = useState(null);
  const [tracked, setTracked] = useState({});
  const [resumes, setResumes] = useState([]);
  const [resumesLoading, setResumesLoading] = useState(true);
  const [selectingResumeId, setSelectingResumeId] = useState(null);
  const [viewingResumeId, setViewingResumeId] = useState(null);
  const [resumePreview, setResumePreview] = useState(null);
  const [error, setError] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState('live');
  const [recommendationBasis, setRecommendationBasis] = useState('recent listings');

  // bust=1 mirrors Opportunities.jsx's own manual-refresh param — without
  // it this would just re-read the server-side listings cache and never
  // actually show anything new.
  const loadAll = useCallback((bust = false) => {
    setError(false);
    Promise.all([
      client.get('/opportunities', { params: bust ? { bust: 1 } : {} }),
      client.get('/jobs/tracking'),
      // A missing attachment must not make the live job feed fail. This is
      // intentionally independent from the two core Job Tracker requests.
      client.get('/profile/attachments').catch(() => ({ data: { attachments: [] } })),
    ])
      .then(([oppRes, trackRes, attachmentRes]) => {
        setOpportunities((oppRes.data.opportunities || []).filter(o => o?.id));
        setRecommendationBasis(oppRes.data.recommendationBasis || 'recent listings');
        const map = {};
        for (const j of (trackRes.data.jobs || [])) map[j.id] = j;
        setTracked(map);
        setResumes(attachmentRes.data.attachments || []);
      })
      .catch(() => setError(true))
      .finally(() => {
        setResumesLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    loadAll();
    const id = setInterval(() => loadAll(true), 60000);
    return () => clearInterval(id);
  }, [loadAll]);

  function handleRefresh() {
    setRefreshing(true);
    loadAll(true);
  }

  useEffect(() => () => {
    if (resumePreview?.url) URL.revokeObjectURL(resumePreview.url);
  }, [resumePreview]);

  async function selectResume(id) {
    if (!id || resumes.find(resume => resume.id === id)?.isPrimary) return;
    setSelectingResumeId(id);
    try {
      await client.post(`/profile/attachments/${id}/select`);
      setResumes(current => current.map(resume => ({ ...resume, isPrimary: resume.id === id })));
      showToast('Resume selected for job matching.', 'success');
      // Resume keywords are read by /opportunities on every request. Refresh
      // the list so the member sees the selected resume take effect now.
      setRefreshing(true);
      loadAll(true);
    } catch (requestError) {
      showToast(requestError?.response?.data?.message || 'Could not select that resume.', 'error');
    } finally {
      setSelectingResumeId(null);
    }
  }

  async function viewResume(resume) {
    if (!resume) return;
    setViewingResumeId(resume.id);
    try {
      const { data } = await client.get(`/profile/attachments/${resume.id}/download`, { responseType: 'blob' });
      setResumePreview({
        ...resume,
        mimeType: data.type || resume.mimeType || '',
        url: URL.createObjectURL(data),
      });
    } catch {
      showToast('Could not open this resume.', 'error');
    } finally {
      setViewingResumeId(null);
    }
  }

  async function setStatus(job, status) {
    setSavingId(job.id);
    try {
      await client.post('/jobs/tracking', {
        jobId: job.id, status, title: job.title, org: job.org,
        source: job.source, sourceUrl: job.sourceUrl, matchScore: job.matchScore,
        jobContent: job.content, contactEmail: job.contactEmail,
        recruiterName: job.recruiterName, recruiterRole: job.recruiterRole,
      });
      setTracked(prev => ({ ...prev, [job.id]: { ...prev[job.id], id: job.id, status } }));
      refreshSavedJobs().catch(() => {});
    } catch {
      showToast('Could not update.', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function untrack(jobId) {
    setSavingId(jobId);
    try {
      await client.delete(`/jobs/tracking/${encodeURIComponent(jobId)}`);
      setTracked(prev => { const next = { ...prev }; delete next[jobId]; return next; });
      refreshSavedJobs().catch(() => {});
    } catch {
      showToast('Could not remove.', 'error');
    } finally {
      setSavingId(null);
    }
  }

  if (opportunities === null && !error) return <div className="empty-state"><span className="spinner spinner-primary" /></div>;
  if (error) return <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>Couldn't load listings.</div>;

  const sorted = [...opportunities].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
  const trackedValues = Object.values(tracked);
  const savedCount = trackedValues.filter(t => t.status === 'saved').length;
  const appliedCount = trackedValues.filter(t => t.status === 'applied').length;
  const liveById = new Map(sorted.map(job => [job.id, job]));
  const trackedRows = trackedValues.map(job => ({ ...job, ...(liveById.get(job.id) || {}), isLive: liveById.has(job.id) }));
  const displayedJobs = view === 'live' ? sorted : trackedRows.filter(job => job.status === view);
  const recruiterLeads = trackedRows
    .filter(job => job.status === 'saved' || job.status === 'applied')
    .map(job => {
      const publicContact = String(job.content || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || null;
      const searchTerms = `${job.org || ''} recruiter ${job.title || ''}`.trim();
      return {
        ...job,
        publicContact,
        recruiterSearchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchTerms)}`,
      };
    });
  const selectedResume = resumes.find(resume => resume.isPrimary) || resumes[0] || null;
  const selectedResumeScore = Number(selectedResume?.atsScore);
  const canPreviewResume = resumePreview && (
    resumePreview.mimeType === 'application/pdf' ||
    resumePreview.mimeType.startsWith('text/') ||
    /\.(pdf|txt)$/i.test(resumePreview.filename || '')
  );

  return (
    <div>
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '.82rem', fontWeight: 800 }}>Resume for matching</div>
          <div style={{ fontSize: '.74rem', color: 'var(--muted)', marginTop: 3 }}>
            {resumesLoading ? 'Loading saved resumes...' : selectedResume ? 'The selected file tailors future job matches.' : 'Add a resume to tailor job matches.'}
          </div>
        </div>
        {selectedResume ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
            <select
              className="form-input"
              aria-label="Resume used for job matching"
              value={selectedResume.id}
              disabled={selectingResumeId !== null || resumesLoading}
              onChange={event => selectResume(event.target.value)}
              style={{ minWidth: 210, maxWidth: '100%', padding: '7px 28px 7px 10px', fontSize: '.78rem' }}
            >
              {resumes.map(resume => (
                <option key={resume.id} value={resume.id}>
                  {resume.filename}{resume.isPrimary ? ' (selected)' : ''}
                </option>
              ))}
            </select>
            {Number.isFinite(selectedResumeScore) && (
              <span style={{ fontSize: '.7rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>ATS {selectedResumeScore}/100</span>
            )}
            <button type="button" className="btn btn-ghost btn-sm" disabled={viewingResumeId === selectedResume.id} onClick={() => viewResume(selectedResume)}>
              {viewingResumeId === selectedResume.id ? 'Opening...' : 'View resume'}
            </button>
          </div>
        ) : !resumesLoading && (
          <Link to="/profile?tab=attachments" className="btn btn-primary btn-sm">Add a resume</Link>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20, alignItems: 'center' }}>
        <StatChip label="Listings" value={sorted.length} />
        <StatChip label="Saved" value={savedCount} />
        <StatChip label="Applied" value={appliedCount} />
        <StatChip label="Matched by" value={recommendationBasis} />
        <button
          type="button" onClick={handleRefresh} disabled={refreshing}
          className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }}
        >
          {refreshing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Refresh'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {[
          ['live', 'Live listings'],
          ['saved', 'Saved jobs'],
          ['applied', 'Applied jobs'],
          ['recruiters', 'Recruiters'],
        ].map(([key, label]) => (
          <button
            key={key} type="button" className="btn btn-sm" onClick={() => setView(key)}
            style={{ border: 'none', background: view === key ? 'var(--primary)' : 'var(--bg-secondary)', color: view === key ? '#fff' : 'var(--text)' }}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'recruiters' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {recruiterLeads.map(job => (
            <div key={job.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: '.88rem' }}>{job.org || 'Hiring team'}</div>
                <div style={{ fontSize: '.76rem', color: 'var(--muted)', marginTop: 2 }}>{job.title || 'Tracked role'}</div>
                <div style={{ fontSize: '.72rem', color: 'var(--muted)', marginTop: 5 }}>
                  {job.publicContact ? `Public contact: ${job.publicContact}` : 'Recruiting team search'}
                </div>
              </div>
              <a href={job.recruiterSearchUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Find recruiter</a>
              {job.sourceUrl && <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">View job</a>}
            </div>
          ))}
          {!recruiterLeads.length && (
            <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
              Save or mark a job as applied to build your recruiter list.
            </div>
          )}
        </div>
      ) : <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {displayedJobs.map(job => {
          const t = tracked[job.id];
          const strong = Number.isFinite(job.matchScore) && job.matchScore >= 15;
          return (
            <div key={job.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: '.88rem' }}>{job.title}</div>
                <div style={{ fontSize: '.76rem', color: 'var(--muted)', marginTop: 2 }}>
                  {job.org}{job.location ? ` · ${job.location}` : ''}
                </div>
                {job.matchReasons?.length > 0 && (
                  <div style={{ fontSize: '.7rem', color: '#047857', marginTop: 4, fontWeight: 700 }}>
                    {job.matchReasons.join(' / ')}
                  </div>
                )}
              </div>
              {Number.isFinite(job.matchScore) && (
                <span style={{
                  fontSize: '.68rem', fontWeight: 800, whiteSpace: 'nowrap',
                  color: strong ? '#059669' : 'var(--muted)',
                  background: strong ? '#ECFDF5' : 'var(--bg-secondary)',
                  padding: '3px 9px', borderRadius: 10,
                }}>
                  {strong ? 'Strong match' : `Match ${job.matchScore}`}
                </span>
              )}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {JOB_STATUSES.map(s => (
                  <button
                    key={s} type="button" disabled={savingId === job.id}
                    onClick={() => (t?.status === s ? untrack(job.id) : setStatus(job, s))}
                    className="btn btn-sm"
                    style={{
                      background: t?.status === s ? 'var(--primary)' : 'var(--bg-secondary)',
                      color: t?.status === s ? '#fff' : 'var(--text)',
                      border: 'none', textTransform: 'capitalize',
                    }}
                  >
                    {t?.status === s ? `Selected ${s}` : s}
                  </button>
                ))}
              </div>
              {job.sourceUrl && (
                <a href={job.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">View</a>
              )}
            </div>
          );
        })}
        {!displayedJobs.length && (
          <div className="card" style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
            {view === 'saved' ? 'No saved jobs yet. Save a listing to keep it here.' : view === 'applied' ? 'No applied jobs yet. Mark a saved listing as applied when you apply.' : 'No listings available right now — check back soon.'}
          </div>
        )}
      </div>}

      {resumePreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${resumePreview.filename || 'resume'}`}
          onMouseDown={event => { if (event.target === event.currentTarget) setResumePreview(null); }}
          style={{ position: 'fixed', inset: 0, zIndex: 2000, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(15, 23, 42, .58)' }}
        >
          <div className="card" style={{ width: 'min(900px, 100%)', maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', marginBottom: 12 }}>
              <strong style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resumePreview.filename || 'Resume'}</strong>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setResumePreview(null)}>Close</button>
            </div>
            {canPreviewResume ? (
              <iframe title={resumePreview.filename || 'Resume preview'} src={resumePreview.url} style={{ width: '100%', height: 'min(72vh, 700px)', border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }} />
            ) : (
              <div style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--muted)', fontSize: '.86rem' }}>
                This file type opens in your document app. Download it to view the full resume.
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <a href={resumePreview.url} download={resumePreview.filename || 'resume'} className="btn btn-primary btn-sm">Download</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PLATFORM_RESULT_META = {
  posted: { icon: 'OK', label: 'Posted' },
  handoff: { icon: 'TikTok', label: 'Finish in TikTok' },
  processing: { icon: 'Working', label: 'Processing' },
  unsupported: { icon: 'Unavailable', label: 'Not available' },
  queued: { icon: 'Queued', label: 'Queued (legacy)' },
  failed: { icon: 'Failed', label: 'Failed' },
};

// Server-provided platform capabilities are the source of truth here. That
// keeps the composer from offering a connection that cannot actually publish.
function crossPostReady(key, platforms, connected, plan, media) {
  if (key === 'uficonnect') return true;
  const platform = platforms[key];
  const capability = platform?.crossPost;
  return Boolean(connected?.[key] && platform?.configured && !platform.forceComingSoon && !platform.locked
    && capability?.supported && !platform.reconnectRequired && !capability.reconnectRequired
    && plan === 'pro'
    && (!capability.requiresPhoto || media?.type === 'image')
    && (media?.type !== 'video' || capability.media === 'link'));
}

function CrossPostSection() {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const category = new URLSearchParams(location.search).get('category');
  const categoryLabel = DISCOVERY_CATEGORIES[category]?.label;
  const incomingContext = location.state?.discoveryPost;
  const categoryContext = categoryLabel && incomingContext?.mode === category
    ? discoveryPostContext(category, (Array.isArray(incomingContext.sources) ? incomingContext.sources : []).map(source => ({ source: source.platform, sourceLabel: source.label, sourceUrl: source.url })))
    : null;
  const [connected, setConnected] = useState(null);
  const [platforms, setPlatforms] = useState({});
  const [content, setContent] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [posting, setPosting] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [history, setHistory] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [media, setMedia] = useState(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [destinationCategory, setDestinationCategory] = useState('all');
  const [checkingConnections, setCheckingConnections] = useState(false);
  const catalogRequest = useRef(0);
  const catalogController = useRef(null);

  const loadCrossPostData = useCallback(async () => {
    const requestId = ++catalogRequest.current;
    catalogController.current?.abort();
    const controller = new AbortController();
    catalogController.current = controller;
    setCheckingConnections(true);
    setLoadError('');
    const [socialResult, historyResult] = await Promise.allSettled([
      client.get('/social/platforms', { signal: controller.signal }),
      client.get('/command-center/cross-post/history', { signal: controller.signal }),
    ]);
    if (controller.signal.aborted || requestId !== catalogRequest.current) return;
    if (socialResult.status === 'fulfilled') {
      setConnected(socialResult.value.data.connected || {});
      setPlatforms(socialResult.value.data.platforms || {});
    } else {
      setConnected({});
      setPlatforms({});
    }
    if (historyResult.status === 'fulfilled') setHistory(historyResult.value.data.posts || []);
    else setHistory([]);
    if (socialResult.status === 'rejected' || historyResult.status === 'rejected') {
      setLoadError('Some Cross-Post data could not be loaded.');
    }
    setCheckingConnections(false);
  }, []);

  useEffect(() => {
    loadCrossPostData();
    try {
      const stored = JSON.parse(privateSessionStorage.getItem('ufi_crosspost_media') || 'null');
      if (stored?.url && (stored?.type === 'image' || stored?.type === 'video')) setMedia(stored);
      privateSessionStorage.removeItem('ufi_crosspost_media');
    } catch {}
    window.addEventListener('ufi-connections-changed', loadCrossPostData);
    window.addEventListener('focus', loadCrossPostData);
    return () => {
      catalogRequest.current += 1;
      catalogController.current?.abort();
      window.removeEventListener('ufi-connections-changed', loadCrossPostData);
      window.removeEventListener('focus', loadCrossPostData);
    };
  }, [loadCrossPostData]);

  useEffect(() => {
    setSelected(previous => {
      const next = new Set([...previous].filter(key => crossPostReady(key, platforms, connected, profile?.plan, media)));
      return next.size === previous.size ? previous : next;
    });
  }, [platforms, connected, profile?.plan, media]);

  function toggle(platform) {
    if (platform === 'uficonnect') { setSelected(prev => { const next = new Set(prev); if (next.has(platform)) next.delete(platform); else next.add(platform); return next; }); return; }
    const capability = platforms[platform]?.crossPost;
    if (selected.has(platform)) {
      setSelected(previous => { const next = new Set(previous); next.delete(platform); return next; });
      return;
    }
    if (checkingConnections) return;
    if (media?.type === 'video' && capability?.media !== 'link') {
      showToast(`${SOURCE_META[platform]?.label || platform} needs a native video publishing connection.`, 'error');
      return;
    }
    if (capability?.requiresPhoto && media?.type !== 'image') {
      showToast(`Add a photo before selecting ${SOURCE_META[platform]?.label || platform}.`, 'error');
      return;
    }
    if (!crossPostReady(platform, platforms, connected, profile?.plan, media)) return;
    if ([...selected].filter(key => key !== 'uficonnect').length >= 7) {
      showToast('Choose up to seven connected accounts for each post.', 'error');
      return;
    }
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform); else next.add(platform);
      return next;
    });
  }

  async function handlePhoto(file) {
    if (!file || uploadingMedia) return;
    if (!file.type.startsWith('image/')) { setMediaError('Choose a photo file.'); return; }
    if (file.size > MAX_UPLOAD_BYTES) { setMediaError('That photo is too large.'); return; }
    setUploadingMedia(true); setMediaError('');
    try {
      const uploaded = await uploadMedia(file, null, 'crossposts');
      setMedia(uploaded);
    } catch (err) {
      setMediaError(err?.response?.data?.message || err?.message || 'Could not upload the photo.');
    } finally {
      setUploadingMedia(false);
    }
  }

  function removePhoto() {
    setMedia(null);
    setSelected(prev => new Set([...prev].filter(platform => !platforms[platform]?.crossPost?.requiresPhoto)));
  }

  const syncCrossPostStatuses = useCallback(async () => {
    setSyncing(true);
    try {
      const { data } = await client.post('/command-center/cross-post/sync');
      setHistory(data.posts || []);
      if (data.updated) showToast('Cross-post history updated.', 'success');
    } catch (err) {
      showToast(err?.response?.data?.message || 'Could not refresh cross-post results.', 'error');
    } finally {
      setSyncing(false);
    }
  }, [showToast]);

  async function handlePost(e) {
    e.preventDefault();
    if ((!content.trim() && !media) || !selected.size || posting || uploadingMedia || checkingConnections) return;
    const ready = new Set([...selected].filter(key => crossPostReady(key, platforms, connected, profile?.plan, media)));
    if (ready.size !== selected.size) {
      setSelected(ready);
      showToast('Some accounts are no longer ready to publish. Review the remaining selection before sending.', 'error');
      return;
    }
    setPosting(true);
    setLastResult(null);
    const nativeTargets = [];
    try {
      if (selected.has('uficonnect')) {
        const result = await client.post('/groups/ufi-general/posts', { content: content.trim(), mediaUrl: media?.url, mediaType: media?.type });
        nativeTargets.push({ platform: 'uficonnect', status: 'posted', postedUrl: result.data?.post?.id ? '/p/' + result.data.post.id : '/?feed=ufi' });
        setSelected(prev => new Set([...prev].filter(key => key !== 'uficonnect')));
      }
      const external = [...selected].filter(key => key !== 'uficonnect');
      const { data } = external.length ? await client.post('/command-center/cross-post', {
        content: content.trim(),
        mediaUrl: media?.url,
        mediaType: media?.type,
        platforms: external,
      }) : { data: { targets: [], historySaved: true } };
      setLastResult([...nativeTargets, ...(data.targets || [])]);
      const reconnectTargets = (data.targets || []).filter(target => target.reconnectRequired);
      if (reconnectTargets.length) setPlatforms(previous => {
        const next = { ...previous };
        for (const target of reconnectTargets) next[target.platform] = {
          ...next[target.platform],
          crossPost: { ...next[target.platform]?.crossPost, reconnectRequired: true, reconnectMessage: target.error },
        };
        return next;
      });
      if (data.id) setHistory(prev => [{ id: data.id, content: content.trim(), mediaUrl: data.mediaUrl, targets: data.targets, createdAt: new Date().toISOString() }, ...(prev || [])]);
      if (!data.historySaved) showToast('Your post was sent, but its history will finish syncing shortly.', 'error');
      setContent('');
      setSelected(new Set());
      setMedia(null);
    } catch (err) {
      if (nativeTargets.length) setLastResult(nativeTargets);
      showToast((nativeTargets.length ? 'UFIconnect published; it is deselected to avoid duplicates. ' : '') + (err?.response?.data?.message || 'Could not send your post. Please try again.'), 'error');
    } finally {
      setPosting(false);
    }
  }

  if (connected === null) return <div className="empty-state"><span className="spinner spinner-primary" /></div>;
  const publishingPlatforms = Object.keys(platforms).filter(key => key !== 'uficonnect');
  const shownPlatforms = new Set(categoryContext?.sources.map(source => source.platform) || []);
  const orderedPublishingPlatforms = [...publishingPlatforms].sort((left, right) => Number(shownPlatforms.has(right)) - Number(shownPlatforms.has(left)));
  const destinationGroups = accountSections([
    ['uficonnect', { name: 'UFIConnect', configured: true }],
    ...orderedPublishingPlatforms.map(platform => [platform, platforms[platform]]),
  ], { ...connected, uficonnect: true }).map(group => ({
    ...group,
    items: group.items.sort(([left], [right]) => Number(shownPlatforms.has(right)) - Number(shownPlatforms.has(left))),
  }));
  const visibleDestinationGroups = destinationGroups.filter(group => destinationCategory === 'all' || group.id === destinationCategory);
  const connectionPath = (platform) => platform === 'mastodon' || platform === 'bluesky'
    ? `/connected-accounts?connect=${platform}&returnTo=command-center`
    : '/command-center?tab=accounts';
  const platformTargetButton = (p) => {
    const meta = SOURCE_META[p] || { label: platforms[p]?.name || p, icon: p };
    const capability = platforms[p]?.crossPost;
    if (!capability?.supported) return null;
    const active = selected.has(p);
    const needsPhoto = capability.requiresPhoto && media?.type !== 'image';
    const incompatibleVideo = media?.type === 'video' && capability.media !== 'link';
    const deliveryHint = capability.delivery === 'handoff' ? ' · TikTok inbox' : capability.requiresPhoto ? ' · photo' : '';
    return (
      <button
        type="button" onClick={() => toggle(p)} disabled={checkingConnections || !crossPostReady(p, platforms, connected, profile?.plan, media)} aria-pressed={active}
        className="btn btn-sm"
        title={needsPhoto ? 'Add a photo to publish to this account.' : incompatibleVideo ? 'This account does not support this video attachment.' : capability.note}
        style={{ background: active ? 'var(--primary)' : 'var(--bg-secondary)', color: active ? '#fff' : 'var(--text)', border: 'none', opacity: needsPhoto ? .55 : 1 }}
      >
        <SourceMark source={p} label={meta.icon} active={active} /> {meta.label}{deliveryHint}
      </button>
    );
  };
  const publishingDestination = (p) => {
    const meta = SOURCE_META[p] || { label: platforms[p]?.name || p, icon: p };
    const platform = platforms[p];
    const capability = platform?.crossPost;
    const available = platform?.configured && !platform.forceComingSoon;
    const reconnect = connected[p] && (platform?.reconnectRequired || capability?.reconnectRequired);
    const status = !available ? 'Coming soon' : reconnect ? 'Reconnect required' : connected[p] ? 'Connected' : 'Not connected';
    const detail = !available ? platform?.note || 'Account connection setup is pending.'
      : reconnect ? capability?.reconnectMessage || platform?.reconnectMessage || 'Reconnect to restore publishing permission.'
      : !capability?.supported ? capability?.note || 'This connection does not provide a publishing route.'
      : platform.locked ? 'Membership required.'
      : profile?.plan !== 'pro' ? 'Publishing to connected accounts requires Pro.'
      : capability?.note;
    return (
      <div key={p} aria-label={`${meta.label} destination`} style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--border)', borderRadius: 8, padding: 10, minWidth: 0 }}>
        <strong style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.8rem' }}><SourceMark source={p} label={meta.icon} /> {meta.label}</strong>
        <span style={{ fontSize: '.73rem', color: 'var(--muted)' }}>{status}{available && !capability?.supported ? ' · Publishing unavailable' : ''}</span>
        {detail && <p style={{ fontSize: '.73rem', color: 'var(--muted)', lineHeight: 1.5, margin: 0, overflowWrap: 'anywhere' }}>{detail}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 'auto' }}>
          {available && capability?.supported && connected[p] && !reconnect && platformTargetButton(p)}
          {available && <Link to={connectionPath(p)} className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
            {reconnect ? `Reconnect ${meta.label}` : connected[p] ? `Manage ${meta.label}` : `Connect ${meta.label}`}
          </Link>}
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {loadError && <SectionError message={loadError} onRetry={loadCrossPostData} />}
      <div className="card">
        <h3 style={{ margin: '0 0 4px', fontSize: '.95rem' }}>{categoryLabel ? `Post to ${categoryLabel}` : 'Post to multiple platforms'}</h3>
        <p style={{ color: 'var(--muted)', fontSize: '.8rem', margin: 0 }}>
          Send one post through the official publishing route for each selected account. TikTok uses its inbox handoff, then this history confirms when it is complete.
        </p>
        {categoryLabel && <div className="discovery-post-context" aria-label={`${categoryLabel} posting destinations`}>
          <strong>Sites in your {categoryLabel.toLowerCase()} feed</strong>
          <p>Choose a connected publishing account below. Sites without a publishing connection open on their own website.</p>
          <div className="discovery-post-context-links">
            {categoryContext?.sources.map(source => <a key={`${source.platform}:${source.url}`} href={source.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Open {source.label}</a>)}
            <Link to={`/?feed=${category}`} className="btn btn-ghost btn-sm">Back to {categoryLabel}</Link>
          </div>
        </div>}
        <div style={{ marginTop: 16, padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <strong style={{ fontSize: '.8rem' }}>Publishing destinations</strong>
            <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: '.75rem', minWidth: 0 }}>
              Category
              <select className="form-select" aria-label="Publishing category" value={destinationCategory} onChange={event => setDestinationCategory(event.target.value)} style={{ width: 'auto', maxWidth: '100%' }}>
                <option value="all">All categories</option>
                {destinationGroups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}
              </select>
            </label>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {visibleDestinationGroups.map(group => <section key={group.id} aria-labelledby={`crosspost-category-${group.id}`}>
              <h4 id={`crosspost-category-${group.id}`} style={{ margin: '0 0 8px', fontSize: '.78rem', color: 'var(--muted)' }}>{group.label}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 8 }}>
                {group.items.map(([platform]) => platform === 'uficonnect'
                  ? <button key={platform} type="button" className="btn btn-sm" aria-pressed={selected.has(platform)} onClick={() => toggle(platform)} style={{ background: selected.has(platform) ? 'var(--primary)' : 'var(--card)', color: selected.has(platform) ? '#fff' : 'var(--text)' }}><SourceMark source={platform} active={selected.has(platform)} /> UFIConnect</button>
                  : publishingDestination(platform))}
              </div>
            </section>)}
          </div>
          <p role="status" style={{ fontSize: '.78rem', margin: '14px 0 0', lineHeight: 1.5 }}>{selected.size
            ? `Selected (${selected.size}): ${[...selected].map(platform => SOURCE_META[platform]?.label || platform).join(', ')}`
            : 'Choose the accounts to publish to.'}</p>
        </div>
        {profile?.plan === 'free' && <p style={{ fontSize: '.8rem' }}>UFIconnect posting is available to everyone. Publishing to connected accounts requires Pro.</p>}
        {
          <form onSubmit={handlePost} style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
            <textarea
              value={content} onChange={e => setContent(e.target.value)} rows={4}
              placeholder={categoryLabel ? `What would you like to share about ${categoryLabel.toLowerCase()}?` : 'What do you want to share?'}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.85rem', fontFamily: 'inherit', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <PhotoPickerButton
                onFileSelected={handlePhoto}
                disabled={uploadingMedia}
                label={uploadingMedia ? 'Uploading photo...' : 'Add photo'}
                className="btn btn-ghost btn-sm"
              />
              {media && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {media.type === 'video'
                    ? <video src={media.url} muted playsInline style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 6, background: '#111' }} />
                    : <img src={media.url} alt="Selected for cross-posting" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 6 }} />}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={removePhoto}>Remove photo</button>
                </div>
              )}
              {mediaError && <span style={{ color: 'var(--danger)', fontSize: '.76rem' }}>{mediaError}</span>}
            </div>
            <button className="btn btn-primary ufi-post-action" type="submit" disabled={posting || uploadingMedia || checkingConnections || (!content.trim() && !media) || !selected.size} style={{ alignSelf: 'flex-start' }}>
              {posting ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Send'}
            </button>
          </form>
        }
      </div>

      {lastResult && (
        <div className="card">
          <h3 style={{ margin: '0 0 10px', fontSize: '.85rem' }}>Result</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lastResult.map(t => {
              const meta = SOURCE_META[t.platform] || SOURCE_META.uficonnect;
              const resultMeta = PLATFORM_RESULT_META[t.status] || PLATFORM_RESULT_META.failed;
              return (
                <div key={t.platform} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: '.85rem', overflowWrap: 'anywhere' }}>
                  <span>{resultMeta.icon}</span>
                  <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}><SourceMark source={t.platform} label={meta.icon} /> {meta.label}</span>
                  <span style={{ color: 'var(--muted)' }}>
                    {t.status === 'posted' && t.postedUrl ? <a href={t.postedUrl} target="_blank" rel="noopener noreferrer">View post</a> : (t.error || resultMeta.label)}
                  </span>
                  {t.reconnectRequired && <Link to={connectionPath(t.platform)}>Reconnect {meta.label}</Link>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {history && history.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <h3 style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', margin: 0 }}>History</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={syncCrossPostStatuses} disabled={syncing}>
              {syncing ? 'Checking...' : 'Refresh results'}
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.map(h => (
              <div key={h.id} className="card">
                {h.mediaUrl && (h.mediaUrl.includes('/video/upload/')
                  ? <video src={h.mediaUrl} controls playsInline style={{ width: '100%', maxHeight: 280, borderRadius: 6, marginBottom: 10, background: '#111' }} />
                  : <img src={h.mediaUrl} alt="Cross-posted" style={{ width: '100%', maxHeight: 280, objectFit: 'contain', borderRadius: 6, marginBottom: 10, background: 'var(--bg-secondary)' }} />)}
                <p style={{ margin: '0 0 8px', fontSize: '.85rem', whiteSpace: 'pre-wrap' }}><PostInlineText text={h.content} /></p>
                <PostLinkPreviews text={h.content} />
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '.72rem', color: 'var(--muted)' }}>
                  {(h.targets || []).map(t => {
                    const resultMeta = PLATFORM_RESULT_META[t.status] || PLATFORM_RESULT_META.failed;
                    return (
                      <span key={t.platform} title={t.error || resultMeta.label}>
                        {resultMeta.icon} {(SOURCE_META[t.platform] || {}).label || t.platform}
                        {t.status === 'posted' && t.postedUrl && <> <a href={t.postedUrl} target="_blank" rel="noopener noreferrer">View</a></>}
                      </span>
                    );
                  })}
                  <span>· {timeAgo(h.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function metricValue(value) {
  return Number.isFinite(value) ? value.toLocaleString() : '-';
}

function AutomationToolCard({ icon, title, description, status, actionLabel, to, href, onClick, primary = false }) {
  const action = href ? (
    <a href={href} className={`btn ${primary ? 'btn-primary' : 'btn-ghost'} btn-sm`} style={{ alignSelf: 'flex-start' }}>
      {actionLabel}
    </a>
  ) : to ? (
    <Link to={to} className={`btn ${primary ? 'btn-primary' : 'btn-ghost'} btn-sm`} style={{ alignSelf: 'flex-start' }}>
      {actionLabel}
    </Link>
  ) : (
    <button
      type="button"
      className={`btn ${primary ? 'btn-primary' : 'btn-ghost'} btn-sm`}
      onClick={onClick}
      style={{ alignSelf: 'flex-start' }}
    >
      {actionLabel}
    </button>
  );

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 164 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: '.95rem', lineHeight: 1.25, display: 'flex', alignItems: 'center', gap: 8 }}>{icon}{title}</h3>
          <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: '.8rem', lineHeight: 1.5 }}>
            {description}
          </p>
        </div>
        <span style={{
          flexShrink: 0, fontSize: '.68rem', fontWeight: 800, color: primary ? '#059669' : 'var(--muted)',
          background: primary ? '#ECFDF5' : 'var(--bg-secondary)', borderRadius: 10, padding: '4px 8px',
          whiteSpace: 'nowrap',
        }}>
          {status}
        </span>
      </div>
      <div style={{ marginTop: 'auto' }}>{action}</div>
    </div>
  );
}

function AutomationSection({ onSelectSection }) {
  const { profile } = useAuth();
  const [snapshot, setSnapshot] = useState({ loading: true });
  const [refreshKey, setRefreshKey] = useState(0);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadSnapshot() {
      setChecking(true);
      const [socialRes, feedRes, historyRes, jobsRes] = await Promise.allSettled([
        client.get('/social/platforms'),
        client.get('/command-center/your-content/feed', { params: { limit: 1 } }),
        client.get('/command-center/cross-post/history'),
        client.get('/jobs/tracking'),
      ]);
      if (cancelled) return;

      const social = socialRes.status === 'fulfilled' ? socialRes.value.data : {};
      const feedData = feedRes.status === 'fulfilled' ? feedRes.value.data : {};
      const feedPosts = feedData.posts || [];
      const history = historyRes.status === 'fulfilled' ? (historyRes.value.data.posts || []) : [];
      const jobs = jobsRes.status === 'fulfilled' ? (jobsRes.value.data.jobs || []) : [];
      const connected = social.connected || {};
      const allFailed = [socialRes, feedRes, historyRes, jobsRes].every(result => result.status === 'rejected');

      setSnapshot({
        loading: false,
        error: allFailed ? 'Command Center status could not be loaded.' : '',
        connectedPlatforms: Object.keys(social.platforms || {}).filter(platform => connected[platform]).length,
        feedPosts: Number.isFinite(feedData.totalAvailable) ? feedData.totalAvailable : feedPosts.length,
        newestFeedAt: feedPosts[0]?.createdAt || null,
        crossPostRuns: history.length,
        lastCrossPostAt: history[0]?.createdAt || null,
        trackedJobs: jobs.length,
        savedJobs: jobs.filter(j => j.status === 'saved').length,
        appliedJobs: jobs.filter(j => j.status === 'applied').length,
        refreshedAt: new Date().toISOString(),
      });
      setChecking(false);
    }

    loadSnapshot();
    const id = setInterval(loadSnapshot, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [refreshKey]);

  const feedStatus = snapshot.newestFeedAt ? `Latest ${timeAgo(snapshot.newestFeedAt)}` : 'Live route ready';
  const crossPostStatus = snapshot.lastCrossPostAt ? `Last ${timeAgo(snapshot.lastCrossPostAt)}` : `${metricValue(snapshot.crossPostRuns)} saved`;
  const jobsStatus = `${metricValue(snapshot.trackedJobs)} tracked`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {snapshot.error && <SectionError message={snapshot.error} onRetry={() => setRefreshKey(key => key + 1)} />}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <StatChip label="Accounts" value={snapshot.loading ? '...' : metricValue(snapshot.connectedPlatforms)} />
        <StatChip label="Tracked Jobs" value={snapshot.loading ? '...' : metricValue(snapshot.trackedJobs)} />
        <StatChip label="Cross-Posts" value={snapshot.loading ? '...' : metricValue(snapshot.crossPostRuns)} />
        <StatChip label="Your Posts" value={snapshot.loading ? '...' : metricValue(snapshot.feedPosts)} />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setRefreshKey(k => k + 1)}
          style={{ marginLeft: 'auto' }}
        >
          {checking ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Refresh'}
        </button>
      </div>

      <div className="command-center-tools-grid">
        <AutomationToolCard
          title="AI Drafts"
          icon={<Sparkles size={19} aria-hidden="true" />}
          description="Generate captions and post drafts for the platform you plan to publish on."
          status="Ready"
          actionLabel="Open AI Hub"
          onClick={() => onSelectSection('content')}
        />
        <AutomationToolCard
          title="Media Studio"
          icon={<Clapperboard size={19} aria-hidden="true" />}
          description="Generate a photo or send a video prompt to the configured media provider."
          status="Ready"
          actionLabel="Open Media Studio"
          onClick={() => onSelectSection('media')}
        />
        <AutomationToolCard
          title="Cross-Post Queue"
          description="Publish to supported connected accounts and review delivery results."
          status={crossPostStatus}
          actionLabel="Open Cross-Post"
          onClick={() => onSelectSection('crosspost')}
        />
        <AutomationToolCard
          title="Job Tracker"
          description="Track saved, viewed, and applied opportunities from the live listings system."
          status={jobsStatus}
          actionLabel="Open Job Tracker"
          onClick={() => onSelectSection('jobs')}
        />
        <AutomationToolCard
          title="Connected Accounts"
          description="Manage all your account connections by category, permissions, and availability."
          status={`${metricValue(snapshot.connectedPlatforms)} connected`}
          actionLabel="Open Accounts"
          onClick={() => onSelectSection('accounts')}
        />
        <AutomationToolCard
          title="Resume Builder"
          description="Maintain your resume draft and feed it into the ATS/job matching workflow."
          status={profile?.resumeBuilderAddon ? 'Active' : 'Paid add-on'}
          actionLabel="Open Resume Builder"
          to="/resume-builder"
        />
        <AutomationToolCard
          title="Your Feed"
          description="Open the live equalizer feed of posts from your connected accounts."
          status={feedStatus}
          actionLabel="Open Your Feed"
          to="/you"
          primary
        />
        <AutomationToolCard
          title="Your Content"
          description="Review and download your own connected-platform posts where the API supports it."
          status={`${metricValue(snapshot.connectedPlatforms)} connected`}
          actionLabel="Open Your Feed"
          onClick={() => onSelectSection('yourfeed')}
        />
      </div>
    </div>
  );
}

export default function CommandCenter() {
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const section = commandCenterSection(location.search);
  const [pricingOpen, setPricingOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(null);
  const [membershipChecking, setMembershipChecking] = useState(true);
  const [membershipError, setMembershipError] = useState('');
  const [membershipRefresh, setMembershipRefresh] = useState(0);

  useEffect(() => {
    if (!profile?.id) return undefined;
    const controller = new AbortController();
    let stopped = false;
    let pending = false;
    let lastChecked = 0;
    async function checkMembership() {
      if (pending) return;
      pending = true;
      lastChecked = Date.now();
      setMembershipChecking(true);
      setMembershipError('');
      try {
        // Reconcile delayed/older checkouts before reading the authoritative
        // profile. The sign-in snapshot can still say Free after payment.
        await client.get('/billing/status', { signal: controller.signal });
        if (!stopped) await refreshProfile();
      } catch {
        if (!stopped) {
          // A webhook may already have updated the profile even if Stripe is
          // temporarily unavailable. Never invent an entitlement in the UI.
          try { await refreshProfile(); } catch { /* Keep the current profile. */ }
          if (!stopped) setMembershipError('Could not confirm your latest billing status. Retry or open Manage billing in Settings before starting another checkout.');
        }
      } finally {
        pending = false;
        if (!stopped) setMembershipChecking(false);
      }
    }
    function refreshOnReturn() {
      if (document.visibilityState === 'visible' && Date.now() - lastChecked >= 60000) checkMembership();
    }
    checkMembership();
    window.addEventListener('focus', refreshOnReturn);
    document.addEventListener('visibilitychange', refreshOnReturn);
    return () => {
      stopped = true;
      controller.abort();
      window.removeEventListener('focus', refreshOnReturn);
      document.removeEventListener('visibilitychange', refreshOnReturn);
    };
  }, [profile?.id, refreshProfile, membershipRefresh]);

  const selectSection = useCallback((nextSection, { replace = false } = {}) => {
    if (!SECTION_KEYS.has(nextSection)) return;
    const params = new URLSearchParams(location.search);
    params.set('tab', nextSection);
    navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace });
  }, [location.pathname, location.search, navigate]);

  function handleTabKeyDown(event, index) {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % SECTIONS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + SECTIONS.length) % SECTIONS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = SECTIONS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextSection = SECTIONS[nextIndex];
    selectSection(nextSection.key);
    window.requestAnimationFrame(() => document.getElementById(`command-center-tab-${nextSection.key}`)?.focus());
  }

  async function handleUpgrade(tier, quantity = 1) {
    setUpgrading(tier);
    try {
      const { data } = await client.post('/billing/create-checkout-session', { tier, quantity });
      window.location.href = data.url;
    } catch (err) {
      showToast(err?.response?.data?.message || 'Could not start checkout. Please try again.', 'error');
      setUpgrading(null);
    }
  }

  if (!profile) {
    return <Layout><div className="empty-state"><span className="spinner spinner-primary" /></div></Layout>;
  }

  // Connections themselves are available to every signed-in member. The
  // remaining Command Center tools keep their paid-plan gate below.
  const hasPaidMembership = ['pro', 'business'].includes(profile.plan);
  const locked = !hasPaidMembership && !['accounts', 'content', 'media', 'crosspost'].includes(section);

  return (
    <Layout>
      <div style={{ marginBottom: 14 }}>
        <Link to="/" className="btn-back"><span className="btn-back-icon">‹</span> Back to Home</Link>
      </div>
      <div className="command-center-header">
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          Command Center
        </h1>
        <p style={{ color: 'var(--muted)', fontSize: '.85rem', margin: '4px 0 0' }}>
          Your connected accounts, media tools, cross-posting, and job search in one place.
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '12px 0 18px' }}>
        <span role="status" style={{ color: 'var(--muted)', fontSize: '.82rem' }}>
          {membershipChecking ? 'Refreshing membership...' : membershipError || (hasPaidMembership ? `${profile.plan === 'business' ? 'Business' : 'Pro'} membership active` : 'Free membership')}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" disabled={membershipChecking} onClick={() => setMembershipRefresh(value => value + 1)}>Refresh membership</button>
        <Link className="btn btn-ghost btn-sm" to="/settings">Manage billing</Link>
      </div>

      {!hasPaidMembership && membershipChecking ? (
        <div className="card" role="status" style={{ padding: 24 }}>Checking your Command Center access...</div>
      ) : locked ? (
        <>
          <LockedState onUpgrade={() => setPricingOpen(true)} />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
            <Link className="btn btn-ghost btn-sm" to="/command-center?tab=content">Previous AI content</Link>
            <Link className="btn btn-ghost btn-sm" to="/command-center?tab=media">Previous Studio media</Link>
          </div>
        </>
      ) : (
        <>
          <div className="command-center-tabs" role="tablist" aria-label="Command Center tools">
            {SECTIONS.map((s, index) => (
              <button
                key={s.key}
                id={`command-center-tab-${s.key}`}
                type="button"
                role="tab"
                aria-selected={section === s.key}
                aria-controls="command-center-panel"
                tabIndex={section === s.key ? 0 : -1}
                onClick={() => selectSection(s.key)}
                onKeyDown={event => handleTabKeyDown(event, index)}
                className={`command-center-tab${section === s.key ? ' active' : ''}`}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><s.icon size={17} aria-hidden="true" />{s.label}</span>
              </button>
            ))}
          </div>

          <div
            id="command-center-panel"
            role="tabpanel"
            aria-labelledby={`command-center-tab-${section}`}
            className="command-center-panel"
          >
            {!hasPaidMembership && ['content', 'media'].includes(section) && <button type="button" className="btn btn-primary btn-sm" onClick={() => setPricingOpen(true)}>Upgrade to create new content</button>}
            {section === 'content' && <ContentHubSection key={profile.id} readOnly={!hasPaidMembership} />}
            {section === 'media' && <MediaStudioSection key={profile.id} readOnly={!hasPaidMembership} onOpenCrossPost={() => selectSection('crosspost')} />}
            {section === 'yourfeed' && <YourFeedSection />}
            {section === 'accounts' && <MemberAccountsSection />}
            {section === 'automation' && <AutomationSection onSelectSection={selectSection} />}
            {section === 'jobs' && <JobTrackerSection />}
            {section === 'crosspost' && <CrossPostSection />}
          </div>
        </>
      )}

      {pricingOpen && (
        <PricingModal
          loadingTier={upgrading}
          onClose={() => setPricingOpen(false)}
          onSelectTier={handleUpgrade}
        />
      )}
    </Layout>
  );
}
