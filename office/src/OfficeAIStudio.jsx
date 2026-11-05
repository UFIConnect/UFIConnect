import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Camera, Check, Clapperboard, Download, Film, Image, KeyRound, Play, Plus, RefreshCw, Sparkles, Square, Trash2, Users } from 'lucide-react';
import OfficeAIStudioKeys from './OfficeAIStudioKeys';
import './OfficeAIStudio.css';

const KINDS = [['photo', 'Photo', Camera], ['video', 'Video', Film], ['movie', 'Movie', Clapperboard]];
const ROLES = ['Producer', 'Director', 'Screenwriter', 'Cinematographer', 'Continuity editor'];
const STATUSES = { draft: 'Ready to generate', generating: 'Rendering', ready: 'Ready', failed: 'Needs retry', cancelled: 'Stopped', needs_review: 'Review needed' };
const newForm = () => ({ kind: 'photo', title: '', prompt: '', duration: '2', unit: 'minutes', creativity: 'balanced', brief: '', roles: ['Producer', 'Director', 'Continuity editor'], characters: [] });
const character = () => ({ name: '', appearance: '', personality: '', voice: '' });
const cleanError = value => String(value || '').replace(/\bBearer\s+\S+/gi, '[credential omitted]').replace(/\b(?:sk-[a-zA-Z0-9_-]+|[a-z_]*(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+)/gi, '[credential omitted]').slice(0, 500);
const durationLabel = seconds => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 sec';
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), remaining = Math.round(seconds % 60);
  return [hours && `${hours.toLocaleString()} hr`, minutes && `${minutes} min`, remaining && `${remaining} sec`].filter(Boolean).join(' ');
};
const dateLabel = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
function mediaUrl(value, image = false) {
  if (typeof value !== 'string') return null;
  if (image && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) return value;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
async function payload(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(response.status === 401 ? 'Office access changed. Sign in again to open your projects.' : cleanError(data.error || data.message || `Studio could not complete this request (${response.status}).`));
  return data;
}
function FilmPlayer({ project }) {
  const assembled = project.assembly?.complete && mediaUrl(project.assembly.url);
  const clips = assembled ? [{ id: `assembly-${project.assembly.id}`, mediaUrl: assembled }] : (project.chapters || []).filter(item => item.index >= 0 && mediaUrl(item.mediaUrl) && ['ready', 'completed'].includes(item.status));
  const [index, setIndex] = useState(0), [continuous, setContinuous] = useState(true);
  const playingNext = useRef(false), video = useRef(null);
  const current = clips[Math.min(index, Math.max(0, clips.length - 1))];
  useEffect(() => { setIndex(0); playingNext.current = false; }, [project.id]);
  useEffect(() => {
    if (playingNext.current) { playingNext.current = false; video.current?.play().catch(() => {}); }
  }, [current?.id]);
  if (!clips.length) return null;
  return <section className="studio-player" aria-label="Movie playback">
    <video ref={video} controls playsInline preload="metadata" src={mediaUrl(current.mediaUrl)} onEnded={() => { if (continuous && index + 1 < clips.length) { playingNext.current = true; setIndex(value => value + 1); } }} />
    <div className="studio-player-toolbar"><span><Film size={14} />{assembled ? 'Full movie' : `Chapter ${index + 1} of ${clips.length}`}</span>{!assembled && <label><input type="checkbox" checked={continuous} onChange={event => setContinuous(event.target.checked)} />Play chapters continuously</label>}</div>
    {clips.length > 1 && <div className="studio-chapter-picker" aria-label="Choose a chapter">{clips.map((clip, position) => <button type="button" key={clip.id || position} aria-pressed={position === index} onClick={() => { setIndex(position); playingNext.current = false; }}><Play size={12} />{position + 1}</button>)}</div>}
  </section>;
}

export default function OfficeAIStudio({ apiBase = '', request = fetch, active = true, initialBrief }) {
  const [form, setForm] = useState(newForm), [capabilities, setCapabilities] = useState(null), [projects, setProjects] = useState([]), [project, setProject] = useState(null);
  const [view, setView] = useState('create');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState(''), [revision, setRevision] = useState(0), [nextProjectOffset, setNextProjectOffset] = useState(null);
  const epoch = useRef(0), mounted = useRef(false), requests = useRef(new Set()), selected = useRef(null), readSequence = useRef(0), submission = useRef(null), mutating = useRef(false);
  const root = `${apiBase}/office/ai/studio`;
  useEffect(() => { if (initialBrief?.id) { setView('create'); setForm(previous => ({ ...previous, kind: initialBrief.kind, title: initialBrief.title, prompt: initialBrief.prompt })); setNotice('Your idea is ready. Review the brief and create your project.'); } }, [initialBrief?.id]);
  const update = (field, value) => setForm(previous => ({ ...previous, [field]: value }));
  const updateCharacter = (index, field, value) => update('characters', form.characters.map((item, position) => position === index ? { ...item, [field]: value } : item));
  const record = value => { setProject(value); setProjects(previous => [value, ...previous.filter(item => item.id !== value.id)]); };
  async function call(path = '', options = {}) {
    const controller = new AbortController(); requests.current.add(controller);
    const deadline = setTimeout(() => controller.abort(), options.method === 'POST' ? 180000 : 100000);
    try { return await payload(await request(`${root}${path}`, { ...options, signal: controller.signal })); }
    finally { clearTimeout(deadline); requests.current.delete(controller); }
  }
  useEffect(() => {
    mounted.current = true;
    const reset = () => {
      epoch.current++; readSequence.current++; requests.current.forEach(controller => controller.abort()); selected.current = null; submission.current = null; mutating.current = false;
      setForm(newForm()); setProjects([]); setProject(null); setCapabilities(null); setError(''); setNotice(''); setBusy(''); setNextProjectOffset(null); setView('create'); setRevision(value => value + 1);
    };
    window.addEventListener('office-token-changed', reset);
    return () => { mounted.current = false; epoch.current++; readSequence.current++; requests.current.forEach(controller => controller.abort()); window.removeEventListener('office-token-changed', reset); };
  }, []);
  useEffect(() => {
    if (!active) return;
    const current = epoch.current; let valid = true;
    setLoading(true);
    call().then(data => {
      if (!valid || current !== epoch.current || !mounted.current) return;
      if (!data.capabilities || !Array.isArray(data.projects)) throw Error('Studio returned an incomplete project list. Refresh to retry.');
      setCapabilities(data.capabilities); setProjects(data.projects); setNextProjectOffset(data.nextProjectOffset ?? null); setError('');
    }).catch(cause => { if (valid && current === epoch.current && mounted.current) setError(cause.name === 'AbortError' ? 'Studio took too long to respond. Refresh to retry.' : cleanError(cause.message)); })
      .finally(() => { if (valid && current === epoch.current && mounted.current) setLoading(false); });
    return () => { valid = false; };
  }, [root, request, revision, active]);
  useEffect(() => {
    if (!active || !project?.id || project.status !== 'generating') return;
    const id = project.id, current = epoch.current; let valid = true, timer;
    async function poll() {
      try {
        const data = await call(`/projects/${encodeURIComponent(id)}`);
        if (valid && mounted.current && current === epoch.current && selected.current === id) {
          if (!data.project?.id) throw Error('The render status is unavailable. Refresh this project.');
          record(data.project); setError('');
          if (data.project.status === 'generating') timer = setTimeout(poll, 5000);
        }
      } catch (cause) { if (valid && current === epoch.current && mounted.current) { setError('Render status could not be checked. Refresh the project to reconnect; your saved render will continue.'); timer = setTimeout(poll, 15000); } }
    }
    timer = setTimeout(poll, 5000);
    return () => { valid = false; clearTimeout(timer); };
  }, [active, project?.id, project?.status, root, request]);
  async function open(id) {
    if (mutating.current) return;
    const current = epoch.current, sequence = ++readSequence.current; selected.current = id; setBusy('open'); setError(''); setNotice(''); setProject(null);
    try {
      const data = await call(`/projects/${encodeURIComponent(id)}`);
      if (mounted.current && current === epoch.current && sequence === readSequence.current) { if (!data.project?.id) throw Error('This saved project is unavailable.'); record(data.project); }
    } catch (cause) { if (mounted.current && current === epoch.current && sequence === readSequence.current) setError(cleanError(cause.message)); }
    finally { if (mounted.current && current === epoch.current && sequence === readSequence.current) setBusy(''); }
  }
  async function create(event) {
    event.preventDefault(); if (mutating.current) return;
    const seconds = form.kind === 'photo' ? 0 : Number(form.duration) * ({ seconds: 1, minutes: 60, hours: 3600 }[form.unit]);
    if (form.kind !== 'photo' && (!Number.isSafeInteger(seconds) || seconds < 4)) { setError('Choose a video duration of at least 4 seconds, using a whole number of seconds.'); return; }
    const body = { kind: form.kind, title: form.title.trim(), prompt: form.prompt.trim(), durationSeconds: seconds, creativity: form.creativity, producer: { brief: form.brief.trim(), roles: form.roles }, characters: form.characters.map(({name, appearance, personality, voice}) => ({name: name.trim(), appearance: appearance.trim(), personality: personality.trim(), voice: voice.trim()})) };
    if (new TextEncoder().encode(JSON.stringify(body)).length > 64000) { setError('This production brief is too large. Shorten the story or character notes to keep the saved plan under 64 KB.'); return; }
    const signature = JSON.stringify(body);
    if (!submission.current || submission.current.signature !== signature) submission.current = { signature, clientRequestId: crypto.randomUUID() };
    const current = epoch.current; mutating.current = true; readSequence.current++; setBusy('create'); setError(''); setNotice('');
    try {
      const data = await call('/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, clientRequestId: submission.current.clientRequestId }) });
      if (mounted.current && current === epoch.current) {
        if (!data.project?.id) throw Error('The project receipt did not arrive. Retry this same brief to recover it.');
        selected.current = data.project.id; record(data.project); submission.current = null; setNotice('Project saved. Review the brief below, then generate when you are ready.');
      }
    } catch (cause) { if (mounted.current && current === epoch.current) setError(cause.name === 'AbortError' || cause.name === 'TypeError' ? 'The connection ended before the project receipt arrived. Retry this same brief to recover it without creating a duplicate.' : cleanError(cause.message)); }
    finally { if (mounted.current && current === epoch.current) { mutating.current = false; setBusy(''); } }
  }
  async function action(name) {
    if (mutating.current || !project?.id) return;
    const current = epoch.current, id = project.id; mutating.current = true; setBusy(name); setError(''); setNotice('');
    try {
      const data = await call(`/projects/${encodeURIComponent(id)}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (mounted.current && current === epoch.current && selected.current === id) { if (!data.project?.id) throw Error('The project receipt is unavailable. Refresh the project before retrying.'); record(data.project); }
    } catch (cause) { if (mounted.current && current === epoch.current) setError(cause.name === 'AbortError' || cause.name === 'TypeError' ? 'The operation receipt did not arrive. Refresh this project to recover its current state before retrying.' : cleanError(cause.message)); }
    finally { if (mounted.current && current === epoch.current) { mutating.current = false; setBusy(''); } }
  }
  async function exportProject() {
    if (!project?.id || busy) return;
    const current = epoch.current, id = project.id; setBusy('export'); setError('');
    try {
      const data = await call(`/projects/${encodeURIComponent(id)}/export`);
      if (!mounted.current || current !== epoch.current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `${project.title.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 70) || 'studio-project'}-production.json`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { if (mounted.current && current === epoch.current) setError(cleanError(cause.message)); }
    finally { if (mounted.current && current === epoch.current) setBusy(''); }
  }
  async function loadChapters() {
    if (busy || project?.nextChapterOffset == null) return;
    const current = epoch.current, original = project; setBusy('chapters'); setError('');
    try {
      const data = await call(`/projects/${encodeURIComponent(original.id)}?after=${original.nextChapterOffset}`);
      if (mounted.current && current === epoch.current && selected.current === original.id) {
        if (!data.project?.id) throw Error('The next chapter page is unavailable. Retry loading the chapters.');
        const merge = key => [...new Map([...(original[key] || []), ...(data.project[key] || [])].map(item => [item.id, item])).values()];
        record({ ...data.project, chapters: merge('chapters'), artifacts: merge('artifacts') });
      }
    } catch (cause) { if (mounted.current && current === epoch.current) setError(cleanError(cause.message)); }
    finally { if (mounted.current && current === epoch.current) setBusy(''); }
  }
  async function loadProjects() {
    if (busy || nextProjectOffset == null) return;
    const current = epoch.current; setBusy('projects'); setError('');
    try {
      const data = await call(`?after=${nextProjectOffset}`);
      if (mounted.current && current === epoch.current) {
        if (!Array.isArray(data.projects)) throw Error('The next project page is unavailable. Retry loading projects.');
        setProjects(previous => [...new Map([...previous, ...data.projects].map(item => [item.id, item])).values()]); setNextProjectOffset(data.nextProjectOffset ?? null);
      }
    } catch (cause) { if (mounted.current && current === epoch.current) setError(cleanError(cause.message)); }
    finally { if (mounted.current && current === epoch.current) setBusy(''); }
  }
  const isPhoto = form.kind === 'photo', projectPhoto = project?.kind === 'photo', renderAvailable = !!(project && capabilities?.[project.kind]);
  const artifacts = (project?.artifacts || []).filter(item => mediaUrl(item.url, item.kind === 'image'));
  const photo = artifacts.find(item => item.kind === 'image');
  const progress = projectPhoto ? project?.status === 'ready' ? 100 : 0 : project?.durationSeconds ? Math.min(100, (project.completedSeconds || 0) / project.durationSeconds * 100) : 0;
  return <section className="office-ai-studio" aria-label="Photo and movie studio">
    <header className="studio-heading"><div><p className="studio-eyebrow"><Clapperboard size={15} />UFICONNECT STUDIO</p><h2>From an idea to the screen.</h2><p>Create a photo, a short video, or a longer film with your own cast and production team.</p></div><button type="button" disabled={loading || !!busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />Refresh Studio</button></header>
    <nav className="studio-workspaces" aria-label="Studio sections"><button type="button" aria-pressed={view === 'create'} onClick={() => setView('create')}><Clapperboard size={16} />Create</button><button type="button" aria-pressed={view === 'keys'} onClick={() => setView('keys')}><KeyRound size={16} />API keys</button></nav>
    <div hidden={view !== 'keys'}><OfficeAIStudioKeys apiBase={apiBase} request={request} active={active && view === 'keys'} /></div>
    <div hidden={view !== 'create'}>
    <div className="studio-readiness" aria-label="Generation connections">{KINDS.map(([kind, label, Icon]) => <span key={kind} data-ready={!!capabilities?.[kind]}><Icon size={14} />{label}<small>{loading ? 'Checking' : capabilities?.[kind] ? 'Configured' : 'Needs connection'}</small></span>)}</div>
    {error && <p className="office-ai-error" role="alert">{error}</p>}{notice && <p className="office-ai-notice" role="status"><Check size={15} />{notice}</p>}
    <div className="studio-layout"><div className="studio-main">
      <form className="studio-brief" onSubmit={create}>
        <div className="studio-card-title"><div><span>01 / YOUR IDEA</span><h3>Set the creative direction</h3></div><Sparkles size={21} /></div>
        <div className="studio-kind" aria-label="Creation type">{KINDS.map(([kind, label, Icon]) => <button key={kind} type="button" aria-pressed={form.kind === kind} disabled={!!busy} onClick={() => update('kind', kind)}><Icon size={18} /><strong>{label}</strong><small>{kind === 'photo' ? 'A single image' : kind === 'video' ? 'One visual story' : 'A film in chapters'}</small></button>)}</div>
        <label className="office-ai-field">Project title<input required maxLength={160} value={form.title} disabled={!!busy} onChange={event => update('title', event.target.value)} placeholder={isPhoto ? 'For example, A quiet city at sunrise' : 'Give your film a working title'} /></label>
        <label className="office-ai-field">{isPhoto ? 'Describe your photo' : 'What is your story?'}<textarea aria-label={isPhoto ? 'Describe your photo' : 'What is your story?'} required maxLength={12000} rows={4} value={form.prompt} disabled={!!busy} onChange={event => update('prompt', event.target.value)} placeholder={isPhoto ? 'Describe the subject, setting, lighting, mood, and camera style…' : 'Describe the world, story, visual style, and what you want the audience to feel…'} /></label>
        {!isPhoto && <div className="studio-runtime"><label className="office-ai-field">Requested runtime<input type="number" required min={form.unit === 'seconds' ? 4 : undefined} step="any" inputMode="decimal" value={form.duration} disabled={!!busy} onChange={event => update('duration', event.target.value)} /></label><label className="office-ai-field">Unit<select aria-label="Runtime unit" value={form.unit} disabled={!!busy} onChange={event => update('unit', event.target.value)}><option value="seconds">Seconds</option><option value="minutes">Minutes</option><option value="hours">Hours</option></select></label><p>Choose your total length. Longer stories continue in saved chapters of up to {durationLabel(capabilities?.chapterSeconds || 120)} each.</p></div>}
        <label className="office-ai-field">Creative freedom<select aria-label="Studio creative freedom" value={form.creativity} disabled={!!busy} onChange={event => update('creativity', event.target.value)}><option value="strict">Follow my brief closely</option><option value="balanced">Fill in the creative gaps</option><option value="creative">Explore and surprise me</option></select></label><p className="studio-help">Pip can choose missing creative details. Your brief and character descriptions remain the guide.</p>
        <details className="studio-production" open={form.kind === 'movie' ? true : undefined}><summary><Clapperboard size={16} />Production team and direction</summary><label className="office-ai-field">Producer’s brief<textarea maxLength={4000} rows={3} value={form.brief} disabled={!!busy} onChange={event => update('brief', event.target.value)} placeholder="Audience, tone, pacing, visual language, and anything every scene should respect…" /></label><fieldset><legend>Creative roles</legend><p>These roles guide the production brief.</p><div className="studio-role-options">{ROLES.map(role => <label key={role}><input type="checkbox" checked={form.roles.includes(role)} disabled={!!busy} onChange={event => update('roles', event.target.checked ? [...form.roles, role] : form.roles.filter(item => item !== role))} />{role}</label>)}</div></fieldset></details>
        <details className="studio-production" open={form.characters.length > 0 ? true : undefined}><summary><Users size={16} />Your cast <span>{form.characters.length ? `${form.characters.length} characters` : 'Optional'}</span></summary><p className="studio-help">Create original characters. Their names, appearance, personality, and voice travel with every chapter.</p><div className="studio-cast">{form.characters.map((item, index) => <fieldset key={index}><legend>Character {index + 1}</legend><div className="studio-character-heading"><label className="office-ai-field">Character name<input required maxLength={100} value={item.name} disabled={!!busy} onChange={event => updateCharacter(index, 'name', event.target.value)} placeholder="An original character name" /></label><button type="button" disabled={!!busy} onClick={() => update('characters', form.characters.filter((_, position) => position !== index))} aria-label={`Remove character ${item.name || index + 1}`}><Trash2 size={15} /></button></div><label className="office-ai-field">Appearance<textarea required maxLength={1800} rows={2} value={item.appearance} disabled={!!busy} onChange={event => updateCharacter(index, 'appearance', event.target.value)} placeholder="Recognizable features, clothing, colors, and other consistent details" /></label><div className="studio-character-traits"><label className="office-ai-field">Personality<input maxLength={1000} value={item.personality} disabled={!!busy} onChange={event => updateCharacter(index, 'personality', event.target.value)} placeholder="Motivation and mannerisms" /></label><label className="office-ai-field">Voice<input maxLength={1000} value={item.voice} disabled={!!busy} onChange={event => updateCharacter(index, 'voice', event.target.value)} placeholder="Delivery and speaking style" /></label></div></fieldset>)}</div><button type="button" disabled={!!busy || form.characters.length >= 20} onClick={() => update('characters', [...form.characters, character()])}><Plus size={14} />Add character</button></details>
        <div className="studio-create"><p>Save your production plan first. Generation uses provider credits. Prompts go to connected media providers; anyone with a generated media link can open it.</p><button className="office-ai-primary" type="submit" disabled={loading || !!busy || !capabilities || !form.title.trim() || !form.prompt.trim()}>{busy === 'create' ? 'Saving project…' : 'Create project'}<ArrowRight size={15} /></button></div>
      </form>
      {project && <article className="studio-project" aria-label="Selected production"><div className="studio-card-title"><div><span>02 / YOUR PRODUCTION</span><h3>{project.title}</h3></div><span className="studio-status" data-status={project.status}>{STATUSES[project.status] || project.status}</span></div>
        <p className="studio-project-prompt">{project.prompt}</p>
        {photo && <div className="studio-photo"><img src={mediaUrl(photo.url, true)} alt={project.prompt} /></div>}
        {!projectPhoto && <FilmPlayer project={project} />}
        {!projectPhoto && <div className="studio-progress"><div><strong>{durationLabel(project.completedSeconds || 0)} generated</strong><span>{durationLabel(project.durationSeconds)} requested</span></div><progress max="100" value={progress} aria-label="Generated movie duration" /><p>{project.status === 'generating' ? 'Rendering the current chapter. You can leave and return to check its progress.' : project.status === 'ready' ? 'Your production is ready. Play the chapters here or open the media files below.' : 'Generate one chapter at a time. Your project, cast, and completed chapters stay saved.'}</p></div>}
        {project.error && <p className="office-ai-error" role="alert">{cleanError(project.error)}</p>}
        <div className="studio-project-actions">{['cancelled', 'failed'].includes(project.status) ? <button type="button" disabled={!!busy} onClick={() => action('resume')}><Play size={14} />{project.status === 'failed' ? 'Prepare retry' : 'Resume project'}</button> : project.status !== 'ready' && <button type="button" className="office-ai-primary" disabled={!!busy || !renderAvailable || project.status === 'generating' || project.status === 'needs_review'} onClick={() => action('generate')}><Sparkles size={15} />{busy === 'generate' ? 'Starting generation…' : project.status === 'failed' ? 'Retry generation' : projectPhoto ? 'Generate photo' : 'Generate next chapter'}</button>}{!['ready', 'cancelled'].includes(project.status) && <button type="button" disabled={!!busy} onClick={() => action('cancel')}><Square size={13} />Stop project</button>}<button type="button" disabled={!!busy} onClick={() => open(project.id)}><RefreshCw size={14} />Refresh project</button><button type="button" disabled={!!busy} onClick={exportProject}><Download size={14} />Export production plan</button></div>
        {!projectPhoto && project.status === 'ready' && project.chapterCount > 1 && !project.assembly?.complete && <div className="studio-assembly"><button type="button" disabled={!!busy || !renderAvailable} onClick={() => action('assemble')}><Film size={15} />{project.assembly?.coveredChapters ? 'Assemble next stage' : 'Assemble full movie'}</button><p>Combine completed chapters into one MP4. Long films assemble in stages using provider credits.</p></div>}{project.assembly && <p className="studio-help">Movie assembly: {project.assembly.coveredChapters || 0} of {project.assembly.totalChapters || project.chapterCount} chapters {project.assembly.complete ? 'combined into one MP4.' : project.assembly.status === 'completed' ? 'combined. Continue assembling the remaining chapters.' : 'in this stage.'}</p>}{project.nextChapterOffset != null && <button type="button" disabled={!!busy} onClick={loadChapters}><Plus size={14} />Load more chapters</button>}{!renderAvailable && <p className="studio-connection-note">This project is saved. Its media provider needs to be connected before generation can start.</p>}
        <details className="studio-project-details"><summary>Production brief and cast</summary><p>{project.producer?.brief || 'Use the story brief to guide this production.'}</p><div className="studio-tags">{project.producer?.roles?.map(role => <span key={role}>{role}</span>)}</div>{project.characters?.map((item, index) => <div className="studio-saved-character" key={index}><strong>{item.name}</strong><p>{item.appearance}</p>{item.personality && <p>Personality: {item.personality}</p>}{item.voice && <p>Voice: {item.voice}</p>}</div>)}</details>
        {!!artifacts.length && <div className="studio-artifacts"><h4>Generated media</h4>{artifacts.map((item, index) => <a key={item.id || index} href={mediaUrl(item.url, item.kind === 'image')} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" download={item.filename || undefined}><span>{item.kind === 'image' ? <Image size={16} /> : <Film size={16} />}<strong>{item.filename || `${item.kind === 'image' ? 'Photo' : 'Chapter'} ${index + 1}`}</strong>{item.durationSeconds && <small>{durationLabel(item.durationSeconds)}</small>}</span><Download size={15} /><span className="office-ai-sr-only">Open or download</span></a>)}</div>}
        {!!project.chapters?.length && <details className="studio-project-details"><summary>Chapter progress ({project.chapters.length})</summary><ol className="studio-chapter-log">{project.chapters.map((chapter, index) => <li key={chapter.id || index}><strong>Chapter {index + 1}</strong><span>{durationLabel(chapter.durationSeconds)}</span><span>{STATUSES[chapter.status] || chapter.status}</span>{chapter.error && <p>{cleanError(chapter.error)}</p>}</li>)}</ol></details>}
      </article>}
    </div><aside className="studio-sidebar"><section className="studio-library"><div className="studio-card-title"><div><span>YOUR LIBRARY</span><h3>Saved projects</h3></div><span>{projects.length}</span></div>{loading && <p role="status">Loading your Studio…</p>}{!loading && !projects.length && <div className="studio-library-empty"><Clapperboard size={31} /><strong>Your next story starts here.</strong><p>Saved projects appear here so you can pick up where you left off.</p></div>}<div className="studio-project-list">{projects.map(item => <button type="button" key={item.id} disabled={!!busy} aria-pressed={project?.id === item.id} onClick={() => open(item.id)}><span className="studio-project-icon">{item.kind === 'photo' ? <Camera size={19} /> : item.kind === 'movie' ? <Clapperboard size={19} /> : <Film size={19} />}</span><span><strong>{item.title}</strong><small>{STATUSES[item.status] || item.status} · {dateLabel(item.updatedAt || item.createdAt)}</small>{item.kind !== 'photo' && <small>{durationLabel(item.completedSeconds || 0)} / {durationLabel(item.durationSeconds)}</small>}</span></button>)}</div>{nextProjectOffset != null && <button type="button" disabled={!!busy} onClick={loadProjects}><Plus size={14} />Load more projects</button>}</section><section className="studio-how"><Sparkles size={21} /><h3>Room for imagination.</h3><p>Give Pip a clear direction or leave room for creative choices. A shared cast and producer’s brief help each chapter belong to the same story.</p><p>{capabilities?.note || 'A long film is built in bounded chapters. Provider availability, processing time, and credits determine how much can render at once.'}</p><p>Video chapters use generated images and narration. Exact character likeness and voice consistency depend on the provider.</p></section></aside></div>
    </div>
  </section>;
}
