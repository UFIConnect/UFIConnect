import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, Bot, Brain, Check, ChevronRight, Clapperboard, ClipboardList, Code2, Globe2, Link2, List, Map as MapIcon, MessageSquare, Plus, RefreshCw, Send, SlidersHorizontal, Square, Trash2, Wrench } from 'lucide-react';
import Controls from './Controls';
import OfficeConnections from './OfficeConnections';
import OfficeCommandMap from './OfficeCommandMap';
import OfficeAIContent from './OfficeAIContent';
import OfficeAITasks from './OfficeAITasks';
import OfficeAIMemory from './OfficeAIMemory';
import OfficeAIFunctions from './OfficeAIFunctions';
import OfficeAIActivity from './OfficeAIActivity';
import OfficeAITerminal from './OfficeAITerminal';
import OfficeAIStudio from './OfficeAIStudio';
import { OfficeAITaskRun, FINISHED_TASKS } from './OfficeAITaskDetail';
import OfficeAITaskScope, { DEFAULT_TASK_PERMISSIONS, DEFAULT_TASK_TARGETS } from './OfficeAITaskScope';
import useOfficeAIConversations from './useOfficeAIConversations';
import OfficeAISensors from './OfficeAISensors';
import PipCharacter from './PipCharacter';
import { PIP_TONES, loadPipTone, savePipTone, getPipTone } from './pip-tones.mjs';
import { OFFICE_SECTIONS } from './OfficeNavigation';
import { officeTaskContext } from './pip-office-context.mjs';
import { MAX_ATTACHMENTS, readOfficeAttachment } from './office-attachments.mjs';
import { isAgentQuestion, isExecutionRequest, needsToolSupport } from './office-ai-intent.mjs';
import { officeAIHistory } from './office-ai-history.mjs';
import './OfficeAI.css';

const STARTERS = [
  { title: 'Create a photo or movie', detail: 'Bring an idea to life with your own cast', studio: true },
  { title: 'Fix my website', detail: 'Describe the issue and get a checked, deployed fix', message: 'Fix an issue on the UFIConnect website and deploy the fix. Ask me which issue to fix.' },
  { title: 'Improve Pip', detail: 'Update this assistant and see the result here', message: 'Improve uficonnect.ai and deploy the update. Ask me what I want to change.' },
  { title: 'Catch up on AI', detail: 'Research the latest updates with sources', message: 'Research the latest important AI updates. Compare practical capabilities, limitations, and costs. Include dated primary sources.' },
];
const BLANK_TOOL = { name: '', description: '', kind: 'prompt', instructions: '', controlId: '' };
const TABS = [['conversation', 'Conversation', MessageSquare], ['studio', 'Photo & movie studio', Clapperboard], ['tasks', 'Tasks', ClipboardList], ['upgrades', 'Upgrade Pip', Wrench], ['commands', 'Office controls', SlidersHorizontal], ['memory', 'Memory', Brain], ['activity', 'Activity', Globe2], ['terminal', 'Terminal', Square], ['functions', 'Functions', Code2], ['tools', 'My tools', Wrench], ['connections', 'Connections', Link2]];
const studioRequest = message => {
  const match = message.trim().match(/^(?:please\s+)?(?:generate|create|make|draw|render)\s+(?:(?:me|us)\s+)?(?:(?:an?|the|some)\s+)?(?:original\s+)?(photo(?:graph)?|image|picture|video|movie|film)\s+(?:of|about|showing|featuring|with)\s+([\s\S]+)$/i);
  return match ? { kind: /^(?:movie|film)$/i.test(match[1]) ? 'movie' : /^video$/i.test(match[1]) ? 'video' : 'photo', prompt: message.trim(), title: match[2].replace(/\s+/g, ' ').slice(0, 100) } : null;
};
const SOURCE_NAMES = { notion: 'Notion', slack: 'Slack', linear: 'Linear' };
const SOURCE_STATUS = { retrieved: 'Sources retrieved', empty: 'No matching sources', unavailable: 'Source unavailable', 'not-connected': 'Not connected' };
const sourceUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
};
const dateLabel = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
const cleanError = value => String(value || '').replace(/\bBearer\s+\S+/gi, '[credential omitted]')
  .replace(/\b(?:sk-[a-zA-Z0-9_-]+|[a-z_]*(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+)/gi, '[credential omitted]').slice(0, 400);
const messageWithFiles = (message, files) => `${message}${files.length ? `\n\nAttached files: ${files.map(file => file.name.replace(/[\u0000-\u001f]/g, ' ').slice(0, 150)).join(', ')}` : ''}`;

async function payload(response) {
  let data;
  try { data = await response.json(); } catch { throw Error('Pip returned an unreadable response. Please retry.'); }
  if (!response.ok) {
    if (response.status === 401) throw Error('Office access is unavailable. Reconnect to Office and retry.');
    if (response.status === 404) throw Error('Pip is unavailable on this service version. Refresh after the service update.');
    if (response.status === 429) throw Error('Pip is busy. Wait briefly and try again.');
    throw Error(typeof data?.error === 'string' ? cleanError(data.error) : `Pip could not complete this request (${response.status}). Please retry.`);
  }
  return data;
}

function researchLabel(research) {
  if (research?.status === 'pages') return 'Requested web pages retrieved';
  if (research?.status === 'verified') return 'Web sources retrieved';
  if (research?.status === 'official-updates') return 'Official AI announcements retrieved';
  if (research?.status === 'empty') return 'No web sources found';
  if (research?.status === 'unavailable') return 'Web research unavailable';
  return 'Web research off';
}

function Source({ source }) {
  const url = sourceUrl(source.url), hostname = new URL(url).hostname;
  const publisher = typeof source.publisher === 'string' ? source.publisher.slice(0, 100) : '';
  const publishedAt = typeof source.publishedAt === 'string' && dateLabel(source.publishedAt) ? source.publishedAt : null;
  return <li><a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><span>{typeof source.title === 'string' && source.title ? source.title : hostname}</span><ArrowUpRight size={14} /></a><small>{hostname}</small>{(publisher || publishedAt) && <small>{publisher}{publisher && publishedAt ? ' · ' : ''}{publishedAt && <>Published <time dateTime={publishedAt}>{dateLabel(publishedAt)}</time></>}</small>}</li>;
}

function Answer({ message, onCommand, apiBase, request, onTaskUpdate, onOpenTerminal }) {
  const sources = (Array.isArray(message.sources) ? message.sources : []).filter(source => sourceUrl(source?.url));
  const connectedSources = (Array.isArray(message.connectedSources) ? message.connectedSources : []).filter(source => Object.hasOwn(SOURCE_NAMES, source?.id) && Object.hasOwn(SOURCE_STATUS, source?.status));
  const actions = []; // Office controls are reviewed in their separate workspace.
  return <article className={`office-ai-message office-ai-message-${message.role}`}>
    <div className="office-ai-message-author">{message.role === 'assistant' ? <><Bot size={17} /> Pip</> : 'You'}
      {message.role === 'assistant' && <span>{dateLabel(message.generatedAt)}</span>}
    </div>
    <div className="office-ai-answer">{message.role === 'assistant' ? <OfficeAIContent text={message.content} /> : message.content}</div>
    {!!message.attachments?.length && <ul className="office-ai-message-files" aria-label="Attached files">{message.attachments.map((file, index) => <li key={index}>{file.name}</li>)}</ul>}
    {message.role === 'assistant' && !message.taskId && <>
      <div className="office-ai-answer-meta"><Globe2 size={13} /><span>{researchLabel(message.research)}</span>{message.model && <span>{message.model}</span>}</div>
      {!!connectedSources.length && <ul className="office-ai-source-results" aria-label="Connected source results">{connectedSources.map(source => <li key={source.id}><Link2 size={12} /><span><strong>{SOURCE_NAMES[source.id]}</strong> · {SOURCE_STATUS[source.status]}{source.status === 'retrieved' && Number.isInteger(source.count) && source.count > 0 ? ` (${source.count})` : ''}{typeof source.note === 'string' && <small>{cleanError(source.note)}</small>}</span></li>)}</ul>}
      {['unavailable', 'empty'].includes(message.research?.status) && <p className="office-ai-research-note">Current information could not be verified for this reply. Check primary sources before relying on recent claims.</p>}
      {message.research?.status === 'official-updates' && <p className="office-ai-research-note">Official announcement feeds were checked. Broader web research is unavailable for this reply.</p>}
      {message.memory?.status === 'unavailable' && <p className="office-ai-research-note">Memory could not be retrieved for this answer.</p>}
      {!!message.memory?.entries?.length && <details className="office-ai-sources"><summary>Memory used for this reply</summary><ol>{message.memory.entries.map(entry => <li key={entry.id}><strong>{entry.title || 'Office memory'}</strong><small>{dateLabel(entry.createdAt)} · {entry.kind} · {entry.status || 'recorded'}</small><small>Original record: {entry.referenceId || entry.id}</small></li>)}</ol></details>}
      {!!sources.length && <details className="office-ai-sources" open><summary>{sources.length} sources · retrieved {dateLabel(message.research?.checkedAt || message.generatedAt)}</summary><ol>{sources.map((source, index) => <Source key={`${source.url}-${index}`} source={source} />)}</ol></details>}
      {!!actions.length && <div className="office-ai-actions" aria-label="Suggested Office commands">{actions.map(action => <button key={action.id} type="button" onClick={() => onCommand(action.id)}><SlidersHorizontal size={16} /><span><strong>{action.label}</strong><small>Review in Office commands</small></span><ChevronRight size={16} /></button>)}</div>}
    </>}
    {message.role === 'assistant' && message.taskId && <OfficeAITaskRun taskId={message.taskId} apiBase={apiBase} request={request} onUpdate={onTaskUpdate} onOpenTerminal={onOpenTerminal} />}
  </article>;
}

export default function OfficeAI({ apiBase = '', pipelineBase = '', request = fetch, onNavigate = () => {}, welcomeBriefing, onWelcomeConsumed, compact = false, callOnly = false, active = true, onActivityChange, onCallOpenChange, onContinueWithText, following = false, onFollowingChange = () => {}, officeSection, officeContext }) {
  const [tone, setTone] = useState(() => loadPipTone()), [sensorState, setSensorState] = useState({ phase: 'idle' });
  const sensorPhase = sensorState.phase;
  const pipState = busyState();
  function busyState() { return sensorPhase === 'working' ? 'thinking' : ['listening', 'speaking'].includes(sensorPhase) ? sensorPhase : 'idle'; }
  function chooseTone(value) { setTone(savePipTone(value)); }
  const toneControl = <label className="office-ai-tone-control"><span>Tone</span><select aria-label="Pip tone" value={tone} onChange={event => chooseTone(event.target.value)}>{PIP_TONES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select><small>{getPipTone(tone).description}</small></label>;
  const [tab, setTab] = useState('conversation'), [revision, setRevision] = useState(0), [settingsOpen, setSettingsOpen] = useState(false);
  const [connection, setConnection] = useState(null), [loading, setLoading] = useState(true), [connectionError, setConnectionError] = useState('');
  const [tools, setTools] = useState([]), [toolsError, setToolsError] = useState(''), [controls, setControls] = useState([]), [controlsError, setControlsError] = useState('');
  const [selectedTools, setSelectedTools] = useState([]), [toolForm, setToolForm] = useState(BLANK_TOOL), [toolBusy, setToolBusy] = useState(false), [toolNotice, setToolNotice] = useState('');
  const [draft, setDraft] = useState(''), [messages, setMessages] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [research, setResearch] = useState(true), [perspective, setPerspective] = useState('balanced'), [commandQuery, setCommandQuery] = useState('');
  const [creativity, setCreativity] = useState('balanced'), [studioOpened, setStudioOpened] = useState(false), [studioSeed, setStudioSeed] = useState(null);
  function openStudio(seed) { setStudioOpened(true); if (seed) setStudioSeed({ ...seed, id: crypto.randomUUID() }); setTab('studio'); }
  const [sourceConnections, setSourceConnections] = useState([]), [sourcesError, setSourcesError] = useState(''), [selectedSources, setSelectedSources] = useState([]);
  const [commandView, setCommandView] = useState('map');
  const commandMapRef = useRef(null), commandReviewRef = useRef(null), tabsRef = useRef(null);
  const [mode, setMode] = useState('ask'), [deleteChat, setDeleteChat] = useState(null);
  const [remember, setRemember] = useState(true), [tasksOpened, setTasksOpened] = useState(false), [upgradesOpened, setUpgradesOpened] = useState(false);
  const [permissions,setPermissions] = useState({ ...DEFAULT_TASK_PERMISSIONS }), [targets,setTargets] = useState([...DEFAULT_TASK_TARGETS]), [taskCapabilities,setTaskCapabilities] = useState(null), [executionError,setExecutionError] = useState('');
  const [taskStates,setTaskStates] = useState({}), [selectedTerminalId,setSelectedTerminalId] = useState(null);
  const [attachments, setAttachments] = useState([]), [attachmentBusy, setAttachmentBusy] = useState(false);
  const sensors = useRef(null), voiceTasks = useRef(new Map()), latestTasks = useRef(new Map()), attachmentEpoch = useRef(0);
  const taskSubmission = useRef(null);
  const mounted = useRef(false), generation = useRef(0), chatSequence = useRef(0), pending = useRef(null), requests = useRef(new Set()), saving = useRef(false), transcript = useRef(null), composer = useRef(null);
  const conversations = useOfficeAIConversations({ apiBase, request, messages, setMessages, beforeLoad: () => { stop(); sensors.current?.stop(); attachmentEpoch.current++; setAttachments([]); setDraft(''); taskSubmission.current = null; setTaskStates({}); } });
  useEffect(() => { onActivityChange?.({ ...sensorState, phase: busy && !['speaking', 'listening'].includes(sensorState.phase) ? 'thinking' : pipState, tone }); }, [busy, pipState, sensorState, tone, onActivityChange]);
  useEffect(() => { if (compact) { setTab('conversation'); setMode('ask'); } }, [compact]);
  const latestTaskId = messages.findLast(message => message.taskId)?.taskId;
  const taskActive = !!latestTaskId && !FINISHED_TASKS.has(taskStates[latestTaskId]);

  useEffect(() => {
    mounted.current = true;
    const reset = () => {
      attachmentEpoch.current++; setAttachments([]); setAttachmentBusy(false); voiceTasks.current.forEach(waiter => { clearTimeout(waiter.timer); waiter.resolve('Office access changed. Start voice again after signing in.'); }); voiceTasks.current.clear(); latestTasks.current.clear();
      generation.current++; chatSequence.current++; requests.current.forEach(controller => controller.abort()); requests.current.clear();
      pending.current = null; saving.current = false;
      setSourceConnections([]); setSelectedSources([]); setSourcesError(''); setCommandView('map');
      setDeleteChat(null); setMode('ask'); setRemember(true); setTab('conversation'); taskSubmission.current = null; setTaskStates({}); setSelectedTerminalId(null); setTaskCapabilities(null); setExecutionError(''); setPermissions({ ...DEFAULT_TASK_PERMISSIONS }); setTargets([...DEFAULT_TASK_TARGETS]);
      setCreativity('balanced'); setStudioOpened(false); setStudioSeed(null);
      setMessages([]); setDraft(''); setBusy(false); setError(''); setToolBusy(false); setToolNotice(''); setSelectedTools([]); setToolForm(BLANK_TOOL); setTools([]); setControls([]); setConnection(null); setCommandQuery(''); setRevision(value => value + 1);
    };
    window.addEventListener('office-token-changed', reset);
    return () => { mounted.current = false; attachmentEpoch.current++; generation.current++; chatSequence.current++; requests.current.forEach(controller => controller.abort()); voiceTasks.current.forEach(waiter => { clearTimeout(waiter.timer); waiter.resolve('Voice ended. Your task remains available in Office.'); }); voiceTasks.current.clear(); window.removeEventListener('office-token-changed', reset); };
  }, []);

  useEffect(() => {
    const controller = new AbortController(), current = generation.current;
    let active = true;
    requests.current.add(controller); setLoading(true); setConnectionError(''); setToolsError(''); setControlsError(''); setSourcesError('');
    const valid = () => active && mounted.current && current === generation.current;
    const timeout = setTimeout(() => controller.abort(), 20000);
    Promise.allSettled([
      request(`${apiBase}/office/ai`, { signal: controller.signal }).then(payload).then(data => {
        if (typeof data?.configured !== 'boolean' || data.provider !== 'Cloudflare') throw Error('Pip connection details are unavailable.');
        if (valid()) setConnection(data);
      }).catch(cause => { if (valid()) { setConnection(null); setConnectionError(cause.name === 'AbortError' ? 'Connection check timed out. Retry the connection.' : cause.message); } }),
      request(`${apiBase}/office/ai/tools`, { signal: controller.signal }).then(payload).then(data => {
        if (!Array.isArray(data.tools)) throw Error('Tool library is unavailable.');
        const list = data.tools.filter(tool => typeof tool?.id === 'string' && typeof tool.name === 'string' && ['prompt', 'office-command'].includes(tool.kind));
        if (valid()) { setTools(list); setSelectedTools(previous => previous.filter(id => list.some(tool => tool.id === id))); }
      }).catch(cause => { if (valid()) { setTools([]); setSelectedTools([]); setToolsError(cause.name === 'AbortError' ? 'Tool library check timed out. Retry to load saved tools.' : cause.message); } }),
      request(`${apiBase}/office/controls`, { signal: controller.signal, ...(revision > 0 ? { cache: 'reload' } : {}) }).then(payload).then(data => {
        if (valid()) setControls(Array.isArray(data.controls) ? data.controls : []);
      }).catch(cause => { if (valid()) { setControls([]); setControlsError(cause.name === 'AbortError' ? 'Command list check timed out. Retry to load commands.' : cause.message); } }),
      request(`${apiBase}/office/ai/tasks?summary=1`, { signal: controller.signal }).then(payload).then(data => {
        if (valid()) { setTaskCapabilities(data.capabilities || {}); setExecutionError(''); }
      }).catch(cause => { if (valid()) { setTaskCapabilities(null); setExecutionError(cause.name === 'AbortError' ? 'Task connection check timed out. Refresh the AI connection.' : cause.message); } }),
      request(`${apiBase}/office/connections`, { signal: controller.signal }).then(payload).then(data => {
        if (!Array.isArray(data.connections)) throw Error('Connected sources are unavailable.');
        const list = data.connections.filter(item => item?.chatSource === true && Object.hasOwn(SOURCE_NAMES, item.id));
        if (valid()) { setSourceConnections(list); setSelectedSources(previous => previous.filter(id => list.some(item => item.id === id && item.configured))); }
      }).catch(cause => { if (valid()) { setSourceConnections([]); setSelectedSources([]); setSourcesError(cause.name === 'AbortError' ? 'Source check timed out. Refresh to retry.' : 'Connected sources could not be loaded. Refresh to retry.'); } }),
    ]).finally(() => { clearTimeout(timeout); requests.current.delete(controller); if (valid()) setLoading(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); requests.current.delete(controller); };
  }, [apiBase, request, revision]);

  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, busy]);
  useEffect(() => {
    const row = tabsRef.current, selected = row?.querySelector('[aria-pressed="true"]');
    if (!row || !selected) return;
    const bounds = row.getBoundingClientRect(), active = selected.getBoundingClientRect();
    if (active.left < bounds.left) row.scrollLeft -= bounds.left - active.left + 4;
    else if (active.right > bounds.right) row.scrollLeft += active.right - bounds.right + 4;
  }, [tab, settingsOpen]);
  useEffect(() => {
    if (tab === 'commands' && commandView === 'review') {
      commandReviewRef.current?.focus({ preventScroll: true });
      commandReviewRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [tab, commandView, commandQuery]);

  function stop(clear = false) {
    const active = pending.current;
    chatSequence.current++; active?.controller.abort(); pending.current = null; setBusy(false); setError('');
    if (clear) { setMessages([]); setDraft(''); }
    else if (active) { setMessages(previous => previous.filter(message => message.id !== active.id)); setDraft(active.message); if(active.kind === 'work') setError('Stopped waiting for the receipt. The task may still be running. Send the same request to recover its status without starting it twice.'); }
  }

  async function send(event, voiceInput, voiceFiles, voiceOptions = {}) {
    event.preventDefault(); const message = (voiceInput ?? draft).trim();
    if ((!message && !attachments.length) || pending.current || attachmentBusy || !connection?.configured || loading) return;
    let files;
    try { files = voiceFiles ?? attachmentsForTurn(); } catch (cause) { setError(cause.message); return; }
    const instruction = message || 'Describe and explain the attached files.';
    const media = !files.length && studioRequest(instruction);
    if (media) { openStudio(media); setDraft(''); setError(''); return 'I opened Studio with your idea. Review the production plan and choose Create project, then Generate when you are ready.'; }
    if (voiceInput === undefined && (isExecutionRequest(instruction) || needsToolSupport(instruction, files))) {
      if (taskActive) { setError('Your current task is still running. Follow its progress below or stop it before starting another change.'); return; }
      if (!taskCapabilities) { setError(executionError || 'The task connection is unavailable. Refresh the connection to retry.'); return; }
      return sendWork(instruction, files);
    }
    const history = officeAIHistory(messages);
    const controller = new AbortController(), current = generation.current, sequence = ++chatSequence.current, id = `user-${crypto.randomUUID()}`;
    const cancelVoice = () => controller.abort();
    voiceOptions.signal?.addEventListener('abort', cancelVoice, { once: true });
    if (voiceOptions.signal?.aborted) controller.abort();
    requests.current.add(controller); pending.current = { controller, message, id }; setBusy(true); setError(''); setDraft(''); setAttachments([]);
    setMessages(previous => [...previous, { role: 'user', content: messageWithFiles(instruction, files), id, attachments: files.map(({name,type}) => ({name,type})) }]);
    let timedOut = false;
    // Leave time for the backend's bounded 210-second research and inference
    // request to return a result or its own actionable timeout response.
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 220000);
    const valid = () => mounted.current && current === generation.current && sequence === chatSequence.current;
    try {
      const data = await payload(await request(`${apiBase}/office/ai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ mode: 'chat', memory: remember, creativity, ...(connection?.tonesAvailable === true ? { tone } : {}), ...(connection?.voiceConversationAvailable === true && voiceInput !== undefined ? { voice: true } : {}), ...(connection?.officeContextAvailable === true && following && officeContext ? { officeContext } : {}), message: instruction, history, research, perspective: voiceInput !== undefined ? 'concise' : perspective, toolIds: selectedTools.filter(id => tools.some(tool => tool.id === id && tool.kind === 'prompt')), ...(files.length ? {attachments: files} : {}), ...(mode === 'ask' && selectedSources.length ? { sourceIds: selectedSources } : {}) }) }));
      if (typeof data?.reply !== 'string' || !data.reply.trim()) throw Error('Pip returned an empty reply. Please retry.');
      if (valid()) setMessages(previous => [...previous, { ...data, role: 'assistant', content: data.reply, id: `assistant-${crypto.randomUUID()}` }]);
      return data.reply;
    } catch (cause) {
      if (valid()) { setMessages(previous => previous.filter(item => item.id !== id)); setDraft(message); setAttachments(files); setError(timedOut ? 'The response timed out. Your message is ready to retry.' : cause.name === 'AbortError' ? 'Request stopped. Your message is ready to retry.' : cause.name === 'TypeError' ? 'The connection ended before Pip could respond. Your message is ready to retry.' : cause.message); }
      if (voiceInput !== undefined) throw cause;
    } finally {
      clearTimeout(timeout); requests.current.delete(controller); voiceOptions.signal?.removeEventListener('abort', cancelVoice);
      if (valid()) { pending.current = null; setBusy(false); if (voiceInput === undefined) composer.current?.focus(); }
    }
  }

  async function sendWork(message, files = [], voiceRequest = false) {
    if (taskActive || !taskCapabilities || pending.current) { const message = 'A task is already running or the task connection is unavailable. Review the progress below.'; setError(message); if (voiceRequest) throw Error(message); return null; }
    const history = officeAIHistory(messages, { maxMessages: 24, maxCharacters: 48000 });
    const body = { message: officeTaskContext(message, following ? officeContext : null, OFFICE_SECTIONS), history, conversationId: conversations.identity(), target: 'full-access', memory: remember, creativity, permissions, deployTargets: targets, ...(taskCapabilities?.tonesAvailable === true ? { tone } : {}), ...(files.length ? { attachments: files } : {}) };
    const signature = JSON.stringify(body);
    if (!taskSubmission.current || taskSubmission.current.signature !== signature) taskSubmission.current = { signature, clientRequestId: crypto.randomUUID() };
    const controller = new AbortController(), current = generation.current, sequence = ++chatSequence.current, id = `user-${crypto.randomUUID()}`;
    requests.current.add(controller); pending.current = {controller,message,id,kind:'work'}; setBusy(true); setError(''); setDraft(''); setAttachments([]);
    setMessages(previous => [...previous,{role:'user',content:messageWithFiles(message, files),id,attachments:files.map(({name,type}) => ({name,type}))}]);
    const timeout = setTimeout(() => controller.abort(),25000), valid = () => mounted.current && generation.current === current && chatSequence.current === sequence;
    try {
      const data = await payload(await request(`${apiBase}/office/ai/tasks`,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...body,clientRequestId:taskSubmission.current.clientRequestId})}));
      if (!data.task?.id) throw Error('Office did not return a task receipt. Retry the same request to recover it.');
      if(valid()) {
        taskSubmission.current = null;
        setTaskStates(previous => ({...previous,[data.task.id]:data.task.status}));
        setMessages(previous => [...previous,{role:'assistant',content:data.task.summary || 'I’m working on your request. Follow the progress and results below.',taskId:data.task.id,generatedAt:data.task.createdAt || new Date().toISOString(),id:`assistant-${crypto.randomUUID()}`}]);
        latestTasks.current.set(data.task.id, data.task);
        return data.task;
      }
    } catch(cause) {
      if(valid()) { setMessages(previous => previous.filter(item => item.id !== id)); setDraft(message); setAttachments(files); setError(cause.name === 'AbortError' || cause.name === 'TypeError' ? 'The connection ended before the task receipt arrived. Retry this same request to recover its task without starting it twice.' : cause.message); }
      if (voiceRequest) throw cause;
    } finally {
      clearTimeout(timeout); requests.current.delete(controller);
      if(valid()) { pending.current = null; setBusy(false); composer.current?.focus(); }
    }
  }

  function updateTask(task) {
    latestTasks.current.set(task.id, task);
    if (voiceTasks.current.has(task.id) && (FINISHED_TASKS.has(task.status) || ['needs_confirmation','needs_continuation'].includes(task.status))) {
      const waiter = voiceTasks.current.get(task.id); voiceTasks.current.delete(task.id); clearTimeout(waiter.timer); waiter.resolve(taskVoiceReply(task));
    }
    setTaskStates(previous => previous[task.id] === task.status ? previous : {...previous,[task.id]:task.status});
    const content = task.summary || (task.status === 'cancelled' ? 'Task stopped. Completed actions and their receipts remain below.' : task.status === 'failed' ? 'The task could not finish. Review its error and completed steps below.' : null);
    if(content) setMessages(previous => previous.some(message => message.taskId === task.id && message.content !== content) ? previous.map(message => message.taskId === task.id ? {...message,content} : message) : previous);
  }
  function openTerminal(id) { setSelectedTerminalId(id); setTab('terminal'); }

  async function mutateTool(method, id) {
    if (saving.current) return;
    saving.current = true; setToolBusy(true); setToolNotice(''); setToolsError('');
    const controller = new AbortController(), current = generation.current; requests.current.add(controller);
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const body = { name: toolForm.name.trim(), description: toolForm.description.trim(), kind: toolForm.kind,
        ...(toolForm.kind === 'prompt' ? { instructions: toolForm.instructions.trim() } : { controlId: toolForm.controlId }) };
      await payload(await request(`${apiBase}/office/ai/tools${id ? `/${encodeURIComponent(id)}` : ''}`, { method, signal: controller.signal,
        ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }));
      if (mounted.current && current === generation.current) {
        if (method === 'POST') setToolForm(BLANK_TOOL);
        else { setTools(previous => previous.filter(tool => tool.id !== id)); setSelectedTools(previous => previous.filter(value => value !== id)); }
        setToolNotice(method === 'POST' ? 'Tool saved to your Office library.' : 'Tool removed from your Office library.'); setRevision(value => value + 1);
      }
    } catch (cause) { if (mounted.current && current === generation.current) setToolsError(cause.name === 'AbortError' ? 'The tool request timed out. Refresh the library to check whether it was saved.' : cause.message); }
    finally { clearTimeout(timeout); requests.current.delete(controller); if (mounted.current && current === generation.current) { saving.current = false; setToolBusy(false); } }
  }

  function chooseCommand(id = '') { setCommandQuery(id); setCommandView(id ? 'review' : 'map'); setTab('commands'); }
  function returnToMap() {
    setCommandView('map');
    window.requestAnimationFrame(() => {
      const target = [...(commandMapRef.current?.querySelectorAll('[data-control-id]') || [])].find(item => item.getAttribute('data-control-id') === commandQuery)
        || commandMapRef.current?.querySelector('input[type="search"]');
      target?.focus({ preventScroll: true }); target?.scrollIntoView({ block: 'nearest' });
    });
  }
  function toggleTool(id) { if (!tools.some(tool => tool.id === id && tool.kind === 'prompt')) return; setSelectedTools(previous => previous.includes(id) ? previous.filter(value => value !== id) : previous.length < 8 ? [...previous, id] : previous); }
  function starter(item) { if (item.studio) { openStudio(); return; } setDraft(item.message); setResearch(true); composer.current?.focus(); }
  function confirmDiscard() { return !conversations.error || !messages.length || window.confirm('Some conversation changes have not been saved. Discard those unsaved changes and continue?'); }
  function newChat() { if (confirmDiscard()) conversations.newConversation(); }
  function openChat(id) { if (confirmDiscard()) conversations.open(id); }

  function attachmentsForTurn(frame = sensors.current?.snapshot()) {
    const files = [...attachments, ...(frame ? [frame] : [])];
    if (files.length > MAX_ATTACHMENTS) throw Error('Choose up to four attachments per message. With the camera on, leave one space for its current frame.');
    return files;
  }
  async function attach(files) {
    const current = generation.current, epoch = ++attachmentEpoch.current;
    if (files.length + attachments.length > MAX_ATTACHMENTS) throw Error('Choose up to four files or photos per message.');
    setAttachmentBusy(true); setError('');
    try {
      const prepared = await Promise.all(files.map(file => readOfficeAttachment(file)));
      if (!mounted.current || current !== generation.current || epoch !== attachmentEpoch.current) return;
      setAttachments(previous => [...previous, ...prepared].slice(0, MAX_ATTACHMENTS));
    } finally { if (mounted.current && current === generation.current && epoch === attachmentEpoch.current) setAttachmentBusy(false); }
  }
  function taskVoiceReply(task) {
    if (task.status === 'needs_confirmation') return `${task.confirmation?.label || 'This task needs confirmation.'} ${task.confirmation?.detail || ''} Review the action in Work. Say confirm this action to approve it, or stop task to cancel.`;
    if (task.status === 'needs_continuation') return `${task.continuation?.message || 'The task reached a saved checkpoint.'} Say continue task to continue, or stop task to cancel.`;
    return task.summary || (task.status === 'succeeded' ? 'Your task completed. The results are in Work. What else do you need?' : task.status === 'cancelled' ? 'Your task stopped. Completed actions remain in its receipt. What else do you need?' : `The task could not finish. ${task.error || 'Review its receipt in Work.'}`);
  }
  function waitForVoiceTask(task, options = {}) {
    if (FINISHED_TASKS.has(task.status) || ['needs_confirmation','needs_continuation'].includes(task.status)) return Promise.resolve(taskVoiceReply(task));
    return new Promise(resolve => {
      const finish = value => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); if (voiceTasks.current.get(task.id)?.resolve === finish) voiceTasks.current.delete(task.id); resolve(value); };
      const abort = () => finish('');
      const timer = setTimeout(() => finish('Your task is still working. You can follow its progress in Work, or ask me for its status.'), 600000);
      voiceTasks.current.set(task.id, { resolve: finish, timer });
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }
  async function voiceMessage(message, frame, options = {}) {
    if (options.signal?.aborted) return '';
    const media = studioRequest(message);
    if (media && !frame) { openStudio(media); return 'I opened Studio with your idea. Review the production plan, choose Create project, and then Generate when you are ready.'; }
    setTab('conversation'); setMode('ask');
    if (pending.current || conversations.loading || attachmentBusy) return 'Office is finishing the current request. Please wait, then tell me what you need.';
    const currentTask = latestTaskId && latestTasks.current.get(latestTaskId);
    if (currentTask && !FINISHED_TASKS.has(currentTask.status)) {
      const normalized = message.toLowerCase().replace(/[.!?]+$/g, '').trim();
      let suffix, body;
      if (normalized === 'stop task' || normalized === 'cancel task') { suffix = 'cancel'; body = {}; }
      else if (currentTask.status === 'needs_confirmation' && !currentTask.confirmation?.uncertain && /^(?:confirm(?: this action)?|approve this action)$/.test(normalized)) { suffix = 'confirm'; body = { confirmationId: currentTask.confirmation.id, confirmed: true }; }
      else if (currentTask.status === 'needs_continuation' && /^(?:continue task|continue the task|resume task)$/.test(normalized)) { suffix = 'resume'; body = { continuationId: currentTask.continuation.id, confirmed: true }; }
      if (!suffix) return ['needs_confirmation','needs_continuation'].includes(currentTask.status) ? taskVoiceReply(currentTask) : `${currentTask.summary || 'Your task is still working.'} Follow its progress in Work, or say stop task to cancel.`;
      const controller = new AbortController(), current = generation.current;
      const cancelVoice = () => controller.abort(); options.signal?.addEventListener('abort', cancelVoice, { once: true });
      if (options.signal?.aborted) controller.abort();
      requests.current.add(controller); const timeout = setTimeout(() => controller.abort(), 25000);
      try {
        const data = await payload(await request(`${apiBase}/office/ai/tasks/${encodeURIComponent(currentTask.id)}/${suffix}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify(body) }));
        if (!data.task?.id) throw Error('The task update could not be verified. Check its receipt in Work.');
        if (!mounted.current || generation.current !== current || options.signal?.aborted) return '';
        updateTask(data.task); return waitForVoiceTask(data.task, options);
      } finally { clearTimeout(timeout); requests.current.delete(controller); options.signal?.removeEventListener('abort', cancelVoice); }
    }
    if (isAgentQuestion(message) && !needsToolSupport(message)) {
      if (!connection?.configured || loading) throw Error('Pip is not connected yet. Refresh the connection and try again.');
      return await send({ preventDefault() {} }, message, attachmentsForTurn(frame), options);
    }
    if (!connection?.configured || loading || !taskCapabilities) throw Error('Work is not connected yet. Refresh the Pip connection and start voice again.');
    const task = await sendWork(message, attachmentsForTurn(frame), true);
    if (!task) throw Error('The task did not start. Review Work and retry.');
    return waitForVoiceTask(latestTasks.current.get(task.id) || task, options);
  }

  return <section className="office-ai" data-compact={compact} data-call-only={callOnly} data-settings-open={settingsOpen} aria-labelledby="office-ai-title">
    {callOnly && (loading || conversations.loading) && <p role="status">Starting call…</p>}
    <header className="office-ai-header"><div className="office-ai-identity"><div className="office-ai-mark"><PipCharacter state={busy ? 'thinking' : pipState} speech={sensorState} tone={tone} size={50} decorative /></div><div><p className="office-ai-eyebrow">UFICONNECT · OFFICIAL OFFICE ASSISTANT</p><h1 id="office-ai-title">Pip</h1><p>Ask for a change. Follow the work. See the result.</p></div></div><div className="office-ai-connection"><span data-ready={!!connection?.configured}>{loading ? 'Checking connection…' : connection?.configured ? 'Cloudflare configured' : 'Connection needs attention'}</span><button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading || toolBusy} aria-label="Refresh Pip connection"><RefreshCw size={15} /></button></div></header>
    {compact && <div className="office-ai-quick-options">{toneControl}</div>}
    <div className="office-ai-simple-nav"><button type="button" className="office-ai-open-studio" aria-pressed={tab === 'studio'} onClick={() => openStudio()}><Clapperboard size={15} />Photo & movie studio</button><button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(value => !value)}><SlidersHorizontal size={15} />{settingsOpen ? 'Close settings' : 'Settings & history'}</button>{tab !== 'conversation' && <button type="button" onClick={() => setTab('conversation')}><MessageSquare size={15} />Back to chat</button>}</div>
    <nav ref={tabsRef} className="office-ai-tabs" aria-label="Pip sections">{TABS.map(([id, label, Icon]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => { if (id === 'tasks') setTasksOpened(true); if (id === 'upgrades') setUpgradesOpened(true); if (id === 'studio') openStudio(); else if (id === 'commands') chooseCommand(); else setTab(id); }}><Icon size={16} />{label}{id === 'tools' && !!tools.length && <span>{tools.length}</span>}</button>)}</nav>
    {connectionError && <p className="office-ai-error" role="alert">{connectionError}</p>}
    {!loading && connection && !connection.configured && <div className="office-ai-setup" role="status"><strong>Connect your Cloudflare AI account</strong><p>Pip needs its server connection before it can answer. Your Office commands are available in the commands tab.</p>{Array.isArray(connection.missing) && connection.missing.length > 0 && <p>Missing settings: <code>{connection.missing.join(', ')}</code></p>}<button type="button" onClick={() => setTab('connections')}>Open connections <ArrowUpRight size={14} /></button></div>}
    {callOnly && !loading && !connection?.configured && <div className="office-ai-call-unavailable" role="status"><p>The call could not connect.</p><button type="button" onClick={() => onCallOpenChange?.(false)}>Close call</button><button type="button" onClick={onContinueWithText}>Continue with text</button></div>}

    <div hidden={tab !== 'conversation'}>

      <div hidden={!(['ask','work'].includes(mode))}>
      <div className="office-ai-workspace">
        <div className="office-ai-chat">
          <div className="office-ai-chat-bar"><span><span className="office-ai-dot" />Private Office conversation</span><button type="button" onClick={newChat} disabled={conversations.saving || conversations.loading || (!messages.length && !draft && !busy)}><Plus size={14} />New chat</button></div>
          <div className="office-ai-save-state" role="status">{conversations.saving ? 'Saving conversation…' : conversations.error ? 'Conversation changes are not saved.' : conversations.savedAt ? 'Conversation saved in Office' : 'Chats save automatically in Office.'}</div>
          {conversations.error && <div className="office-ai-save-error"><p className="office-ai-error" role="alert">{conversations.error}</p>{conversations.conflict && conversations.currentId ? <button type="button" onClick={() => { if (window.confirm('Replace your current messages with the version saved in Office?')) conversations.open(conversations.currentId); }}>Reload saved conversation</button> : <button type="button" onClick={() => { conversations.refresh(); conversations.retry(); }}>Retry saving conversation</button>}</div>}
          <div className="office-ai-transcript" ref={transcript} role="log" aria-label="Pip conversation" aria-live="polite" aria-relevant="additions text">
            {!messages.length && <div className="office-ai-welcome"><div className="office-ai-welcome-icon"><Bot size={29} /></div><h2>What would you like to fix?</h2><p>Tell Pip what you need. It can make changes, run checks, deploy, and show the results here. You can ask questions in the same chat.</p><div className="office-ai-starters">{STARTERS.map(item => <button key={item.title} type="button" disabled={busy} onClick={() => starter(item)}><strong>{item.title}<ArrowUpRight size={15} /></strong><span>{item.detail}</span></button>)}</div></div>}
            {messages.map(message => <Answer key={message.id} message={message} onCommand={chooseCommand} apiBase={apiBase} request={request} onTaskUpdate={updateTask} onOpenTerminal={openTerminal} />)}
            {busy && <p className="office-ai-thinking" role="status"><span />{mode === 'work' ? 'Starting your task…' : research ? 'Researching sources and preparing your answer…' : 'Preparing your answer…'}</p>}
          </div>
          <form className="office-ai-composer" onSubmit={send}>
            <label className="office-ai-creativity-control"><span>Creative freedom</span><select aria-label="Conversation creative freedom" value={creativity} disabled={busy} onChange={event => setCreativity(event.target.value)}><option value="strict">Follow my instructions closely</option><option value="balanced">Fill in the creative gaps</option><option value="creative">Explore new possibilities</option></select><small>Creative choices can be inferred. Factual claims still need evidence.</small></label>
            {error && <p className="office-ai-error" role="alert">{error}</p>}
            {executionError && <p className="office-ai-error" role="alert">{executionError}</p>}
            {taskActive && <p className="office-ai-form-note">Your task is continuing below. You can stop it, confirm a requested action, or continue its saved checkpoint there.</p>}
            {mode === 'ask' && !!selectedTools.length && <div className="office-ai-selected" aria-label="Selected tools">{tools.filter(tool => selectedTools.includes(tool.id)).map(tool => <button key={tool.id} type="button" disabled={busy} onClick={() => toggleTool(tool.id)} title="Remove from next reply"><Wrench size={12} />{tool.name}<span aria-hidden="true">×</span></button>)}</div>}
            {!!attachments.length && <ul className="office-ai-attachments" aria-label="Files for your next message">{attachments.map((file, index) => <li key={`${index}-${file.name}`}>{file.type.startsWith('image/') && <img src={file.data} alt="" />}<span>{file.name}</span><button type="button" disabled={busy || attachmentBusy} onClick={() => setAttachments(previous => previous.filter((_, item) => item !== index))} aria-label={`Remove attachment ${file.name}`}><Trash2 size={13} /></button></li>)}</ul>}
            <label className="office-ai-sr-only" htmlFor="office-ai-prompt">Message Pip</label><textarea id="office-ai-prompt" ref={composer} value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} rows={3} placeholder="Ask anything, or describe what to fix and deploy…" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} />
            <div className="office-ai-composer-footer"><span>{attachmentBusy ? 'Preparing attachment…' : `${draft.length.toLocaleString()} characters`} <span className="office-ai-key-hint">· Enter to send · Shift + Enter for a new line</span></span>{busy ? <button key="stop" type="button" onClick={event => { event.preventDefault(); stop(); }}><Square size={14} />{mode === 'work' ? 'Stop waiting' : 'Stop'}</button> : <button key="send" className="office-ai-primary" type="submit" disabled={(!draft.trim() && !attachments.length) || attachmentBusy || !connection?.configured || loading || conversations.loading || (mode === 'work' && (!taskCapabilities || taskActive))}><Send size={15} />{mode === 'work' ? 'Send and work' : 'Send'}</button>}</div>
          </form>
          <OfficeAISensors ref={sensors} tone={tone} compact={true} onActivityChange={setSensorState} onToneChange={chooseTone} following={following} onFollowingChange={onFollowingChange} officeSection={officeSection} onHelpHere={() => { setDraft(`What can I do in ${officeSection?.label || 'this Office section'}. Explain the useful next steps.`); composer.current?.focus(); }} onCallOpenChange={onCallOpenChange} onContinueWithText={onContinueWithText} active={active && tab === 'conversation' && ['ask','work'].includes(mode)} disabled={loading || !connection?.configured || conversations.loading} busy={busy || attachmentBusy} onVoiceMessage={voiceMessage} onFiles={attach} welcomeBriefing={welcomeBriefing} onWelcomeConsumed={onWelcomeConsumed} onActivate={() => { setTab('conversation'); setMode('ask'); }} />
          <details className="office-ai-voice-scope"><summary>Task settings · Full access</summary><p>Pip can use your connected tools across the project to complete your request. Choose the actions and deployment targets it may use below.</p><OfficeAITaskScope permissions={permissions} setPermissions={setPermissions} targets={targets} setTargets={setTargets} capabilities={taskCapabilities} disabled={busy || taskActive} />{executionError && <p className="office-ai-error" role="alert">{executionError}</p>}</details>
          <p className="office-ai-privacy">Messages, attached files and photos, camera frames shared with a message, and selected workspace excerpts are sent to Cloudflare. Voice recognition uses your browser’s speech service. Live research sends queries to Cloudflare search; supplied public web links can be retrieved. Chats are saved in the Office database for authorized operators. Avoid sharing passwords or credentials.</p>
        </div>
        <aside hidden={!settingsOpen} className="office-ai-context" aria-label="Conversation settings"><div className="office-ai-context-card office-ai-saved-chats"><div className="office-ai-card-heading"><h2>Saved conversations</h2><button type="button" className="office-ai-text-button" disabled={conversations.loading || conversations.saving} onClick={conversations.refresh} aria-label="Refresh saved conversations"><RefreshCw size={14} /></button></div><p>Saved automatically in Office. Available after you return and sign in.</p>{conversations.conversations.length ? <ul>{conversations.conversations.map(item => <li key={item.id}><button type="button" disabled={busy || conversations.saving || conversations.loading} aria-pressed={conversations.currentId === item.id} onClick={() => openChat(item.id)}>{item.title || 'Office conversation'}</button><button type="button" disabled={conversations.saving || conversations.loading} aria-label={`Delete conversation ${item.title || 'Office conversation'}`} onClick={() => setDeleteChat(item.id)}><Trash2 size={13} /></button>{deleteChat === item.id && <div className="office-ai-delete-chat"><span>Delete this saved conversation?</span><button type="button" disabled={conversations.loading} onClick={() => { setDeleteChat(null); conversations.remove(item.id); }}>Delete saved chat</button><button type="button" onClick={() => setDeleteChat(null)}>Keep chat</button></div>}</li>)}</ul> : <p>No saved conversations yet.</p>}</div>{mode === 'work' && <div className="office-ai-context-card"><h2>Work with your connections</h2><p>Pip uses the latest saved connections and shows completed work in this conversation.</p><OfficeAITaskScope permissions={permissions} setPermissions={setPermissions} targets={targets} setTargets={setTargets} capabilities={taskCapabilities} disabled={busy || taskActive} /><button type="button" className="office-ai-text-button" onClick={() => setTab('connections')}>Review connections</button></div>}{mode === 'ask' && <div className="office-ai-context-card"><h2>Make the answer yours</h2>{!compact && toneControl}<label className="office-ai-research-toggle"><span><Brain size={17} /><strong>Recall relevant memory</strong></span><input type="checkbox" checked={remember} disabled={busy} onChange={event => setRemember(event.target.checked)} /></label><p>Recall prior discussions and execution receipts for this answer. Saved discussions are recorded in shared memory; review or forget entries in Memory.</p><label className="office-ai-research-toggle"><span><Globe2 size={17} /><strong>Live web research</strong></span><input type="checkbox" checked={research} disabled={busy} onChange={event => setResearch(event.target.checked)} /></label><p>Look up current information and include sources. Search availability is shown with each reply; broad search requires Cloudflare search credits.</p><label className="office-ai-field">Answer style<select value={perspective} disabled={busy} onChange={event => setPerspective(event.target.value)}><option value="balanced">Balanced perspectives</option><option value="concise">Concise answer</option><option value="deep">Deep analysis</option></select></label><p>Consider evidence, alternatives, tradeoffs, and what remains unknown.</p></div>}
          {mode === 'ask' && <div className="office-ai-context-card"><div className="office-ai-card-heading"><h2>Sources for this reply</h2><Link2 size={15} /></div><p>Choose connected workspaces to search for context in Ask mode. Source excerpts are included in your answer.</p>{sourcesError ? <p className="office-ai-source-warning" role="status">{sourcesError}</p> : <div className="office-ai-tool-selection">{Object.entries(SOURCE_NAMES).map(([id, name]) => {
            const item = sourceConnections.find(source => source.id === id);
            return <label key={id}><input type="checkbox" checked={selectedSources.includes(id)} disabled={busy || loading || !item?.configured} onChange={() => setSelectedSources(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])} /><span>{name}<small>{loading ? 'Checking connection…' : item?.configured ? 'Connected · include in reply' : 'Connect to use in replies'}</small></span></label>;
          })}</div>}<button type="button" className="office-ai-text-button" onClick={() => setTab('connections')}><Plus size={14} />Connect sources</button>{sourcesError && <button type="button" className="office-ai-text-button" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />Refresh sources</button>}</div>}
          {mode === 'ask' && <div className="office-ai-context-card"><div className="office-ai-card-heading"><h2>Tools for this conversation</h2><Wrench size={15} /></div>{tools.length ? <div className="office-ai-tool-selection">{tools.filter(tool => tool.kind === 'prompt').map(tool => <label key={tool.id}><input type="checkbox" checked={selectedTools.includes(tool.id)} disabled={busy || (!selectedTools.includes(tool.id) && selectedTools.length >= 8)} onChange={() => toggleTool(tool.id)} /><span>{tool.name}<small>{tool.kind === 'prompt' ? 'Answer instructions' : 'Office command'}</small></span></label>)}</div> : <p>{toolsError ? 'The saved tool library is unavailable. Retry in My tools.' : 'Save a research method or an Office command to use again.'}</p>}<button type="button" className="office-ai-text-button" onClick={() => setTab('tools')}><Plus size={14} />Manage tools</button>{tools.length > 8 && <small>Choose up to 8 tools per reply.</small>}</div>}
          <div className="office-ai-context-card office-ai-command-note"><SlidersHorizontal size={19} /><h2>Office controls</h2><p>Manage Office in its own workspace. Conversation and task instructions stay separate from control navigation.</p><button type="button" className="office-ai-text-button" onClick={() => chooseCommand()}>Browse Office commands<ChevronRight size={14} /></button></div>
          {connection?.model && <p className="office-ai-model">Cloudflare model<br /><span>{connection.model}</span>{connection.reasoning?.enabled && <><br /><span>Thinking enabled</span></>}</p>}
        </aside>
      </div>
      </div>
    </div>

    {tasksOpened && <div hidden={tab !== 'tasks'}><OfficeAITasks apiBase={apiBase} request={request} onOpenTerminal={openTerminal} tone={tone} /></div>}
    {studioOpened && <div hidden={tab !== 'studio'}><OfficeAIStudio apiBase={apiBase} request={request} active={tab === 'studio'} initialBrief={studioSeed} /></div>}
    {upgradesOpened && <div hidden={tab !== 'upgrades'}><OfficeAITasks apiBase={apiBase} request={request} onOpenTerminal={openTerminal} initialDestination="self-update" tone={tone} /></div>}
    {tab === 'functions' && <OfficeAIFunctions apiBase={apiBase} request={request} onRequest={message => { setDraft(message); setTab('conversation'); composer.current?.focus(); }} />}
    {tab === 'memory' && <OfficeAIMemory apiBase={apiBase} request={request} />}
    {tab === 'activity' && <OfficeAIActivity apiBase={apiBase} request={request} />}
    {tab === 'terminal' && <OfficeAITerminal apiBase={apiBase} request={request} sessionId={selectedTerminalId} />}
    <div hidden={tab !== 'tools'} className="office-ai-tools-panel">
      <div className="office-ai-section-heading"><div><h2>Your tool library</h2><p>Save reusable instructions or shortcuts to existing Office commands. Tools are shared with authorized Office operators.</p></div><button type="button" disabled={loading || toolBusy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />Refresh tools</button></div>
      {toolsError && <p className="office-ai-error" role="alert">{toolsError}</p>}{toolNotice && <p className="office-ai-notice" role="status"><Check size={15} />{toolNotice}</p>}
      <div className="office-ai-tools-layout"><div className="office-ai-tool-library">{tools.length ? tools.map(tool => <article key={tool.id} className="office-ai-saved-tool"><div><Wrench size={18} /><span>{tool.kind === 'prompt' ? 'Answer instructions' : 'Office command'}</span></div><h3>{tool.name}</h3><p>{tool.description || (tool.kind === 'prompt' ? 'Reusable instructions for your next answer.' : 'A shortcut to an existing Office control.')}</p>{tool.kind === 'prompt' && <details><summary>View instructions</summary><p>{tool.instructions}</p></details>}<div className="office-ai-tool-buttons">{tool.kind === 'prompt' && <button type="button" disabled={busy || (!selectedTools.includes(tool.id) && selectedTools.length >= 8)} aria-pressed={selectedTools.includes(tool.id)} onClick={() => toggleTool(tool.id)}>{selectedTools.includes(tool.id) ? <Check size={14} /> : <Plus size={14} />}{selectedTools.includes(tool.id) ? 'Selected' : 'Use in chat'}</button>}{tool.kind === 'office-command' && <button type="button" onClick={() => chooseCommand(tool.controlId)}>Review command</button>}<button type="button" className="office-ai-remove" disabled={toolBusy} onClick={() => mutateTool('DELETE', tool.id)} aria-label={`Remove tool ${tool.name}`}><Trash2 size={14} /></button></div></article>) : <div className="office-ai-empty"><Wrench size={30} /><h3>{loading ? 'Loading tools…' : 'Build your personal toolkit'}</h3><p>Try a product review checklist, an AI research briefing, or a shortcut to a command you use often.</p></div>}</div>
        <form className="office-ai-tool-form" onSubmit={event => { event.preventDefault(); mutateTool('POST'); }}><h3><Plus size={17} />Add a tool</h3><label className="office-ai-field">Tool name<input required maxLength={80} value={toolForm.name} disabled={toolBusy} onChange={event => setToolForm({ ...toolForm, name: event.target.value })} placeholder="For example, Product review" /></label><label className="office-ai-field">Description<input maxLength={300} value={toolForm.description} disabled={toolBusy} onChange={event => setToolForm({ ...toolForm, description: event.target.value })} placeholder="What this tool helps you do" /></label><label className="office-ai-field">Tool type<select value={toolForm.kind} disabled={toolBusy} onChange={event => setToolForm({ ...toolForm, kind: event.target.value })}><option value="prompt">Answer instructions</option><option value="office-command">Office command</option></select></label>{toolForm.kind === 'prompt' ? <label className="office-ai-field">Instructions<textarea required maxLength={4000} rows={6} value={toolForm.instructions} disabled={toolBusy} onChange={event => setToolForm({ ...toolForm, instructions: event.target.value })} placeholder="Compare user value, technical feasibility, operating costs, privacy, risks, and alternatives. End with clear next steps." /></label> : <><label className="office-ai-field">Office command<select required value={toolForm.controlId} disabled={toolBusy || !controls.length} onChange={event => setToolForm({ ...toolForm, controlId: event.target.value })}><option value="">Choose a command</option>{controls.filter(control => typeof control?.id === 'string' && typeof control.label === 'string').map(control => <option key={control.id} value={control.id}>{control.label}</option>)}</select></label>{controlsError && <p className="office-ai-error" role="alert">{controlsError}</p>}<p className="office-ai-form-note">This tool offers the command for review. Its usual inputs and confirmations apply when you run it.</p></>}<button className="office-ai-primary" type="submit" disabled={toolBusy || loading || !toolForm.name.trim() || (toolForm.kind === 'prompt' ? !toolForm.instructions.trim() : !toolForm.controlId)}>{toolBusy ? 'Saving…' : 'Save tool'}<Plus size={14} /></button><p className="office-ai-form-note">Saved to the Office database. Custom tools support instructions and registered Office commands.</p></form>
      </div>
    </div>
    <div hidden={tab !== 'commands'} className="office-ai-commands"><div ref={commandMapRef} hidden={commandView !== 'map'}><div className="office-ai-command-navigation"><span><MapIcon size={17} />Browse controls by purpose</span><button type="button" onClick={() => { setCommandQuery(''); setCommandView('review'); }}><List size={15} />Open control panel</button></div><OfficeCommandMap key={generation.current} controls={controls} loading={loading} error={controlsError} onCommand={chooseCommand} onRefresh={() => setRevision(value => value + 1)} /></div>{tab === 'commands' && commandView === 'review' && <div ref={commandReviewRef} tabIndex={-1} aria-label="Command review"><div className="office-ai-command-navigation"><button type="button" onClick={returnToMap}><ArrowLeft size={15} />Back to control map</button><span>Review command</span></div><p className="office-ai-command-intro">Review the target service and effects before confirming an action.</p><Controls key={`${commandQuery}:${generation.current}`} apiBase={apiBase} pipelineBase={pipelineBase} request={request} onNavigate={onNavigate} initialQuery={commandQuery} /></div>}</div>
    {tab === 'connections' && <OfficeConnections apiBase={apiBase} request={request} onConnected={() => setRevision(value => value + 1)} onNavigate={view => view === 'controls' ? chooseCommand() : onNavigate(view)} />}
  </section>;
}
