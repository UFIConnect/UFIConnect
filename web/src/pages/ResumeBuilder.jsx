import { useState, useEffect, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import client from '../api/client';
import {
  PREPARATION_ASSET_VERSION,
  PREPARATION_TOPICS,
  PREPARATION_VIDEOS,
  normalizePreparationWatchedIds,
} from '../data/preparationVideos';

const TEMPLATES = [
  { key: 'modern',    label: 'Modern',    desc: 'Color header with clear section breaks.', accent: '#2563EB' },
  { key: 'minimal',   label: 'Minimal',   desc: 'Quiet black-and-white, built for focus.', accent: '#111827' },
  { key: 'classic',   label: 'Classic',   desc: 'Traditional type with a refined top rule.', accent: '#9A3412' },
  { key: 'executive', label: 'Executive', desc: 'A decisive dark header for senior roles.', accent: '#0F766E' },
  { key: 'studio',    label: 'Studio',    desc: 'A lively accent rail with spacious detail.', accent: '#B45309' },
  { key: 'compact',   label: 'Compact',   desc: 'A focused one-page layout with a slim accent rail.', accent: '#BE123C' },
  { key: 'professional', label: 'Professional', desc: 'A polished navy layout for broad business roles.', accent: '#102A6B' },
  { key: 'technical', label: 'Technical', desc: 'Structured hierarchy for engineering and data work.', accent: '#334155' },
  { key: 'academic', label: 'Academic', desc: 'A restrained serif layout for research and education.', accent: '#6B1F35' },
  { key: 'impact', label: 'Impact', desc: 'Strong section markers for results-led career stories.', accent: '#166534' },
];

function emptyDraft() {
  return {
    contact: { name: '', title: '', email: '', phone: '', location: '', links: [] },
    summary: '',
    experience: [],
    education: [],
    skills: [],
    preparation: { watchedVideoIds: [] },
    coverLetter: { role: '', company: '', jobDescription: '', tone: 'Warm and professional', format: 'modern', body: '' },
    outreach: { recipientName: '', recipientRole: '', company: '', context: '', tone: 'Warm and professional', format: 'modern', body: '' },
  };
}

function normalizeDraft(draft) {
  const base = emptyDraft();
  const next = draft && typeof draft === 'object' ? draft : {};
  return {
    ...base,
    ...next,
    contact: { ...base.contact, ...(next.contact || {}) },
    experience: Array.isArray(next.experience) ? next.experience : base.experience,
    education: Array.isArray(next.education) ? next.education : base.education,
    skills: Array.isArray(next.skills) ? next.skills : base.skills,
    preparation: {
      ...base.preparation,
      ...(next.preparation || {}),
      watchedVideoIds: normalizePreparationWatchedIds(next.preparation?.watchedVideoIds),
    },
    coverLetter: { ...base.coverLetter, ...(next.coverLetter || {}) },
    outreach: { ...base.outreach, ...(next.outreach || {}) },
  };
}

function priceCadence(price) {
  if (!price?.interval) return '';
  const count = Math.max(1, Number(price.intervalCount) || 1);
  return count === 1 ? ` / ${price.interval}` : ` every ${count} ${price.interval}s`;
}

function listingPlainText(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (typeof DOMParser === 'undefined') return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const parsed = new DOMParser().parseFromString(raw, 'text/html');
  return String(parsed.body?.textContent || '').replace(/\s+/g, ' ').trim();
}

function listingSummary(job, maxLength = 360) {
  const text = listingPlainText(job?.content || job?.jobContent);
  if (!text) {
    return `This source did not include a position summary. Open the ${job?.source || 'original'} listing for responsibilities, qualifications, and application details.`;
  }
  if (text.length <= maxLength) return text;
  const shortened = text.slice(0, maxLength + 1);
  const lastSpace = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, lastSpace > maxLength * 0.7 ? lastSpace : maxLength).trim()}...`;
}

function listingDateLabel(job) {
  const value = job?.posted || job?.updatedAt || job?.trackedAt;
  const timestamp = new Date(value || '').getTime();
  if (!Number.isFinite(timestamp)) return '';
  const label = job?.posted ? 'Posted' : 'Tracked';
  return `${label} ${new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function toJobContact(listing) {
  const content = String(listing.content || listing.jobContent || '');
  const publicContact = listing.contactEmail || content.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0] || '';
  const job = {
    ...listing,
    content,
    publicContact,
    recipientName: listing.recruiterName || '',
    recipientRole: listing.recruiterRole || (publicContact ? 'Recruiter' : 'Recruiting team'),
  };
  const displayDate = listingDateLabel(job);
  const displayFacts = [
    job.location,
    job.pay,
    job.remote ? 'Remote' : '',
    displayDate,
    job.source,
    ...(job.matchReasons || []).slice(0, 2),
  ].filter((fact, index, facts) => fact && facts.findIndex(value => String(value).toLowerCase() === String(fact).toLowerCase()) === index);
  return {
    ...job,
    displaySummary: listingSummary(job),
    displayFacts,
  };
}

function LockedState({ onUnlock, unlocking, billingReady, price }) {
  const priceLabel = price?.active && price?.matchesRequiredPrice && price?.display ? price.display + priceCadence(price) : null;
  return (
    <div className="card" style={{ textAlign: 'center', padding: '52px 24px' }}>
      <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 8px' }}>Resume Builder</h2>
      <p style={{ color: 'var(--muted)', fontSize: '.88rem', maxWidth: 440, margin: '0 auto 22px', lineHeight: 1.6 }}>
        Prepare for interviews, build an ATS-friendly resume with original templates, use AI-assisted writing,
        and export a scored PDF that is saved to your profile.
      </p>
      <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, marginBottom: 18, fontSize: '.86rem' }}>
        <span style={{ color: 'var(--muted)' }}>Resume Builder add-on</span>
        <strong>{priceLabel || 'Price shown at checkout'}</strong>
      </div>
      <button className="btn btn-primary" type="button" onClick={onUnlock} disabled={unlocking || billingReady === false}>
        {unlocking ? <span className="spinner" style={{ width: 14, height: 14 }} /> : billingReady === false ? 'Billing unavailable' : priceLabel ? `Unlock for ${priceLabel}` : 'Unlock Resume Builder'}
      </button>
    </div>
  );
}

function AIAssistButton({ onResult, field, context, label = 'AI Assist' }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!context?.trim() || loading) return;
    setLoading(true);
    try {
      const { data } = await client.post('/resume-builder/ai-assist', { field, context });
      onResult(data.suggestion || '');
    } catch (err) {
      showToast(err?.response?.data?.message || 'Could not generate a suggestion.', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={run} disabled={loading || !context?.trim()}>
      {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : label}
    </button>
  );
}

function Field({ label, ...props }) {
  return (
    <div style={{ flex: 1, minWidth: 140 }}>
      <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{label}</label>
      <input className="form-input" style={{ fontSize: '.85rem', padding: '8px 10px' }} {...props} />
    </div>
  );
}

function ResumePreview({ data, template }) {
  const contact = data.contact || {};
  const contactBits = [contact.email, contact.phone, contact.location].filter(Boolean);
  const title = contact.name || 'Your Name';
  const role = contact.title || 'Professional title';
  const templateMeta = TEMPLATES.find(item => item.key === template) || TEMPLATES[0];
  const datesFor = (entry) => [entry.startDate, entry.current ? 'Present' : entry.endDate].filter(Boolean).join(' - ');

  return (
    <article className={`resume-preview-paper resume-preview--${template}`} style={{ '--resume-accent': templateMeta.accent }}>
      <header className="resume-preview-header">
        <div>
          <h1>{title}</h1>
          <p className="resume-preview-title">{role}</p>
        </div>
        {contactBits.length > 0 && <p className="resume-preview-contact">{contactBits.join(' | ')}</p>}
      </header>

      {data.summary && (
        <section className="resume-preview-section">
          <h2>Summary</h2>
          <p>{data.summary}</p>
        </section>
      )}

      {data.experience.length > 0 && (
        <section className="resume-preview-section">
          <h2>Experience</h2>
          {data.experience.map((job, index) => (
            <div className="resume-preview-entry" key={`${job.company}-${job.role}-${index}`}>
              <div className="resume-preview-entry-head">
                <strong>{[job.role, job.company].filter(Boolean).join(' at ') || 'Role and company'}</strong>
                <span>{datesFor(job)}</span>
              </div>
              {job.location && <small>{job.location}</small>}
              {job.bullets.filter(Boolean).length > 0 && (
                <ul>{job.bullets.filter(Boolean).map((bullet, bulletIndex) => <li key={bulletIndex}>{bullet}</li>)}</ul>
              )}
            </div>
          ))}
        </section>
      )}

      {data.education.length > 0 && (
        <section className="resume-preview-section">
          <h2>Education</h2>
          {data.education.map((education, index) => (
            <div className="resume-preview-entry" key={`${education.school}-${education.degree}-${index}`}>
              <div className="resume-preview-entry-head">
                <strong>{[education.degree, education.field].filter(Boolean).join(', ') || 'Degree'}</strong>
                <span>{[education.startDate, education.endDate].filter(Boolean).join(' - ')}</span>
              </div>
              {education.school && <small>{education.school}</small>}
            </div>
          ))}
        </section>
      )}

      {data.skills.length > 0 && (
        <section className="resume-preview-section">
          <h2>Skills</h2>
          <p className="resume-preview-skills">{data.skills.join('  |  ')}</p>
        </section>
      )}

      {!data.summary && data.experience.length === 0 && data.education.length === 0 && data.skills.length === 0 && (
        <p className="resume-preview-empty">Add your details to see the full layout take shape.</p>
      )}
    </article>
  );
}

function ResumePreviewModal({ data, template, onClose }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="resume-preview-backdrop" role="dialog" aria-modal="true" aria-label="Resume preview" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="resume-preview-modal">
        <div className="resume-preview-modal-header">
          <div>
            <strong>Resume preview</strong>
            <span>{(TEMPLATES.find(item => item.key === template) || TEMPLATES[0]).label} template</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="resume-preview-scroll">
          <ResumePreview data={data} template={template} />
        </div>
      </div>
    </div>
  );
}

function WritingPreviewModal({ title, body, format, onClose }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = event => {
      if (event.key === 'Escape') onClose();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const styles = {
    modern: { fontFamily: 'Arial, sans-serif', accent: '#102A6B', borderTop: '6px solid #102A6B' },
    classic: { fontFamily: 'Georgia, serif', accent: '#172033', borderTop: '1px solid #172033' },
    minimal: { fontFamily: 'Arial, sans-serif', accent: '#4B5563', borderTop: '1px solid #D1D5DB' },
  }[format] || { fontFamily: 'Arial, sans-serif', accent: '#102A6B', borderTop: '6px solid #102A6B' };

  return (
    <div className="resume-preview-backdrop" role="dialog" aria-modal="true" aria-label={`${title} preview`} onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="resume-preview-modal">
        <div className="resume-preview-modal-header">
          <div>
            <strong>{title} preview</strong>
            <span>Ready to export</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="resume-preview-scroll">
          <article style={{ background: '#fff', color: '#172033', minHeight: '100%', padding: '48px 52px', whiteSpace: 'pre-wrap', fontFamily: styles.fontFamily, fontSize: '.95rem', lineHeight: 1.75, borderTop: styles.borderTop }}>
            <strong style={{ display: 'block', color: styles.accent, fontSize: '.78rem', letterSpacing: 0, marginBottom: 28, textTransform: 'uppercase' }}>{title}</strong>
            {body}
          </article>
        </div>
      </div>
    </div>
  );
}

function PreparationLibrary({ watchedIds, onToggleWatched, saving }) {
  const [topic, setTopic] = useState('All');
  const [selectedVideoId, setSelectedVideoId] = useState(PREPARATION_VIDEOS[0].id);
  const [playingVideoId, setPlayingVideoId] = useState('');
  const filteredVideos = topic === 'All'
    ? PREPARATION_VIDEOS
    : PREPARATION_VIDEOS.filter(video => video.topic === topic);
  const activeVideo = filteredVideos.find(video => video.id === selectedVideoId) || filteredVideos[0];
  const watched = new Set(watchedIds);

  function selectTopic(nextTopic) {
    const nextVideos = nextTopic === 'All'
      ? PREPARATION_VIDEOS
      : PREPARATION_VIDEOS.filter(video => video.topic === nextTopic);
    setTopic(nextTopic);
    setSelectedVideoId(nextVideos[0]?.id || PREPARATION_VIDEOS[0].id);
    setPlayingVideoId('');
  }

  function playVideo(video) {
    setSelectedVideoId(video.id);
    setPlayingVideoId(video.id);
    window.requestAnimationFrame(() => {
      document.getElementById('resume-preparation-player')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (!activeVideo) return null;

  const mediaUrl = (video, extension) => `/media/preparation/${video.slug}.${extension}?v=${PREPARATION_ASSET_VERSION}`;

  return (
    <div className="resume-preparation-library">
      <div className="resume-preparation-heading">
        <div>
          <h2>Interview preparation</h2>
          <p>Practical lessons for each stage, from tailoring the resume through reviewing the offer.</p>
        </div>
        <div className="resume-preparation-progress" aria-label={`${watched.size} of ${PREPARATION_VIDEOS.length} videos completed`}>
          <strong>{watched.size}/{PREPARATION_VIDEOS.length}</strong>
          <span>completed</span>
        </div>
      </div>

      <div className="resume-preparation-topics" role="tablist" aria-label="Preparation video topics">
        {PREPARATION_TOPICS.map(item => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={topic === item}
            className={`resume-preparation-topic${topic === item ? ' is-selected' : ''}`}
            onClick={() => selectTopic(item)}
          >
            {item}
          </button>
        ))}
      </div>

      <section className="resume-preparation-featured" id="resume-preparation-player" aria-labelledby="resume-preparation-title">
        <div className="resume-preparation-player">
          {playingVideoId === activeVideo.id ? (
            <video
              key={activeVideo.id}
              src={mediaUrl(activeVideo, 'mp4')}
              poster={mediaUrl(activeVideo, 'svg')}
              title={activeVideo.title}
              aria-label={activeVideo.title}
              controls
              autoPlay
              playsInline
              preload="metadata"
            >
              <track kind="captions" src={mediaUrl(activeVideo, 'vtt')} srcLang="en" label="English" />
              Your browser cannot play this video.
            </video>
          ) : (
            <button type="button" className="resume-preparation-poster" onClick={() => playVideo(activeVideo)} aria-label={`Play ${activeVideo.title}`}>
              <img
                src={mediaUrl(activeVideo, 'svg')}
                alt=""
              />
              <span className="resume-preparation-play">Play video</span>
            </button>
          )}
        </div>
        <div className="resume-preparation-featured-copy">
          <span className="resume-preparation-eyebrow">{activeVideo.topic} | {activeVideo.source}</span>
          <h3 id="resume-preparation-title">{activeVideo.title}</h3>
          <p>{activeVideo.summary}</p>
          <ul>
            {activeVideo.takeaways.map(item => <li key={item}>{item}</li>)}
          </ul>
          <div className="resume-preparation-actions">
            <button
              type="button"
              className={watched.has(activeVideo.id) ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm'}
              onClick={() => onToggleWatched(activeVideo.id)}
              disabled={saving}
            >
              {watched.has(activeVideo.id) ? 'Mark incomplete' : 'Mark complete'}
            </button>
            {playingVideoId === activeVideo.id && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlayingVideoId('')}>Close player</button>
            )}
          </div>
        </div>
      </section>

      <div className="resume-preparation-grid">
        {filteredVideos.map(video => (
          <article key={video.id} className={`resume-preparation-card${activeVideo.id === video.id ? ' is-active' : ''}`}>
            <button type="button" className="resume-preparation-card-media" onClick={() => playVideo(video)} aria-label={`Play ${video.title}`}>
              <img src={mediaUrl(video, 'svg')} alt="" loading="lazy" />
              <span>{video.duration}</span>
            </button>
            <div className="resume-preparation-card-copy">
              <span>{video.topic} | {video.source}</span>
              <strong>{video.title}</strong>
              {watched.has(video.id) && <small>Completed</small>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export default function ResumeBuilder() {
  const navigate = useNavigate();
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [billingReady, setBillingReady] = useState(null);
  const [resumeBuilderPrice, setResumeBuilderPrice] = useState(null);
  const [unlocking, setUnlocking] = useState(false);
  const [template, setTemplate] = useState('modern');
  const [data, setData] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [drafting, setDrafting] = useState(null);
  const [activeBuilderTab, setActiveBuilderTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    return ['preparation', 'resume', 'cover-letter', 'outreach', 'jobs'].includes(requested) ? requested : 'preparation';
  });
  const [writingPreviewType, setWritingPreviewType] = useState(null);
  const [writingExporting, setWritingExporting] = useState(null);
  const [trackedJobs, setTrackedJobs] = useState([]);
  const [liveJobs, setLiveJobs] = useState([]);
  const [trackedJobsLoading, setTrackedJobsLoading] = useState(false);

  const unlocked = !!profile?.resumeBuilderAddon;

  useEffect(() => {
    let cancelled = false;
    client.get('/billing/config')
      .then(({ data: config }) => {
        if (cancelled) return;
        const price = config?.pricing?.resume_builder || null;
        setResumeBuilderPrice(price);
        setBillingReady(!!config?.stripeConfigured && !!config?.webhookConfigured && !!config?.tiers?.resume_builder && price?.matchesRequiredPrice === true);
      })
      .catch(() => {
        if (!cancelled) setBillingReady(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const upgrade = new URLSearchParams(window.location.search).get('upgrade');
    if (!upgrade) return;
    window.history.replaceState({}, '', window.location.pathname);
    if (upgrade === 'cancelled') {
      showToast('Checkout cancelled - no charge was made.', 'info');
      return;
    }
    refreshProfile()
      .then((nextProfile) => {
        showToast(nextProfile?.resumeBuilderAddon
          ? 'Resume Builder is unlocked.'
          : 'Payment received. Resume Builder will unlock in a moment.', 'success');
      })
      .catch(() => showToast('Payment received. Refresh in a moment if access has not appeared yet.', 'success'));
  }, [refreshProfile, showToast]);

  useEffect(() => {
    if (!unlocked) return;
    client.get('/resume-builder/draft')
      .then(({ data: res }) => {
        setTemplate(res.template || 'modern');
        setData(normalizeDraft(res.data));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) return undefined;
    let cancelled = false;
    client.get('/profile/attachments')
      .then(({ data: response }) => {
        if (cancelled) return;
        const attachments = Array.isArray(response?.attachments) ? response.attachments : [];
        const primary = attachments.find(item => item.isPrimary) || attachments[0];
        if (primary && primary.atsScore !== null && primary.atsScore !== undefined && Number.isFinite(Number(primary.atsScore))) {
          setExportResult(primary);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [unlocked]);

  useEffect(() => {
    if (!unlocked) {
      setTrackedJobs([]);
      setLiveJobs([]);
      return undefined;
    }
    let cancelled = false;
    setTrackedJobsLoading(true);
    Promise.allSettled([
      client.get('/jobs/tracking'),
      client.get('/opportunities', { params: { limit: 500 } }),
    ]).then(([trackedResponse, opportunitiesResponse]) => {
      if (cancelled) return;
      setTrackedJobs(trackedResponse.status === 'fulfilled' && Array.isArray(trackedResponse.value?.data?.jobs)
        ? trackedResponse.value.data.jobs
        : []);
      setLiveJobs(opportunitiesResponse.status === 'fulfilled' && Array.isArray(opportunitiesResponse.value?.data?.opportunities)
        ? opportunitiesResponse.value.data.opportunities
        : []);
    }).finally(() => {
      if (!cancelled) setTrackedJobsLoading(false);
    });
    return () => { cancelled = true; };
  }, [unlocked]);

  async function unlockResumeBuilder() {
    if (unlocking) return;
    setUnlocking(true);
    try {
      const { data: checkout } = await client.post('/billing/create-checkout-session', { tier: 'resume_builder' });
      window.location.assign(checkout.url);
    } catch (err) {
      showToast(err?.response?.data?.message || 'Could not start checkout. Please try again.', 'error');
      setUnlocking(false);
    }
  }

  async function saveDraft(nextData = data, successMessage = 'All changes saved.') {
    setSaving(true);
    try {
      await client.put('/resume-builder/draft', { template, data: nextData });
      showToast(successMessage, 'success');
      return true;
    } catch (err) {
      showToast(err?.response?.data?.message || 'Could not save your draft.', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function togglePreparationWatched(videoId) {
    if (saving) return;
    const currentIds = Array.isArray(data.preparation?.watchedVideoIds) ? data.preparation.watchedVideoIds : [];
    const isWatched = currentIds.includes(videoId);
    const watchedVideoIds = isWatched
      ? currentIds.filter(id => id !== videoId)
      : [...new Set([...currentIds, videoId])];
    const nextData = {
      ...data,
      preparation: { ...(data.preparation || {}), watchedVideoIds },
    };
    setData(nextData);
    const saved = await saveDraft(nextData, isWatched ? 'Video marked incomplete.' : 'Preparation progress saved.');
    if (!saved) setData(data);
  }

  function selectBuilderTab(tab) {
    setActiveBuilderTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  async function handleExport() {
    setExporting(true);
    setExportResult(null);
    try {
      await client.put('/resume-builder/draft', { template, data });
      const { data: res } = await client.post('/resume-builder/export', { template, data });
      setExportResult(res);
    } catch (err) {
      showToast(err?.response?.data?.message || 'Could not export your resume.', 'error');
    } finally {
      setExporting(false);
    }
  }

  function writingFor(type) {
    return type === 'cover_letter' ? data.coverLetter : data.outreach;
  }

  function previewWriting(type) {
    if (!String(writingFor(type)?.body || '').trim()) {
      showToast('Draft the writing first, then preview it here.', 'info');
      return;
    }
    setWritingPreviewType(type);
  }

  async function openCoverLetterPreview() {
    if (!String(data.coverLetter?.body || '').trim()) {
      showToast('Draft the cover letter first, then preview it.', 'info');
      return;
    }
    const saved = await saveDraft(data, 'Cover letter saved.');
    if (saved) navigate('/resume-builder/cover-letter/preview');
  }

  async function exportWriting(type) {
    const writing = writingFor(type);
    if (!String(writing?.body || '').trim() || writingExporting) {
      if (!String(writing?.body || '').trim()) showToast('Draft the writing first, then export it.', 'info');
      return;
    }
    setWritingExporting(type);
    try {
      const response = await client.post('/resume-builder/application-export', { type, data }, { responseType: 'blob' });
      const blob = response.data;
      if (!blob?.size) throw new Error('The exported file was empty.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const prefix = type === 'cover_letter' ? 'cover-letter' : 'reach-out-message';
      link.href = url;
      link.download = `${prefix}-${(writing.company || data.contact.name || 'uficonnect').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'uficonnect'}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(`${type === 'cover_letter' ? 'Cover letter' : 'Reach-out message'} exported.`, 'success');
    } catch (err) {
      showToast(err?.response?.data?.message || err?.message || 'Could not export the writing.', 'error');
    } finally {
      setWritingExporting(null);
    }
  }

  function setContact(field, value) {
    setData(prev => ({ ...prev, contact: { ...prev.contact, [field]: value } }));
  }

  function addExperience() {
    setData(prev => ({ ...prev, experience: [...prev.experience, { company: '', role: '', location: '', startDate: '', endDate: '', current: false, bullets: [''] }] }));
  }
  function updateExperience(i, field, value) {
    setData(prev => ({ ...prev, experience: prev.experience.map((job, idx) => idx === i ? { ...job, [field]: value } : job) }));
  }
  function removeExperience(i) {
    setData(prev => ({ ...prev, experience: prev.experience.filter((_, idx) => idx !== i) }));
  }
  function addBullet(i) {
    setData(prev => ({ ...prev, experience: prev.experience.map((job, idx) => idx === i ? { ...job, bullets: [...job.bullets, ''] } : job) }));
  }
  function updateBullet(i, bi, value) {
    setData(prev => ({ ...prev, experience: prev.experience.map((job, idx) => idx === i ? { ...job, bullets: job.bullets.map((b, bidx) => bidx === bi ? value : b) } : job) }));
  }
  function removeBullet(i, bi) {
    setData(prev => ({ ...prev, experience: prev.experience.map((job, idx) => idx === i ? { ...job, bullets: job.bullets.filter((_, bidx) => bidx !== bi) } : job) }));
  }

  function addEducation() {
    setData(prev => ({ ...prev, education: [...prev.education, { school: '', degree: '', field: '', startDate: '', endDate: '' }] }));
  }
  function updateEducation(i, field, value) {
    setData(prev => ({ ...prev, education: prev.education.map((ed, idx) => idx === i ? { ...ed, [field]: value } : ed) }));
  }
  function removeEducation(i) {
    setData(prev => ({ ...prev, education: prev.education.filter((_, idx) => idx !== i) }));
  }

  function updateWriting(section, field, value) {
    setData(prev => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
  }

  const jobContactOptions = useMemo(() => {
    const liveJobsById = new Map(liveJobs.filter(job => job?.id).map(job => [job.id, job]));
    const trackedJobContacts = trackedJobs
      .filter(job => job.status === 'saved' || job.status === 'applied')
      .map(job => toJobContact({ ...job, ...(liveJobsById.get(job.id) || {}) }));
    const trackedJobIds = new Set(trackedJobContacts.map(job => job.id));
    return [
      ...trackedJobContacts,
      ...liveJobs.filter(job => job?.id && !trackedJobIds.has(job.id)).map(toJobContact),
    ].slice(0, 500);
  }, [liveJobs, trackedJobs]);

  function useTrackedJobForWriting(job, destination) {
    if (destination === 'cover-letter') {
      setData(prev => ({
        ...prev,
        coverLetter: {
          ...prev.coverLetter,
          role: job.title || prev.coverLetter.role,
          company: job.org || prev.coverLetter.company,
          jobDescription: job.content || prev.coverLetter.jobDescription,
        },
      }));
      setActiveBuilderTab('cover-letter');
      showToast('Job details added to your cover letter.', 'success');
      return;
    }
    setData(prev => ({
      ...prev,
      outreach: {
        ...prev.outreach,
        recipientName: job.recipientName || prev.outreach.recipientName,
        recipientRole: job.recipientRole || prev.outreach.recipientRole,
        company: job.org || prev.outreach.company,
        context: `I am interested in the ${job.title || 'open'} role${job.org ? ` at ${job.org}` : ''}.`,
      },
    }));
    setActiveBuilderTab('outreach');
    showToast('Job and contact details added to your message.', 'success');
  }

  async function generateApplicationDraft(type) {
    if (drafting) return;
    const section = type === 'cover_letter' ? 'coverLetter' : 'outreach';
    const writing = data[section];
    setDrafting(type);
    try {
      const payload = type === 'cover_letter'
        ? {
          type,
          resume: data,
          role: writing.role,
          company: writing.company,
          jobDescription: writing.jobDescription,
          tone: writing.tone,
          format: writing.format,
        }
        : {
          type,
          resume: data,
          recipientName: writing.recipientName,
          recipientRole: writing.recipientRole,
          company: writing.company,
          context: writing.context,
          tone: writing.tone,
          format: writing.format,
        };
      const { data: response } = await client.post('/resume-builder/application-draft', payload);
      const body = String(response?.draft || '').trim();
      if (!body) throw new Error('No draft was returned.');
      const nextData = { ...data, [section]: { ...writing, body } };
      setData(nextData);
      const label = type === 'cover_letter' ? 'Cover letter' : 'Outreach message';
      const saved = await saveDraft(nextData, `${label} drafted and saved.`);
      if (!saved) showToast(`${label} is ready here. Save it once storage is available.`, 'info');
    } catch (err) {
      showToast(err?.response?.data?.message || err.message || 'Could not generate a draft.', 'error');
    } finally {
      setDrafting(null);
    }
  }

  async function copyWriting(text, label) {
    const value = String(text || '').trim();
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement('textarea');
        input.value = value;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        if (!copied) throw new Error('Copy was blocked.');
      }
      showToast(`${label} copied.`, 'success');
    } catch {
      showToast('Copy was blocked. Select the text and copy it manually.', 'error');
    }
  }

  function goBack() {
    if (window.history.state?.idx > 0) {
      navigate(-1);
      return;
    }
    navigate('/');
  }

  return (
    <>
      <Helmet><title>Resume Builder | UFIconnect</title></Helmet>
      <Layout>
        <div style={{ marginBottom: 20 }}>
          <button type="button" className="btn-back" onClick={goBack} style={{ marginBottom: 14 }}>
            <span className="btn-back-icon" aria-hidden="true">&#8249;</span> Back
          </button>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Resume Builder
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '.85rem', margin: '4px 0 0' }}>
            Interview preparation, original templates, AI-assisted writing, and scored exports saved to your Attachments.
          </p>
        </div>

        {!profile ? (
          <div className="empty-state"><span className="spinner spinner-primary" /></div>
        ) : !unlocked ? (
          <LockedState onUnlock={unlockResumeBuilder} unlocking={unlocking} billingReady={billingReady} price={resumeBuilderPrice} />
        ) : !loaded ? (
          <div className="empty-state"><span className="spinner spinner-primary" /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
            <div className="resume-builder-tabs" role="tablist" aria-label="Resume Builder">
              {[
                ['preparation', 'Preparation videos'],
                ['resume', 'Resume'],
                ['cover-letter', 'Cover letter'],
                ['outreach', 'Reach-out messages'],
                ['jobs', 'Jobs & contacts'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  id={`resume-builder-tab-${key}`}
                  role="tab"
                  type="button"
                  aria-selected={activeBuilderTab === key}
                  onClick={() => selectBuilderTab(key)}
                  className={`btn btn-sm resume-builder-tab${activeBuilderTab === key ? ' is-selected' : ''}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeBuilderTab === 'preparation' && (
              <PreparationLibrary
                watchedIds={data.preparation?.watchedVideoIds || []}
                onToggleWatched={togglePreparationWatched}
                saving={saving}
              />
            )}

            {activeBuilderTab === 'resume' && <>
            <div className="card">
              <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Template</div>
              <div className="resume-template-grid" role="group" aria-label="Resume template">
                {TEMPLATES.map(t => (
                  <button
                    key={t.key} type="button" onClick={() => setTemplate(t.key)}
                    className={`resume-template-option${template === t.key ? ' is-selected' : ''}`}
                    aria-pressed={template === t.key}
                  >
                    <span className="resume-template-swatch" style={{ background: t.accent }} aria-hidden="true" />
                    <span>
                      <strong>{t.label}</strong>
                      <small>{t.desc}</small>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 style={{ margin: '0 0 12px', fontSize: '.9rem' }}>Contact</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                <Field label="Full name" value={data.contact.name} onChange={e => setContact('name', e.target.value)} />
                <Field label="Title" value={data.contact.title} onChange={e => setContact('title', e.target.value)} placeholder="e.g. Senior Product Designer" />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <Field label="Email" value={data.contact.email} onChange={e => setContact('email', e.target.value)} />
                <Field label="Phone" value={data.contact.phone} onChange={e => setContact('phone', e.target.value)} />
                <Field label="Location" value={data.contact.location} onChange={e => setContact('location', e.target.value)} />
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: '.9rem' }}>Summary</h3>
                <AIAssistButton
                  field="summary"
                  context={data.summary || `${data.contact.title || 'professional'} with experience in ${(data.skills || []).slice(0, 5).join(', ') || 'their field'}`}
                  onResult={s => setData(prev => ({ ...prev, summary: s }))}
                />
              </div>
              <textarea
                value={data.summary} onChange={e => setData(prev => ({ ...prev, summary: e.target.value }))}
                rows={3} placeholder="2-3 sentence professional summary..."
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.85rem', fontFamily: 'inherit', resize: 'vertical' }}
              />
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: '.9rem' }}>Experience</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addExperience}>+ Add</button>
              </div>
              {data.experience.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '.82rem', margin: 0 }}>No experience added yet.</p>}
              {data.experience.map((job, i) => (
                <div key={i} style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)', marginBottom: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <Field label="Role" value={job.role} onChange={e => updateExperience(i, 'role', e.target.value)} />
                    <Field label="Company" value={job.company} onChange={e => updateExperience(i, 'company', e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <Field label="Location" value={job.location} onChange={e => updateExperience(i, 'location', e.target.value)} />
                    <Field label="Start" placeholder="e.g. 2021" value={job.startDate} onChange={e => updateExperience(i, 'startDate', e.target.value)} />
                    <Field label="End" placeholder="e.g. 2023" value={job.endDate} disabled={job.current} onChange={e => updateExperience(i, 'endDate', e.target.value)} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.78rem', color: 'var(--muted)', marginTop: 20 }}>
                      <input type="checkbox" checked={!!job.current} onChange={e => updateExperience(i, 'current', e.target.checked)} /> Current
                    </label>
                  </div>
                  <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>Bullet points</div>
                  {job.bullets.map((b, bi) => (
                    <div key={bi} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <input
                        className="form-input" style={{ fontSize: '.83rem', padding: '7px 10px' }}
                        value={b} onChange={e => updateBullet(i, bi, e.target.value)}
                        placeholder="e.g. led a redesign that increased signups 18%"
                      />
                      <AIAssistButton field="bullets" context={b} label="AI" onResult={s => updateBullet(i, bi, s)} />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeBullet(i, bi)}>Remove</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => addBullet(i)}>+ Bullet</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeExperience(i)} style={{ color: '#DC2626' }}>Remove role</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: '.9rem' }}>Education</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addEducation}>+ Add</button>
              </div>
              {data.education.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '.82rem', margin: 0 }}>No education added yet.</p>}
              {data.education.map((ed, i) => (
                <div key={i} style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)', marginBottom: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <Field label="School" value={ed.school} onChange={e => updateEducation(i, 'school', e.target.value)} />
                    <Field label="Degree" value={ed.degree} onChange={e => updateEducation(i, 'degree', e.target.value)} placeholder="e.g. B.S." />
                    <Field label="Field of study" value={ed.field} onChange={e => updateEducation(i, 'field', e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <Field label="Start" value={ed.startDate} onChange={e => updateEducation(i, 'startDate', e.target.value)} />
                    <Field label="End" value={ed.endDate} onChange={e => updateEducation(i, 'endDate', e.target.value)} />
                  </div>
                  <div style={{ textAlign: 'right', marginTop: 8 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeEducation(i)} style={{ color: '#DC2626' }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <h3 style={{ margin: '0 0 8px', fontSize: '.9rem' }}>Skills</h3>
              <input
                className="form-input" style={{ fontSize: '.85rem' }}
                value={data.skills.join(', ')}
                onChange={e => setData(prev => ({ ...prev, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                placeholder="Comma-separated, e.g. React, Figma, SQL"
              />
              <div className="resume-builder-actions">
                <button className="btn btn-ghost" type="button" onClick={() => saveDraft()} disabled={saving}>
                  {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save all changes'}
                </button>
                <button className="btn btn-outline" type="button" onClick={() => setPreviewOpen(true)}>
                  Preview resume
                </button>
                <button className="btn btn-primary" type="button" onClick={handleExport} disabled={exporting || !data.contact.name}>
                  {exporting ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Export PDF'}
                </button>
              </div>
              {exportResult && (
                <div className="resume-builder-score">
                  <div>
                    <strong>ATS score {exportResult.atsScore}/100</strong>
                    <span>{exportResult.filename ? `Primary resume: ${exportResult.filename}` : 'Saved with your primary resume.'}</span>
                  </div>
                  <span className="resume-builder-score-note">Updates after each export</span>
                </div>
              )}
            </div>
            </>}

            {activeBuilderTab === 'jobs' && <div className="card">
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '.95rem' }}>Jobs and people to reach out to</h3>
                <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                  Up to 500 relevant listings, with saved and applied jobs first. Public contacts appear only when a listing provides one.
                </p>
              </div>
              {trackedJobsLoading ? (
                <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>Loading your tracked jobs...</div>
              ) : jobContactOptions.length === 0 ? (
                <div style={{ fontSize: '.8rem', color: 'var(--muted)' }}>No live listings are available yet. Refresh Job Tracker and try again.</div>
              ) : (
                <div className="resume-job-contact-list" style={{ display: 'grid', gap: 10, maxHeight: 'min(78vh, 980px)', overflowY: 'auto', paddingRight: 4 }}>
                  {jobContactOptions.map(job => (
                    <div className="resume-job-contact-row" key={job.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                      <div className="resume-job-contact-details" style={{ minWidth: 0 }}>
                        <strong style={{ display: 'block', fontSize: '.86rem' }}>{job.title || 'Tracked role'}</strong>
                        <span className="resume-job-contact-heading-meta">
                          {[job.org || 'Hiring team', job.status === 'saved' ? 'Saved' : job.status === 'applied' ? 'Applied' : 'Live listing'].filter(Boolean).join(' | ')}
                        </span>
                        <p className="resume-job-contact-description">{job.displaySummary}</p>
                        <div className="resume-job-contact-facts" aria-label="Listing details">
                          {job.displayFacts.map(fact => <span key={fact}>{fact}</span>)}
                        </div>
                        <div className="resume-job-contact-person">
                          <span className="resume-job-contact-person-label">Contact</span>
                          {(job.recipientName || job.publicContact || job.recruiterRole) ? (
                            <span>
                              {[job.recipientName, job.recruiterRole || job.recipientRole].filter(Boolean).join(' | ')}
                              {job.publicContact && <>{(job.recipientName || job.recruiterRole) ? ' | ' : ''}<a href={`mailto:${job.publicContact}`}>{job.publicContact}</a></>}
                            </span>
                          ) : (
                            <span>Recruiting contact not published. Use the job listing to reach the hiring team.</span>
                          )}
                        </div>
                      </div>
                      <div className="resume-job-contact-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 0 }}>
                        {job.sourceUrl && <a className="btn btn-ghost btn-sm" href={job.sourceUrl} target="_blank" rel="noreferrer">Job</a>}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => useTrackedJobForWriting(job, 'cover-letter')}>Copy for letter</button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => useTrackedJobForWriting(job, 'outreach')}>Copy for message</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>}

            {(activeBuilderTab === 'cover-letter' || activeBuilderTab === 'outreach') && <div className="card">
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '.95rem' }}>{activeBuilderTab === 'cover-letter' ? 'Cover letter' : 'Reach-out messages'}</h3>
                <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                  Draft from the resume above, then edit the result. Each generated draft is saved with your resume.
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 22 }}>
                {activeBuilderTab === 'cover-letter' && (
                  <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <Field label="Role" value={data.coverLetter.role} onChange={e => updateWriting('coverLetter', 'role', e.target.value)} placeholder="e.g. Product Designer" />
                    <Field label="Company" value={data.coverLetter.company} onChange={e => updateWriting('coverLetter', 'company', e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tone</label>
                      <select className="form-input" value={data.coverLetter.tone} onChange={e => updateWriting('coverLetter', 'tone', e.target.value)} style={{ fontSize: '.85rem', padding: '8px 10px' }}>
                        <option>Warm and professional</option>
                        <option>Confident and direct</option>
                        <option>Thoughtful and conversational</option>
                      </select>
                    </div>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Template</label>
                      <select className="form-input" value={data.coverLetter.format} onChange={e => updateWriting('coverLetter', 'format', e.target.value)} style={{ fontSize: '.85rem', padding: '8px 10px' }}>
                        <option value="modern">Modern</option>
                        <option value="classic">Classic</option>
                        <option value="minimal">Minimal</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Job description</label>
                    <textarea
                      value={data.coverLetter.jobDescription}
                      onChange={e => updateWriting('coverLetter', 'jobDescription', e.target.value)}
                      rows={4}
                      placeholder="Paste the responsibilities or a few details to tailor the letter."
                      style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: '.84rem', fontFamily: 'inherit', resize: 'vertical' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    <button className="btn btn-primary btn-sm" type="button" onClick={() => generateApplicationDraft('cover_letter')} disabled={!!drafting}>
                      {drafting === 'cover_letter' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Draft cover letter'}
                    </button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={openCoverLetterPreview} disabled={!data.coverLetter.body || saving}>Preview page</button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => copyWriting(data.coverLetter.body, 'Cover letter')} disabled={!data.coverLetter.body}>Copy</button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => exportWriting('cover_letter')} disabled={!data.coverLetter.body || writingExporting !== null}>
                      {writingExporting === 'cover_letter' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Export PDF'}
                    </button>
                  </div>
                  <textarea
                    value={data.coverLetter.body}
                    onChange={e => updateWriting('coverLetter', 'body', e.target.value)}
                    rows={11}
                    placeholder="Your cover letter will appear here."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: '.85rem', fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical' }}
                  />
                  </div>
                )}

                {activeBuilderTab === 'outreach' && (
                  <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <Field label="Recipient" value={data.outreach.recipientName} onChange={e => updateWriting('outreach', 'recipientName', e.target.value)} placeholder="e.g. Alex Morgan" />
                    <Field label="Their role" value={data.outreach.recipientRole} onChange={e => updateWriting('outreach', 'recipientRole', e.target.value)} placeholder="e.g. Design Director" />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <Field label="Company" value={data.outreach.company} onChange={e => updateWriting('outreach', 'company', e.target.value)} />
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tone</label>
                      <select className="form-input" value={data.outreach.tone} onChange={e => updateWriting('outreach', 'tone', e.target.value)} style={{ fontSize: '.85rem', padding: '8px 10px' }}>
                        <option>Warm and professional</option>
                        <option>Confident and direct</option>
                        <option>Thoughtful and conversational</option>
                      </select>
                    </div>
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Format</label>
                      <select className="form-input" value={data.outreach.format} onChange={e => updateWriting('outreach', 'format', e.target.value)} style={{ fontSize: '.85rem', padding: '8px 10px' }}>
                        <option value="modern">Modern</option>
                        <option value="classic">Classic</option>
                        <option value="minimal">Minimal</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Why you are reaching out</label>
                    <textarea
                      value={data.outreach.context}
                      onChange={e => updateWriting('outreach', 'context', e.target.value)}
                      rows={4}
                      placeholder="For example: their product talk stood out, and you would value a short conversation about the team."
                      style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: '.84rem', fontFamily: 'inherit', resize: 'vertical' }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    <button className="btn btn-primary btn-sm" type="button" onClick={() => generateApplicationDraft('outreach')} disabled={!!drafting}>
                      {drafting === 'outreach' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Draft message'}
                    </button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => previewWriting('outreach')} disabled={!data.outreach.body}>Preview</button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => copyWriting(data.outreach.body, 'Reach-out message')} disabled={!data.outreach.body}>Copy</button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => exportWriting('outreach')} disabled={!data.outreach.body || writingExporting !== null}>
                      {writingExporting === 'outreach' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Export PDF'}
                    </button>
                  </div>
                  <textarea
                    value={data.outreach.body}
                    onChange={e => updateWriting('outreach', 'body', e.target.value)}
                    rows={11}
                    placeholder="Your reach-out message will appear here."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: '.85rem', fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical' }}
                  />
                  </div>
                )}
              </div>
            </div>}

          </div>
        )}
        {previewOpen && <ResumePreviewModal data={data} template={template} onClose={() => setPreviewOpen(false)} />}
        {writingPreviewType && <WritingPreviewModal
          title={writingPreviewType === 'cover_letter' ? 'Cover letter' : 'Reach-out message'}
          body={writingFor(writingPreviewType).body}
          format={writingFor(writingPreviewType).format}
          onClose={() => setWritingPreviewType(null)}
        />}
      </Layout>
    </>
  );
}
