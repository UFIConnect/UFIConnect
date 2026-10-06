'use strict';
const LIFETIME_MS = 180000;
function parseVpnLaunch(url) {
  if (typeof url !== 'string') return null;
  // Exact canonical 32-byte base64url nonce. No credentials, fragments,
  // alternate hosts, duplicate parameters, escapes, or extra fields.
  const match = /^uficonnect-vpn:\/\/connect\?code=([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/.exec(url);
  return match ? match[1] : null;
}
function createVpnLaunch({consume, now = Date.now, platform}) {
  let token = null, ready = false, generation = 0, sequence = 0;
  let pending = null, request = null, running = false;
  const seen = new Map(), listeners = new Set();
  const emit = event => { for (const listener of listeners) listener(event); };
  function bindSession(nextToken, nextReady) {
    if (token !== nextToken) {
      generation++; request = null;
      // A signed-out launch can wait for login. A previous signed-in account's
      // launch must never carry over to another account or session.
      if (token) pending = null;
    }
    token = nextToken || null; ready = Boolean(nextReady);
  }
  async function flush() {
    if (!pending || !token || !ready || running) return;
    if (now() - pending.receivedAt >= LIFETIME_MS) { pending = null; emit({type:'expired'}); return; }
    const intent = pending, session = token, epoch = generation;
    pending = null; running = true;
    try {
      const result = await consume(intent.code, platform, session);
      if (epoch !== generation || token !== session || !ready) return;
      if (now() - intent.receivedAt >= LIFETIME_MS || result?.action !== 'connect') {
        emit({type:'expired'}); return;
      }
      request = {id:String(++sequence),token:session,receivedAt:intent.receivedAt};
      emit({type:'request',id:request.id});
    } catch {
      if (epoch === generation && token === session) emit({type:'failed'});
    } finally { running = false; if (pending) void flush(); }
  }
  function open(url) {
    const code = parseVpnLaunch(url);
    if (!code || platform !== 'android') return false;
    for (const [value, at] of seen) if (now() - at >= LIFETIME_MS) seen.delete(value);
    if (seen.has(code)) return false;
    if (seen.size >= 128) { emit({type:'failed'}); return false; }
    seen.set(code,now()); generation++; request = null;
    pending = {code,receivedAt:now()}; void flush();
    return true;
  }
  function claim(id, session) {
    if (!request || request.id !== id || request.token !== session || token !== session || !ready) return false;
    const valid = now() - request.receivedAt < LIFETIME_MS;
    request = null;
    return valid;
  }
  return {open, bindSession, flush, claim, subscribe(listener) {listeners.add(listener);return () => listeners.delete(listener);}};
}
module.exports = {parseVpnLaunch,createVpnLaunch};
