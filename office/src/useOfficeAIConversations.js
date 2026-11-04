import { useEffect, useRef, useState } from 'react';
import { officeAIRequest, officeAIError } from './office-ai-client';

const WORKSPACE_PROVIDERS = new Set(['notion', 'slack', 'linear']);
const SOURCE_STATUSES = new Set(['retrieved', 'empty', 'unavailable', 'not-connected']);
const MEMORY_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const savedText = (value, limit) => typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, limit) : '';
const savedDate = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
function savedSources(input) {
  return (Array.isArray(input) ? input : []).slice(0, 20).flatMap(source => {
    if (!source || typeof source !== 'object') return [];
    let url;
    try { url = new URL(source.url); if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048) return []; } catch { return []; }
    const citation = { title: savedText(source.title, 240), url: url.href, publisher: savedText(source.publisher, 100) };
    const provider = WORKSPACE_PROVIDERS.has(source.provider) ? source.provider
      : /(?:^|\.)(?:notion\.so|notion\.com|notion\.site)$/.test(url.hostname) ? 'notion'
        : /(?:^|\.)slack\.com$/.test(url.hostname) ? 'slack' : /(?:^|\.)linear\.app$/.test(url.hostname) ? 'linear' : null;
    // Keep citation metadata, never the retrieved private workspace excerpt.
    return provider ? [{ ...citation, provider }]
      : [{ ...citation, description: savedText(source.description, 1200), publishedAt: savedDate(source.publishedAt) }];
  });
}
function savedSourceResults(input) {
  const seen = new Set();
  return (Array.isArray(input) ? input : []).slice(0, 3).flatMap(source => {
    if (!source || !WORKSPACE_PROVIDERS.has(source.id) || !SOURCE_STATUSES.has(source.status) || seen.has(source.id)) return [];
    seen.add(source.id);
    return [{ id: source.id, status: source.status, count: Number.isInteger(source.count) && source.count >= 0 && source.count <= 4 ? source.count : 0,
      checkedAt: savedDate(source.checkedAt), note: savedText(source.note, 600) }];
  });
}
function savedMemory(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const seen = new Set();
  return { status: ['retrieved', 'empty', 'unavailable', 'disabled'].includes(input.status) ? input.status : 'unavailable',
    entries: (Array.isArray(input.entries) ? input.entries : []).slice(0, 8).flatMap(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !MEMORY_UUID.test(entry.id || '')
        || seen.has(entry.id.toLowerCase()) || !['conversation', 'execution', 'note'].includes(entry.kind)) return [];
      seen.add(entry.id.toLowerCase());
      return [{ id: entry.id.toLowerCase(), title: savedText(entry.title, 240), kind: entry.kind,
        status: typeof entry.status === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(entry.status) ? entry.status : '',
        referenceId: typeof entry.referenceId === 'string' && /^[a-zA-Z0-9:._/-]{0,128}$/.test(entry.referenceId) ? entry.referenceId : '',
        createdAt: savedDate(entry.createdAt) }];
    }) };
}
function storedMessages(messages) {
  return messages.map(({ role, content, sources, connectedSources, research, actions, model, generatedAt, taskId, memory, truncated }) => ({ role, content: content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''),
    ...(role === 'assistant' ? { sources: savedSources(sources), connectedSources: savedSourceResults(connectedSources), research, actions, model, generatedAt,
      ...(taskId ? { taskId } : {}), ...(savedMemory(memory) ? { memory: savedMemory(memory) } : {}),
      ...(typeof truncated === 'boolean' ? { truncated } : {}) } : {}) }));
}

export default function useOfficeAIConversations({ apiBase, request, messages, setMessages, beforeLoad }) {
  const [conversations, setConversations] = useState([]), [currentId, setCurrentId] = useState(null), [saving, setSaving] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [savedAt, setSavedAt] = useState('');
  const controllers = useRef(new Set()), epoch = useRef(0), current = useRef(null), desired = useRef([]), saved = useRef('[]'), clientId = useRef(null), running = useRef(false), conflict = useRef(false), mounted = useRef(true), suspended = useRef(false);
  const api = (suffix = '', options = {}) => officeAIRequest(request, `${apiBase}/office/ai/conversations${suffix}`, options, controllers.current);
  const metadata = conversation => ({ id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt, version: conversation.version });
  function remember(conversation) { setConversations(previous => [metadata(conversation), ...previous.filter(item => item.id !== conversation.id)].slice(0, 100)); }
  async function refresh() {
    const generation = epoch.current;
    try { const data = await api(); if (mounted.current && generation === epoch.current) setConversations(Array.isArray(data.conversations) ? data.conversations : []); }
    catch (cause) { if (mounted.current && generation === epoch.current) setError(officeAIError(cause)); }
  }
  async function pump() {
    if (running.current || suspended.current || conflict.current || (!desired.current.length && !current.current)) return;
    const generation = epoch.current;
    running.current = true; setSaving(true); setError('');
    try {
      while (mounted.current && generation === epoch.current && JSON.stringify(desired.current) !== saved.current) {
        const snapshot = desired.current, signature = JSON.stringify(snapshot), title = snapshot.find(item => item.role === 'user')?.content.replace(/\s+/g, ' ').slice(0, 90) || 'Office conversation';
        if (!clientId.current) clientId.current = crypto.randomUUID();
        const result = await api(current.current ? `/${encodeURIComponent(current.current.id)}` : '', { method: current.current ? 'PATCH' : 'POST', body: { title, messages: snapshot, ...(current.current ? { expectedVersion: current.current.version } : { clientRequestId: clientId.current }) } });
        if (!mounted.current || generation !== epoch.current) return;
        const conversation = result.conversation || result;
        if (!conversation.id || !Number.isInteger(conversation.version)) throw Error('Conversation saving returned an invalid receipt. Retry saving your chat.');
        // A repeated create can return the first saved snapshot after its
        // response was lost. Do not mark later assistant messages as saved
        // until the receipt includes them; update that recovered version next.
        const received = Array.isArray(conversation.messages) ? storedMessages(conversation.messages) : null;
        if (!received) throw Error('Conversation saving returned an incomplete receipt. Retry saving your chat.');
        const sameText = received.length === snapshot.length && received.every((item, index) => item.role === snapshot[index].role && item.content === snapshot[index].content);
        const sameTask = sameText && received.every((item, index) => item.taskId === snapshot[index].taskId);
        const sameSourceMetadata = sameText && received.every((item, index) => JSON.stringify(item.sources) === JSON.stringify(snapshot[index].sources)
          && JSON.stringify(item.connectedSources) === JSON.stringify(snapshot[index].connectedSources));
        const sameReplyMetadata = sameText && received.every((item, index) => JSON.stringify(item.memory) === JSON.stringify(snapshot[index].memory)
          && item.truncated === snapshot[index].truncated);
        const sameContent = sameTask && sameSourceMetadata && sameReplyMetadata;
        current.current = conversation; saved.current = sameContent ? signature : JSON.stringify(received); setCurrentId(conversation.id); setSavedAt(conversation.updatedAt || new Date().toISOString()); remember(conversation);
        if (sameText && !sameTask) throw Error('The service did not retain the task link. Your task remains here. Refresh after the service update and retry saving.');
        if (sameTask && !sameSourceMetadata) throw Error('The service did not retain the source references. Your answer remains here. Refresh after the service update and retry saving.');
        if (sameTask && sameSourceMetadata && !sameReplyMetadata) throw Error('The service did not retain the memory references or completion status. Your answer remains here. Refresh after the service update and retry saving.');
      }
    } catch (cause) {
      if (mounted.current && generation === epoch.current) { conflict.current = cause.status === 409 && !!current.current; setError(conflict.current ? 'This conversation changed elsewhere. Your current messages remain here. Reload the saved conversation to resolve the conflict.' : officeAIError(cause)); }
    } finally { if (mounted.current && generation === epoch.current) { running.current = false; setSaving(false); } }
  }
  useEffect(() => {
    mounted.current = true; refresh();
    const reset = () => { epoch.current++; controllers.current.forEach(item => item.abort()); current.current = null; desired.current = []; saved.current = '[]'; clientId.current = null; running.current = false; conflict.current = false; suspended.current = false; setConversations([]); setCurrentId(null); setSavedAt(''); setSaving(false); setLoading(false); setError(''); refresh(); };
    window.addEventListener('office-token-changed', reset);
    return () => { mounted.current = false; epoch.current++; controllers.current.forEach(item => item.abort()); window.removeEventListener('office-token-changed', reset); };
  }, [apiBase, request]);
  useEffect(() => { desired.current = storedMessages(messages); if (JSON.stringify(desired.current) !== saved.current) pump(); }, [messages]);

  function newConversation() {
    epoch.current++; controllers.current.forEach(item => item.abort()); current.current = null; desired.current = []; saved.current = '[]'; clientId.current = null; running.current = false; conflict.current = false; suspended.current = false;
    setCurrentId(null); setSavedAt(''); setSaving(false); setError(''); beforeLoad(); setMessages([]);
  }
  async function open(id) {
    suspended.current = true; beforeLoad(); const generation = ++epoch.current; controllers.current.forEach(item => item.abort()); running.current = false; setSaving(false); setLoading(true); setError('');
    try {
      const result = await api(`/${encodeURIComponent(id)}`); if (!mounted.current || generation !== epoch.current) return;
      const conversation = result.conversation || result;
      if (!Array.isArray(conversation.messages)) throw Error('The saved conversation could not be loaded.');
      const list = conversation.messages.filter(item => ['user', 'assistant'].includes(item.role) && typeof item.content === 'string').map((item, index) => ({ ...item, id: `saved-${id}-${index}` }));
      current.current = conversation; desired.current = storedMessages(list); saved.current = JSON.stringify(desired.current); conflict.current = false; clientId.current = null;
      setCurrentId(id); setMessages(list); setSavedAt(conversation.updatedAt); remember(conversation);
    } catch (cause) { if (mounted.current && generation === epoch.current) setError(officeAIError(cause)); }
    finally { if (mounted.current && generation === epoch.current) { suspended.current = false; setLoading(false); } }
  }
  async function remove(id) {
    const generation = epoch.current; setLoading(true); setError('');
    try { await api(`/${encodeURIComponent(id)}`, { method: 'DELETE', body: { expectedVersion: current.current?.id === id ? current.current.version : conversations.find(item => item.id === id)?.version, confirmed: true } }); if (!mounted.current || generation !== epoch.current) return; setConversations(previous => previous.filter(item => item.id !== id)); if (current.current?.id === id) newConversation(); }
    catch (cause) { if (mounted.current && generation === epoch.current) setError(officeAIError(cause)); }
    finally { if (mounted.current) setLoading(false); }
  }
  function identity() { if (!clientId.current) clientId.current = crypto.randomUUID(); return current.current?.id || clientId.current; }
  return { conversations, currentId, saving, loading, error, savedAt, newConversation, open, remove, refresh, identity, retry: () => { setError(''); pump(); }, conflict: conflict.current };
}
