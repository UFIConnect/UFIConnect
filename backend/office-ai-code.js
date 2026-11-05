'use strict';
const problem = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
function createOfficeAICode({ env = process.env, fetcher = globalThis.fetch } = {}) {
  function connection() {
    let url;
    try { url = new URL(env.OFFICE_AI_RELAY_URL); } catch { return null; }
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.workers.dev') || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/'
      || typeof env.OFFICE_AI_RELAY_SECRET !== 'string' || env.OFFICE_AI_RELAY_SECRET.length < 32) return null;
    return url.origin;
  }
  async function execute({ code, input = {} }, { signal } = {}) {
    const origin = connection();
    if (!origin) throw problem(503, 'Connect the Cloudflare AI relay to use code execution.');
    if (typeof code !== 'string' || !code.trim() || code.length > 24000 || code.includes('\0') || JSON.stringify(input).length > 64000) throw problem(400, 'Provide bounded JavaScript and JSON input.');
    let response;
    try { response = await fetcher(`${origin}/execute`, { method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${env.OFFICE_AI_RELAY_SECRET}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, input }), signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(10000)]) }); }
    catch { throw problem(502, 'Cloudflare did not return a code execution receipt.'); }
    const body = await response.json().catch(() => null);
    if (!response.ok) throw problem([400,413,422,429,503].includes(response.status) ? response.status : 502,
      typeof body?.error?.message === 'string' ? body.error.message.slice(0,400) : 'Cloudflare could not execute the code.');
    if (body?.runtime !== 'Cloudflare Dynamic Worker' || body.network !== false || !Object.hasOwn(body,'result')
      || !Array.isArray(body.logs) || JSON.stringify(body).length > 42000) throw problem(502, 'Cloudflare returned an invalid execution receipt.');
    return body;
  }
  return { execute, configured: () => !!connection(), tool: { permission: 'read', retrySafe: true,
    description: 'Run JavaScript in an isolated Cloudflare sandbox for accurate math, calculations, CSV/JSON data analysis, algorithms, and testing small functions. Receives input as JSON; return the result. No network, host filesystem, credentials, or Office commands. CPU 100ms, wall time 2 seconds. Use workspace_write separately to save generated files.',
    parameters: { type:'object', properties:{code:{type:'string',maxLength:24000},input:{type:'object',additionalProperties:true}}, required:['code'],additionalProperties:false },
    execute: (args, context) => execute(args,context) } };
}
module.exports = { createOfficeAICode };
