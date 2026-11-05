import { createHash, timingSafeEqual } from 'node:crypto';

const MAX_BODY = 4 * 1024 * 1024;
const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
const failure = (status, code, message) => json({ error: { code, message } }, status);
function authenticated(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ') || authorization.length > 256) return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(authorization.slice(7)), digest(secret));
}
async function bodyJson(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) throw Object.assign(Error('Send JSON.'), { status: 415 });
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw Object.assign(Error('Request too large.'), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(Error('A JSON body is required.'), { status: 400 });
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw Object.assign(Error('Request too large.'), { status: 413 }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw Object.assign(Error('Invalid JSON.'), { status: 400 }); }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw Object.assign(Error('A JSON object is required.'), { status: 400 });
  return body;
}
const invalid = message => { throw Object.assign(Error(message), { status: 400 }); };
let activeExecutions = 0;
export async function executeCode(body, env) {
  if (!env.LOADER?.load) throw Object.assign(Error('The Cloudflare code runtime is not connected.'), { status: 503 });
  if (Object.keys(body).some(key => !['code', 'input'].includes(key)) || typeof body.code !== 'string'
    || !body.code.trim() || body.code.length > 24000 || body.code.includes('\0')) invalid('Provide JavaScript up to 24,000 characters with a return statement.');
  const input = body.input ?? {};
  if (JSON.stringify(input).length > 64000) invalid('Code input may contain up to 64,000 JSON characters.');
  if (activeExecutions >= 2) throw Object.assign(Error('The code runtime is busy. Retry shortly.'), { status: 429 });
  activeExecutions++;
  let timer;
  try {
    const sandbox = env.LOADER.load({ compatibilityDate: '2026-11-04', mainModule: 'code.js',
      modules: { 'code.js': `import { WorkerEntrypoint } from 'cloudflare:workers';
        export class Code extends WorkerEntrypoint {
          async run(input) {
            const logs = [];
            const format = value => { try { return typeof value === 'string' ? value : JSON.stringify(value); } catch { return '[unserializable]'; } };
            const console = Object.fromEntries(['log','info','warn','error'].map(level => [level, (...values) => {
              if (logs.length < 32) logs.push(values.map(format).join(' ').slice(0, 1000));
            }]));
            const result = await (async (input) => { ${body.code}\n })(input);
            return { result: result === undefined ? null : result, logs };
          }
        }` },
      env: {}, globalOutbound: null, limits: { cpuMs: 100, subRequests: 1 },
    });
    const output = await Promise.race([sandbox.getEntrypoint('Code').run(input),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error('Code execution exceeded its two-second limit.'), { status: 422 })), 2000); })]);
    const encoded = JSON.stringify(output);
    if (typeof encoded !== 'string' || encoded.length > 40000) throw Object.assign(Error('Return a smaller result; execution output is limited to 40,000 characters.'), { status: 413 });
    return { ...JSON.parse(encoded), runtime: 'Cloudflare Dynamic Worker', network: false, cpuLimitMs: 100 };
  } finally { clearTimeout(timer); activeExecutions--; }
}
function validateMessages(messages) {
  let imageCount = 0, imageBytes = 0, textBytes = 0;
  for (const message of messages) {
    if (!message || !['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role)) invalid('Invalid message role.');
    if (typeof message.content === 'string') { textBytes += new TextEncoder().encode(message.content).length; continue; }
    if (message.role === 'assistant' && message.content == null && Array.isArray(message.tool_calls)) continue;
    if (message.role !== 'user' || !Array.isArray(message.content) || !message.content.length || message.content.length > 16) invalid('Messages must contain text or uploaded photos.');
    for (const part of message.content) {
      if (part?.type === 'text' && typeof part.text === 'string' && Object.keys(part).every(key => ['type', 'text'].includes(key))) {
        textBytes += new TextEncoder().encode(part.text).length; continue;
      }
      if (part?.type !== 'image_url' || Object.keys(part).some(key => !['type', 'image_url'].includes(key))
        || !part.image_url || Object.keys(part.image_url).some(key => key !== 'url') || typeof part.image_url.url !== 'string') invalid('Invalid photo content.');
      const match = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.image_url.url);
      if (!match || match[1].length % 4) invalid('Photos must be uploaded JPEG, PNG, or WebP files.');
      const bytes = match[1].length / 4 * 3 - (match[1].endsWith('==') ? 2 : match[1].endsWith('=') ? 1 : 0);
      imageCount++; imageBytes += bytes;
      if (bytes > 512 * 1024 || imageCount > 4 || imageBytes > 2 * 1024 * 1024) invalid('Photo capacity exceeded.');
    }
  }
  if (textBytes > 524288) throw Object.assign(Error('Text context is too large.'), { status: 413 });
}
function gateway(body) {
  const id = body.gatewayId || 'default';
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) invalid('Invalid gateway.');
  return id;
}
export function completion(result, model) {
  if (Array.isArray(result?.choices)) return result;
  const toolCalls = Array.isArray(result?.tool_calls) ? result.tool_calls.map((call, index) => ({
    id: call.id || `call_${index}`, type: 'function', function: {
      name: call.function?.name || call.name,
      arguments: typeof (call.function?.arguments ?? call.arguments) === 'string' ? (call.function?.arguments ?? call.arguments) : JSON.stringify(call.function?.arguments ?? call.arguments ?? {}),
    },
  })) : undefined;
  return { object: 'chat.completion', model, choices: [{ index: 0, message: {
    role: 'assistant', content: typeof result?.response === 'string' ? result.response : null,
    ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
  }, finish_reason: toolCalls?.length ? 'tool_calls' : 'stop' }], ...(result?.usage ? { usage: result.usage } : {}) };
}
export default {
  async fetch(request, env) {
    if (!authenticated(request, env.OFFICE_AI_RELAY_SECRET)) return failure(401, 'unauthorized', 'Authentication required.');
    const route = new URL(request.url).pathname;
    if (route === '/health' && request.method === 'GET') return json({ ok: !!env.AI, configured: !!env.AI, service: 'office-ai-relay', version: 3, thinkingSupported: true, maxOutputTokens: 8192, codeExecution: !!env.LOADER?.load });
    if (!['/chat', '/search', '/execute'].includes(route)) return failure(404, 'not_found', 'Unknown operation.');
    if (request.method !== 'POST') return failure(405, 'method_not_allowed', 'Use POST.');
    let body;
    try { body = await bodyJson(request); } catch (error) { return failure(error.status || 400, 'invalid_request', error.message); }
    try {
      if (route === '/execute') {
        try { return json(await executeCode(body, env)); }
        catch (error) { return failure(error.status || 422, 'execution_failed', String(error.message || 'The code could not execute.').slice(0, 400)); }
      }
      const gatewayId = gateway(body);
      if (!env.AI) return failure(503, 'not_configured', 'Workers AI is not configured.');
      if (route === '/search') {
        if (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 2000) invalid('Search query must contain 1 to 2000 characters.');
        const limit = body.limit ?? 5;
        if (!Number.isInteger(limit) || limit < 1 || limit > 10) invalid('Search limit must be between 1 and 10.');
        const provider = body.provider || 'exa';
        if (!['exa', 'ceramic'].includes(provider)) invalid('Unsupported search provider.');
        const response = await env.AI.websearch({ gatewayId, query: body.query.trim(), provider, limit });
        if (!response.ok) {
          const upstream = await response.json().catch(() => ({}));
          return json({ error: { code: 'search_unavailable', message: 'Cloudflare web search is unavailable. Check gateway credits and search configuration.',
            upstreamStatus: response.status, upstreamCodes: (upstream.errors || []).map(item => item.code).filter(code => Number.isFinite(code)) } }, response.status === 429 ? 429 : 502);
        }
        return json(await response.json());
      }
      const model = body.model || DEFAULT_MODEL;
      if (typeof model !== 'string' || model.length > 160 || !/^(?:@cf\/)?[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:/-]*$/i.test(model)) invalid('Invalid model.');
      if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 80) invalid('Provide between 1 and 80 messages.');
      validateMessages(body.messages);
      const maxTokens = body.max_tokens ?? 2048;
      if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) invalid('Invalid output limit.');
      if (body.temperature != null && (!Number.isFinite(body.temperature) || body.temperature < 0 || body.temperature > 2)) invalid('Invalid temperature.');
      if (body.tools != null && (!Array.isArray(body.tools) || body.tools.length > 64 || body.tools.some(tool => tool?.type !== 'function' || !/^[a-z0-9_-]{1,64}$/i.test(tool?.function?.name || '')))) invalid('Invalid tools.');
      if (body.chat_template_kwargs !== undefined && (!body.chat_template_kwargs || Array.isArray(body.chat_template_kwargs)
        || typeof body.chat_template_kwargs !== 'object' || Object.keys(body.chat_template_kwargs).some(key => key !== 'enable_thinking')
        || typeof body.chat_template_kwargs.enable_thinking !== 'boolean')) invalid('Invalid thinking options.');
      const inputs = { messages: body.messages, max_tokens: maxTokens, stream: false,
        ...(body.chat_template_kwargs ? { chat_template_kwargs: { enable_thinking: body.chat_template_kwargs.enable_thinking } } : {}),
        ...(body.tools?.length ? { tools: body.tools } : {}), ...(body.temperature != null ? { temperature: body.temperature } : {}) };
      const result = await env.AI.run(model, inputs, { gateway: { id: gatewayId, skipCache: true, collectLog: false } });
      return json(completion(result, model));
    } catch (error) {
      if ([400,401,402,403,413].includes(error.status)) return failure(error.status, 'provider_rejected', 'Cloudflare rejected the request. Check the inputs, model, connection, and gateway credits.');
      return failure(error.status === 429 ? 429 : 502, 'provider_unavailable', 'Cloudflare AI could not complete this request. Check the model, gateway credits, and service availability.');
    }
  },
};
