'use strict';

const { randomUUID } = require('node:crypto');
const failure = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const CONTENT_KINDS = Object.freeze(['post', 'caption', 'article', 'email', 'product-description', 'hashtags']);
const TONES = Object.freeze(['professional', 'friendly', 'calm', 'playful']);

function validateBody(body, fields) {
  if (!object(body) || Object.keys(body).some(key => !fields.includes(key))) throw failure(400, 'Send supported JSON generation options.');
  if (Buffer.byteLength(JSON.stringify(body)) > 64000) throw failure(413, 'Send up to 64 KB of text.');
  const maxTokens = body.max_tokens ?? 1024;
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1000 || maxTokens > 4096) throw failure(400, 'max_tokens must be an integer from 1000 to 4096.');
  return maxTokens;
}

function chatInput(body) {
  const maxTokens = validateBody(body, ['messages', 'max_tokens']);
  if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 24
    || body.messages.some(message => !object(message) || Object.keys(message).some(key => !['role', 'content'].includes(key))
      || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim())
    || body.messages.reduce((sum, message) => sum + message.content.length, 0) > 32000
    || body.messages.at(-1).role !== 'user') throw failure(400, 'Send up to 24 text messages and 32,000 characters, ending with a user message.');
  return { messages: [{ role: 'system', content: 'You are Pip, the UFIConnect assistant. Answer using the supplied conversation only. You have no access to Office controls, private workspace data, saved memory, external tools, or current web research in this API. Never claim to have executed external actions.' },
    ...body.messages.map(message => ({ role: message.role, content: message.content }))], maxTokens };
}

function contentInput(body) {
  const maxTokens = validateBody(body, ['prompt', 'kind', 'tone', 'platform', 'max_tokens']);
  const kind = body.kind ?? 'post', tone = body.tone ?? 'professional';
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 12000) throw failure(400, 'prompt must contain 1 to 12,000 characters.');
  if (!CONTENT_KINDS.includes(kind)) throw failure(400, 'Choose post, caption, article, email, product-description, or hashtags.');
  if (!TONES.includes(tone)) throw failure(400, 'Choose a supported tone.');
  if (body.platform !== undefined && (typeof body.platform !== 'string' || !body.platform.trim() || body.platform.length > 80)) throw failure(400, 'platform must contain 1 to 80 characters.');
  return { kind, maxTokens, messages: [
    { role: 'system', content: `You are the UFIConnect content assistant. Write the requested ${kind} in a ${tone} tone. Return the draft directly. Do not claim publication or access to private Office data, tools, or current web research. Do not invent verified facts or citations.` },
    { role: 'user', content: `${body.platform ? 'Intended platform: ' + JSON.stringify(body.platform) + '\n' : ''}${body.prompt.trim()}` },
  ] };
}

function registerAPIAIRoutes(app, { apiKeys, complete, refreshConnections = async () => {} }) {
  function handler(scope, validate) {
    return async (req, res) => {
      const controller = new AbortController();
      const disconnected = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', disconnected);
      try {
        const input = validate(req.body);
        await refreshConnections();
        if (controller.signal.aborted) return;
        const budget = await apiKeys.consumeGeneration(req.ufiApiKey.id, scope);
        const result = await complete({ messages: input.messages, tools: [], maxTokens: input.maxTokens, signal: controller.signal });
        if (typeof result?.content !== 'string' || !result.content.trim() || result.tool_calls?.length) throw failure(502, 'The AI provider returned no usable text.');
        if (controller.signal.aborted) return;
        const created = Math.floor(Date.now() / 1000);
        if (scope === 'ai:chat') return res.json({ id: 'chatcmpl_' + randomUUID(), object: 'chat.completion', created,
          model: 'uficonnect-chat', choices: [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: null }], budget });
        return res.json({ id: 'content_' + randomUUID(), created, kind: input.kind, content: result.content, budget });
      } catch (error) {
        if (error.status === 429 && !res.headersSent) {
          const now = new Date();
          res.set('Retry-After', String(Math.max(1, Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000))));
        }
        if (!controller.signal.aborted && !res.headersSent) res.status(error.publicMessage ? error.status || 502 : 502)
          .json({ error: error.publicMessage || 'AI generation is temporarily unavailable. Check provider connections in Office.' });
      } finally { res.removeListener('close', disconnected); }
    };
  }
  app.post('/api/v1/chat/completions', apiKeys.privateResponse, apiKeys.requestLimit, apiKeys.authenticate('ai:chat'), handler('ai:chat', chatInput));
  app.post('/api/v1/content/generations', apiKeys.privateResponse, apiKeys.requestLimit, apiKeys.authenticate('content:generate'), handler('content:generate', contentInput));
}

module.exports = { registerAPIAIRoutes, chatInput, contentInput, CONTENT_KINDS, TONES };
