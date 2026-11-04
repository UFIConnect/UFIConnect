import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bot, Check, ChevronRight, Globe2, Link2, MessageSquare, Plus, RefreshCw, Send, SlidersHorizontal, Square, Trash2, Wrench } from 'lucide-react';
import Controls from './Controls';
import OfficeConnections from './OfficeConnections';
import OfficeAIContent from './OfficeAIContent';
import OfficeAITasks from './OfficeAITasks';
import OfficeAITerminal from './OfficeAITerminal';
import useOfficeAIConversations from './useOfficeAIConversations';
import './OfficeAI.css';

const STARTERS = [
  { title: 'Catch up on AI', detail: 'Recent releases, capabilities, and tradeoffs', message: 'Research the latest important AI updates. Compare models, practical capabilities, limitations, costs, and implications for UFIConnect. Include dated primary sources and explain what remains uncertain.' },
  { title: 'Explore every angle', detail: 'Evidence, alternatives, risks, and next steps', message: 'Help me evaluate an idea from the technical, user, business, privacy, and operational perspectives. Ask me what idea I want to explore first.' },
  { title: 'Understand my Office', detail: 'Explain the current observations and controls', message: 'Explain the current Office observations, distinguish confirmed facts from missing information, and suggest the relevant Office commands for the next checks.' },
];
const BLANK_TOOL = { name: '', description: '', kind: 'prompt', instructions: '', controlId: '' };
const TABS = [['conversation', 'Conversation', MessageSquare], ['tools', 'My tools', Wrench], ['commands', 'Office commands', SlidersHorizontal], ['connections', 'Connections', Link2]];
const sourceUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
};
const dateLabel = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
const cleanError = value => String(value || '').replace(/\bBearer\s+\S+/gi, '[credential omitted]')
  .replace(/\b(?:sk-[a-zA-Z0-9_-]+|[a-z_]*(?:token|password|secret|api[_-]?key)\s*[:=]\s*\S+)/gi, '[credential omitted]').slice(0, 400);

async function payload(response) {
  let data;
  try { data = await response.json(); } catch { throw Error('Office AI returned an unreadable response. Please retry.'); }
  if (!response.ok) {
    if (response.status === 401) throw Error('Office access is unavailable. Reconnect to Office and retry.');
    if (response.status === 404) throw Error('Office AI is unavailable on this service version. Refresh after the service update.');
    if (response.status === 429) throw Error('Office AI is busy. Wait briefly and try again.');
    throw Error(typeof data?.error === 'string' ? cleanError(data.error) : `Office AI could not complete this request (${response.status}). Please retry.`);
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

function Answer({ message, onCommand }) {
  const sources = (Array.isArray(message.sources) ? message.sources : []).filter(source => sourceUrl(source?.url));
  const actions = (Array.isArray(message.actions) ? message.actions : []).filter(action => /^[a-z][a-z0-9.-]{1,100}$/.test(action?.id) && typeof action.label === 'string');
  return <article className={`office-ai-message office-ai-message-${message.role}`}>
    <div className="office-ai-message-author">{message.role === 'assistant' ? <><Bot size={17} /> Office AI</> : 'You'}
      {message.role === 'assistant' && <span>{dateLabel(message.generatedAt)}</span>}
    </div>
    <div className="office-ai-answer">{message.role === 'assistant' ? <OfficeAIContent text={message.content} /> : message.content}</div>
    {message.role === 'assistant' && <>
      <div className="office-ai-answer-meta"><Globe2 size={13} /><span>{researchLabel(message.research)}</span>{message.model && <span>{message.model}</span>}</div>
      {['unavailable', 'empty'].includes(message.research?.status) && <p className="office-ai-research-note">Current information could not be verified for this reply. Check primary sources before relying on recent claims.</p>}
      {message.research?.status === 'official-updates' && <p className="office-ai-research-note">Official announcement feeds were checked. Broader web research is unavailable for this reply.</p>}
      {!!sources.length && <details className="office-ai-sources" open><summary>{sources.length} sources · retrieved {dateLabel(message.research?.checkedAt || message.generatedAt)}</summary><ol>{sources.map((source, index) => <Source key={`${source.url}-${index}`} source={source} />)}</ol></details>}
      {!!actions.length && <div className="office-ai-actions" aria-label="Suggested Office commands">{actions.map(action => <button key={action.id} type="button" onClick={() => onCommand(action.id)}><SlidersHorizontal size={16} /><span><strong>{action.label}</strong><small>Review in Office commands</small></span><ChevronRight size={16} /></button>)}</div>}
    </>}
  </article>;
}

export default function OfficeAI({ apiBase = '', pipelineBase = '', request = fetch, onNavigate = () => {} }) {
  const [tab, setTab] = useState('conversation'), [revision, setRevision] = useState(0);
  const [connection, setConnection] = useState(null), [loading, setLoading] = useState(true), [connectionError, setConnectionError] = useState('');
  const [tools, setTools] = useState([]), [toolsError, setToolsError] = useState(''), [controls, setControls] = useState([]), [controlsError, setControlsError] = useState('');
  const [selectedTools, setSelectedTools] = useState([]), [toolForm, setToolForm] = useState(BLANK_TOOL), [toolBusy, setToolBusy] = useState(false), [toolNotice, setToolNotice] = useState('');
  const [draft, setDraft] = useState(''), [messages, setMessages] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [research, setResearch] = useState(true), [perspective, setPerspective] = useState('balanced'), [commandQuery, setCommandQuery] = useState('');
  const [mode, setMode] = useState('ask'), [deleteChat, setDeleteChat] = useState(null);
  const mounted = useRef(false), generation = useRef(0), chatSequence = useRef(0), pending = useRef(null), requests = useRef(new Set()), saving = useRef(false), transcript = useRef(null), composer = useRef(null);
  const conversations = useOfficeAIConversations({ apiBase, request, messages, setMessages, beforeLoad: () => { stop(); setDraft(''); } });

  useEffect(() => {
    mounted.current = true;
    const reset = () => {
      generation.current++; chatSequence.current++; requests.current.forEach(controller => controller.abort()); requests.current.clear();
      pending.current = null; saving.current = false;
      setDeleteChat(null); setMode('ask');
      setMessages([]); setDraft(''); setBusy(false); setError(''); setToolBusy(false); setToolNotice(''); setSelectedTools([]); setToolForm(BLANK_TOOL); setTools([]); setControls([]); setConnection(null); setCommandQuery(''); setRevision(value => value + 1);
    };
    window.addEventListener('office-token-changed', reset);
    return () => { mounted.current = false; generation.current++; chatSequence.current++; requests.current.forEach(controller => controller.abort()); window.removeEventListener('office-token-changed', reset); };
  }, []);

  useEffect(() => {
    const controller = new AbortController(), current = generation.current;
    let active = true;
    requests.current.add(controller); setLoading(true); setConnectionError(''); setToolsError(''); setControlsError('');
    const valid = () => active && mounted.current && current === generation.current;
    const timeout = setTimeout(() => controller.abort(), 20000);
    Promise.allSettled([
      request(`${apiBase}/office/ai`, { signal: controller.signal }).then(payload).then(data => {
        if (typeof data?.configured !== 'boolean' || data.provider !== 'Cloudflare') throw Error('Office AI connection details are unavailable.');
        if (valid()) setConnection(data);
      }).catch(cause => { if (valid()) { setConnection(null); setConnectionError(cause.name === 'AbortError' ? 'Connection check timed out. Retry the connection.' : cause.message); } }),
      request(`${apiBase}/office/ai/tools`, { signal: controller.signal }).then(payload).then(data => {
        if (!Array.isArray(data.tools)) throw Error('Tool library is unavailable.');
        const list = data.tools.filter(tool => typeof tool?.id === 'string' && typeof tool.name === 'string' && ['prompt', 'office-command'].includes(tool.kind));
        if (valid()) { setTools(list); setSelectedTools(previous => previous.filter(id => list.some(tool => tool.id === id))); }
      }).catch(cause => { if (valid()) { setTools([]); setSelectedTools([]); setToolsError(cause.name === 'AbortError' ? 'Tool library check timed out. Retry to load saved tools.' : cause.message); } }),
      request(`${apiBase}/office/controls`, { signal: controller.signal }).then(payload).then(data => {
        if (valid()) setControls(Array.isArray(data.controls) ? data.controls : []);
      }).catch(cause => { if (valid()) { setControls([]); setControlsError(cause.name === 'AbortError' ? 'Command list check timed out. Retry to load commands.' : cause.message); } }),
    ]).finally(() => { clearTimeout(timeout); requests.current.delete(controller); if (valid()) setLoading(false); });
    return () => { active = false; clearTimeout(timeout); controller.abort(); requests.current.delete(controller); };
  }, [apiBase, request, revision]);

  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, busy]);

  function stop(clear = false) {
    const active = pending.current;
    chatSequence.current++; active?.controller.abort(); pending.current = null; setBusy(false); setError('');
    if (clear) { setMessages([]); setDraft(''); }
    else if (active) { setMessages(previous => previous.filter(message => message.id !== active.id)); setDraft(active.message); }
  }

  async function send(event) {
    event.preventDefault(); const message = draft.trim();
    if (!message || pending.current || !connection?.configured || loading) return;
    const history = messages.filter(item => ['user', 'assistant'].includes(item.role)).slice(-12).map(({ role, content }) => ({ role, content }));
    while (history.length && history.reduce((total, item) => total + item.content.length, 0) > 32000) history.shift();
    const controller = new AbortController(), current = generation.current, sequence = ++chatSequence.current, id = `user-${crypto.randomUUID()}`;
    requests.current.add(controller); pending.current = { controller, message, id }; setBusy(true); setError(''); setDraft('');
    setMessages(previous => [...previous, { role: 'user', content: message, id }]);
    let timedOut = false;
    // Leave time for the backend's bounded 90-second research and inference
    // request to return a result or its own actionable timeout response.
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 100000);
    const valid = () => mounted.current && current === generation.current && sequence === chatSequence.current;
    try {
      const data = await payload(await request(`${apiBase}/office/ai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ message, history, research, perspective, toolIds: selectedTools }) }));
      if (typeof data?.reply !== 'string' || !data.reply.trim()) throw Error('Office AI returned an empty reply. Please retry.');
      if (valid()) setMessages(previous => [...previous, { ...data, role: 'assistant', content: data.reply, id: `assistant-${crypto.randomUUID()}` }]);
    } catch (cause) {
      if (valid()) { setMessages(previous => previous.filter(item => item.id !== id)); setDraft(message); setError(timedOut ? 'The response timed out. Your message is ready to retry.' : cause.name === 'AbortError' ? 'Request stopped. Your message is ready to retry.' : cause.name === 'TypeError' ? 'The connection ended before Office AI could respond. Your message is ready to retry.' : cause.message); }
    } finally {
      clearTimeout(timeout); requests.current.delete(controller);
      if (valid()) { pending.current = null; setBusy(false); composer.current?.focus(); }
    }
  }

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

  function chooseCommand(id = '') { setCommandQuery(id); setTab('commands'); }
  function toggleTool(id) { setSelectedTools(previous => previous.includes(id) ? previous.filter(value => value !== id) : previous.length < 8 ? [...previous, id] : previous); }
  function starter(item) { setDraft(item.message); setResearch(true); composer.current?.focus(); }
  function confirmDiscard() { return !conversations.error || !messages.length || window.confirm('Some conversation changes have not been saved. Discard those unsaved changes and continue?'); }
  function newChat() { if (confirmDiscard()) conversations.newConversation(); }
  function openChat(id) { if (confirmDiscard()) conversations.open(id); }

  async function attach(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const current = generation.current;
    if (!/\.(txt|md|csv|json)$/i.test(file.name) || file.size > 96000) { setError('Choose a text, Markdown, CSV, or JSON file under 96 KB. Its contents must fit the 12,000-character message limit.'); return; }
    try {
      const content = await file.text();
      if (!mounted.current || current !== generation.current) return;
      if (content.includes('\0')) throw Error('This file contains binary data. Choose a plain text file.');
      const block = `\n\nAttached file: ${file.name.replace(/[\r\n]/g, ' ').slice(0, 150)}\n${content}\n`;
      setDraft(previous => {
        if (previous.length + block.length > 12000) { setError('The attachment and message exceed 12,000 characters. Shorten the message or choose a smaller file.'); return previous; }
        setError(''); return previous + block;
      });
    } catch (cause) { if (mounted.current && current === generation.current) setError(cause.message || 'The text file could not be read.'); }
  }

  return <section className="office-ai" aria-labelledby="office-ai-title">
    <header className="office-ai-header"><div className="office-ai-identity"><div className="office-ai-mark"><Bot size={27} /></div><div><p className="office-ai-eyebrow">UFICONNECT · OFFICIAL OFFICE ASSISTANT</p><h1 id="office-ai-title">Office AI</h1><p>Research ideas. See the angles. Get things done.</p></div></div><div className="office-ai-connection"><span data-ready={!!connection?.configured}>{loading ? 'Checking connection…' : connection?.configured ? 'Cloudflare configured' : 'Connection needs attention'}</span><button type="button" onClick={() => setRevision(value => value + 1)} disabled={loading || toolBusy} aria-label="Refresh AI connection"><RefreshCw size={15} /></button></div></header>
    <nav className="office-ai-tabs" aria-label="Office AI sections">{TABS.map(([id, label, Icon]) => <button type="button" key={id} aria-pressed={tab === id} onClick={() => id === 'commands' ? chooseCommand() : setTab(id)}><Icon size={16} />{label}{id === 'tools' && !!tools.length && <span>{tools.length}</span>}</button>)}</nav>
    {connectionError && <p className="office-ai-error" role="alert">{connectionError}</p>}
    {!loading && connection && !connection.configured && <div className="office-ai-setup" role="status"><strong>Connect your Cloudflare AI account</strong><p>Office AI needs its server connection before it can answer. Your Office commands are available in the commands tab.</p>{Array.isArray(connection.missing) && connection.missing.length > 0 && <p>Missing settings: <code>{connection.missing.join(', ')}</code></p>}<button type="button" onClick={() => setTab('connections')}>Open connections <ArrowUpRight size={14} /></button></div>}

    <div hidden={tab !== 'conversation'}>
      <div className="office-ai-modes" aria-label="Assistant mode">{[['ask', 'Ask'], ['task', 'Run a task'], ['terminal', 'Terminal']].map(([id, label]) => <button key={id} type="button" aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}</div>
      {tab === 'conversation' && mode === 'task' && <OfficeAITasks apiBase={apiBase} request={request} />}
      {tab === 'conversation' && mode === 'terminal' && <OfficeAITerminal apiBase={apiBase} request={request} />}
      <div hidden={mode !== 'ask'}>
      <div className="office-ai-workspace">
        <div className="office-ai-chat">
          <div className="office-ai-chat-bar"><span><span className="office-ai-dot" />Private Office conversation</span><button type="button" onClick={newChat} disabled={conversations.saving || conversations.loading || (!messages.length && !draft && !busy)}><Plus size={14} />New chat</button></div>
          <div className="office-ai-save-state" role="status">{conversations.saving ? 'Saving conversation…' : conversations.error ? 'Conversation changes are not saved.' : conversations.savedAt ? 'Conversation saved in Office' : 'Chats save automatically in Office.'}</div>
          {conversations.error && <div className="office-ai-save-error"><p className="office-ai-error" role="alert">{conversations.error}</p>{conversations.conflict && conversations.currentId ? <button type="button" onClick={() => { if (window.confirm('Replace your current messages with the version saved in Office?')) conversations.open(conversations.currentId); }}>Reload saved conversation</button> : <button type="button" onClick={() => { conversations.refresh(); conversations.retry(); }}>Retry saving conversation</button>}</div>}
          <div className="office-ai-transcript" ref={transcript} role="log" aria-label="Office AI conversation" aria-live="polite" aria-relevant="additions text">
            {!messages.length && <div className="office-ai-welcome"><div className="office-ai-welcome-icon"><Bot size={29} /></div><h2>What are we working on?</h2><p>Go from a question to a clearer decision, with current sources and the Office tools to follow through.</p><div className="office-ai-starters">{STARTERS.map(item => <button key={item.title} type="button" disabled={busy} onClick={() => starter(item)}><strong>{item.title}<ArrowUpRight size={15} /></strong><span>{item.detail}</span></button>)}</div></div>}
            {messages.map(message => <Answer key={message.id} message={message} onCommand={chooseCommand} />)}
            {busy && <p className="office-ai-thinking" role="status"><span />{research ? 'Researching sources and preparing your answer…' : 'Preparing your answer…'}</p>}
          </div>
          <form className="office-ai-composer" onSubmit={send}>
            {error && <p className="office-ai-error" role="alert">{error}</p>}
            {!!selectedTools.length && <div className="office-ai-selected" aria-label="Selected tools">{tools.filter(tool => selectedTools.includes(tool.id)).map(tool => <button key={tool.id} type="button" disabled={busy} onClick={() => toggleTool(tool.id)} title="Remove from next reply"><Wrench size={12} />{tool.name}<span aria-hidden="true">×</span></button>)}</div>}
            <label className="office-ai-sr-only" htmlFor="office-ai-prompt">Message Office AI</label><textarea id="office-ai-prompt" ref={composer} value={draft} onChange={event => setDraft(event.target.value)} disabled={busy} maxLength={12000} rows={3} placeholder="Ask a question, explore an idea, or find an Office command…" onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form.requestSubmit(); } }} />
            <div className="office-ai-composer-footer"><span>{draft.length.toLocaleString()} / 12,000 <span className="office-ai-key-hint">· Ctrl / ⌘ + Enter to send</span></span><label className="office-ai-attachment">Attach text<input type="file" accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json" disabled={busy} onChange={attach} aria-label="Attach text file" /></label>{busy ? <button key="stop" type="button" onClick={event => { event.preventDefault(); stop(); }}><Square size={14} />Stop</button> : <button key="send" className="office-ai-primary" type="submit" disabled={!draft.trim() || !connection?.configured || loading || conversations.loading}><Send size={15} />Send</button>}</div>
          </form>
          <p className="office-ai-privacy">Messages and attached text are sent to Cloudflare. Live research sends queries to Cloudflare search; supplied public web links can be retrieved. Chats are saved in the Office database for authorized operators. Avoid pasting passwords or credentials.</p>
        </div>
        <aside className="office-ai-context" aria-label="Conversation settings"><div className="office-ai-context-card office-ai-saved-chats"><div className="office-ai-card-heading"><h2>Saved conversations</h2><button type="button" className="office-ai-text-button" disabled={conversations.loading || conversations.saving} onClick={conversations.refresh} aria-label="Refresh saved conversations"><RefreshCw size={14} /></button></div><p>Saved automatically in Office. Available after you return and sign in.</p>{conversations.conversations.length ? <ul>{conversations.conversations.map(item => <li key={item.id}><button type="button" disabled={busy || conversations.saving || conversations.loading} aria-pressed={conversations.currentId === item.id} onClick={() => openChat(item.id)}>{item.title || 'Office conversation'}</button><button type="button" disabled={conversations.saving || conversations.loading} aria-label={`Delete conversation ${item.title || 'Office conversation'}`} onClick={() => setDeleteChat(item.id)}><Trash2 size={13} /></button>{deleteChat === item.id && <div className="office-ai-delete-chat"><span>Delete this saved conversation?</span><button type="button" disabled={conversations.loading} onClick={() => { setDeleteChat(null); conversations.remove(item.id); }}>Delete saved chat</button><button type="button" onClick={() => setDeleteChat(null)}>Keep chat</button></div>}</li>)}</ul> : <p>No saved conversations yet.</p>}</div><div className="office-ai-context-card"><h2>Make the answer yours</h2><label className="office-ai-research-toggle"><span><Globe2 size={17} /><strong>Live web research</strong></span><input type="checkbox" checked={research} disabled={busy} onChange={event => setResearch(event.target.checked)} /></label><p>Look up current information and include sources. Search availability is shown with each reply; broad search requires Cloudflare search credits.</p><label className="office-ai-field">Answer style<select value={perspective} disabled={busy} onChange={event => setPerspective(event.target.value)}><option value="balanced">Balanced perspectives</option><option value="concise">Concise answer</option><option value="deep">Deep analysis</option></select></label><p>Consider evidence, alternatives, tradeoffs, and what remains unknown.</p></div>
          <div className="office-ai-context-card"><div className="office-ai-card-heading"><h2>Tools for this conversation</h2><Wrench size={15} /></div>{tools.length ? <div className="office-ai-tool-selection">{tools.map(tool => <label key={tool.id}><input type="checkbox" checked={selectedTools.includes(tool.id)} disabled={busy || (!selectedTools.includes(tool.id) && selectedTools.length >= 8)} onChange={() => toggleTool(tool.id)} /><span>{tool.name}<small>{tool.kind === 'prompt' ? 'Answer instructions' : 'Office command'}</small></span></label>)}</div> : <p>{toolsError ? 'The saved tool library is unavailable. Retry in My tools.' : 'Save a research method or an Office command to use again.'}</p>}<button type="button" className="office-ai-text-button" onClick={() => setTab('tools')}><Plus size={14} />Manage tools</button>{tools.length > 8 && <small>Choose up to 8 tools per reply.</small>}</div>
          <div className="office-ai-context-card office-ai-command-note"><SlidersHorizontal size={19} /><h2>Connected to your Office</h2><p>Suggested actions open your existing controls, with their required inputs, service routing, and confirmations.</p><button type="button" className="office-ai-text-button" onClick={() => chooseCommand()}>Browse Office commands<ChevronRight size={14} /></button></div>
          {connection?.model && <p className="office-ai-model">Cloudflare model<br /><span>{connection.model}</span></p>}
        </aside>
      </div>
      </div>
    </div>

    <div hidden={tab !== 'tools'} className="office-ai-tools-panel">
      <div className="office-ai-section-heading"><div><h2>Your tool library</h2><p>Save reusable instructions or shortcuts to existing Office commands. Tools are shared with authorized Office operators.</p></div><button type="button" disabled={loading || toolBusy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} />Refresh tools</button></div>
      {toolsError && <p className="office-ai-error" role="alert">{toolsError}</p>}{toolNotice && <p className="office-ai-notice" role="status"><Check size={15} />{toolNotice}</p>}
      <div className="office-ai-tools-layout"><div className="office-ai-tool-library">{tools.length ? tools.map(tool => <article key={tool.id} className="office-ai-saved-tool"><div><Wrench size={18} /><span>{tool.kind === 'prompt' ? 'Answer instructions' : 'Office command'}</span></div><h3>{tool.name}</h3><p>{tool.description || (tool.kind === 'prompt' ? 'Reusable instructions for your next answer.' : 'A shortcut to an existing Office control.')}</p>{tool.kind === 'prompt' && <details><summary>View instructions</summary><p>{tool.instructions}</p></details>}<div className="office-ai-tool-buttons"><button type="button" disabled={busy || (!selectedTools.includes(tool.id) && selectedTools.length >= 8)} aria-pressed={selectedTools.includes(tool.id)} onClick={() => toggleTool(tool.id)}>{selectedTools.includes(tool.id) ? <Check size={14} /> : <Plus size={14} />}{selectedTools.includes(tool.id) ? 'Selected' : 'Use in chat'}</button>{tool.kind === 'office-command' && <button type="button" onClick={() => chooseCommand(tool.controlId)}>Review command</button>}<button type="button" className="office-ai-remove" disabled={toolBusy} onClick={() => mutateTool('DELETE', tool.id)} aria-label={`Remove tool ${tool.name}`}><Trash2 size={14} /></button></div></article>) : <div className="office-ai-empty"><Wrench size={30} /><h3>{loading ? 'Loading tools…' : 'Build your personal toolkit'}</h3><p>Try a product review checklist, an AI research briefing, or a shortcut to a command you use often.</p></div>}</div>
        <form className="office-ai-tool-form" onSubmit={event => { event.preventDefault(); mutateTool('POST'); }}><h3><Plus size={17} />Add a tool</h3><label className="office-ai-field">Tool name<input required maxLength={80} value={toolForm.name} disabled={toolBusy} onChange={event => setToolForm({ ...toolForm, name: event.target.value })} placeholder="For example, Product review" /></label><label className="office-ai-field">Description<input maxLength={300} value={toolForm.description} disabled={toolBusy} onChange={event => setToolForm({ ...toolForm, description: event.target.value })} placeholder="What this tool helps you do" /></label><label className="office-ai-field">Tool type<select value={toolForm.kind} disabled={toolBusy} onChange={event => setToolForm({ ...toolForm, kind: event.target.value })}><option value="prompt">Answer instructions</option><option value="office-command">Office command</option></select></label>{toolForm.kind === 'prompt' ? <label className="office-ai-field">Instructions<textarea required maxLength={4000} rows={6} value={toolForm.instructions} disabled={toolBusy} onChange={event => setToolForm({ ...toolForm, instructions: event.target.value })} placeholder="Compare user value, technical feasibility, operating costs, privacy, risks, and alternatives. End with clear next steps." /></label> : <><label className="office-ai-field">Office command<select required value={toolForm.controlId} disabled={toolBusy || !controls.length} onChange={event => setToolForm({ ...toolForm, controlId: event.target.value })}><option value="">Choose a command</option>{controls.filter(control => typeof control?.id === 'string' && typeof control.label === 'string').map(control => <option key={control.id} value={control.id}>{control.label}</option>)}</select></label>{controlsError && <p className="office-ai-error" role="alert">{controlsError}</p>}<p className="office-ai-form-note">This tool offers the command for review. Its usual inputs and confirmations apply when you run it.</p></>}<button className="office-ai-primary" type="submit" disabled={toolBusy || loading || !toolForm.name.trim() || (toolForm.kind === 'prompt' ? !toolForm.instructions.trim() : !toolForm.controlId)}>{toolBusy ? 'Saving…' : 'Save tool'}<Plus size={14} /></button><p className="office-ai-form-note">Saved to the Office database. Custom tools support instructions and registered Office commands.</p></form>
      </div>
    </div>
    {tab === 'commands' && <div className="office-ai-commands"><p className="office-ai-command-intro">Run commands through the Office control system. Review the target service and effects before confirming an action.</p><Controls key={`${commandQuery}:${generation.current}`} apiBase={apiBase} pipelineBase={pipelineBase} request={request} onNavigate={onNavigate} initialQuery={commandQuery} /></div>}
    {tab === 'connections' && <OfficeConnections apiBase={apiBase} request={request} onConnected={() => setRevision(value => value + 1)} onNavigate={onNavigate} />}
  </section>;
}
