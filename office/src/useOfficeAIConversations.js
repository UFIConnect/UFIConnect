import { useEffect, useRef, useState } from 'react';
import { officeAIRequest, officeAIError } from './office-ai-client';

function storedMessages(messages) {
  return messages.map(({ role, content, sources, research, actions, model, generatedAt }) => ({ role, content: content.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''),
    ...(role === 'assistant' ? { sources, research, actions, model, generatedAt } : {}) }));
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
        const sameContent = received.length === snapshot.length && received.every((item, index) => item.role === snapshot[index].role && item.content === snapshot[index].content);
        current.current = conversation; saved.current = sameContent ? signature : JSON.stringify(received); setCurrentId(conversation.id); setSavedAt(conversation.updatedAt || new Date().toISOString()); remember(conversation);
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
  return { conversations, currentId, saving, loading, error, savedAt, newConversation, open, remove, refresh, retry: () => { setError(''); pump(); }, conflict: conflict.current };
}
