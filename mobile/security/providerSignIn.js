const CALLBACK = 'uficonnect://auth/callback';
const PENDING_KEY = 'uficonnect.provider-signin';
const MAX_AGE = 10 * 60 * 1000;
const OPAQUE = /^[A-Za-z0-9_-]{32,256}$/;
const PROVIDERS = ['google', 'apple'];

function parseProviderCallback(url) {
  if (typeof url !== 'string' || !url.startsWith(CALLBACK + '#')) return null;
  const fragment = url.slice(CALLBACK.length + 1);
  if (/^code=[A-Za-z0-9_-]{32,256}$/.test(fragment)) return { code: fragment.slice(5) };
  if (/^error=[a-z_]{1,80}$/.test(fragment)) return { error: fragment.slice(6) };
  return null;
}

function validAuthorizationUrl(value, provider, apiBase) {
  if (typeof value !== 'string') return false;
  const providerOrigin = provider === 'google' ? 'https://accounts.google.com/' : 'https://appleid.apple.com/';
  return value.startsWith(providerOrigin) || value.startsWith(`${apiBase}/auth/providers/${provider}/`);
}

// The one-time code travels in a deep link; its verifier stays in the OS store.
// Neither is sent to analytics, logged, or stored in AsyncStorage.
function createProviderSignIn({ post, store, openURL, acceptSession, discardSession = async () => {}, canAccept = () => true, apiBase, now = Date.now }) {
  let generation = 0, processing = false;
  let state = { busy: false, phase: 'idle', error: '' };
  const listeners = new Set(), handled = new Set();
  const emit = next => { state = next; for (const listener of listeners) listener(state); };
  const isPending = value => value && PROVIDERS.includes(value.provider) && OPAQUE.test(value.verifier || '') && Number.isFinite(value.createdAt) && now() - value.createdAt >= 0 && now() - value.createdAt < MAX_AGE;
  async function cancel() {
    generation++;
    await store.clear();
    emit({ busy: false, phase: 'idle', error: '' });
  }
  return {
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    async restore() {
      const operation = generation;
      try {
        const pending = await store.read();
        if (operation !== generation || processing) return;
        if (isPending(pending) && canAccept()) emit({ busy: true, phase: 'browser', error: '' });
        else if (pending) await store.clear();
      } catch { emit({ busy: false, phase: 'idle', error: 'Secure sign-in storage is unavailable. Please try again.' }); }
    },
    async start(provider, mode) {
      if (!PROVIDERS.includes(provider) || !['login', 'signup'].includes(mode)) throw new Error('Choose an available sign-in method.');
      if (state.busy || processing || !canAccept()) return;
      const operation = ++generation;
      emit({ busy: true, phase: 'starting', error: '' });
      try {
        await store.clear();
        const result = await post(`/auth/providers/${provider}/start`, { client: 'native', mode });
        if (operation !== generation) return;
        const url = result.authorizationUrl || result.url;
        if (!OPAQUE.test(result.verifier || '') || !validAuthorizationUrl(url, provider, apiBase)) throw new Error('Invalid sign-in response.');
        await store.write({ provider, verifier: result.verifier, createdAt: now() });
        if (operation !== generation) { await store.clear(); return; }
        emit({ busy: true, phase: 'browser', error: '' });
        await openURL(url);
      } catch {
        if (operation === generation) {
          await store.clear().catch(() => {});
          emit({ busy: false, phase: 'idle', error: 'This sign-in method could not start. Please try again or use email.' });
        }
      }
    },
    async open(url) {
      const callback = parseProviderCallback(url);
      if (!callback) return false;
      if (processing || handled.has(url)) return true;
      if (!canAccept()) { await store.clear().catch(() => {}); return true; }
      const operation = generation;
      processing = true;
      handled.add(url); if (handled.size > 8) handled.delete(handled.values().next().value);
      try {
        const pending = await store.read();
        if (operation !== generation) return true;
        if (!isPending(pending)) throw new Error('Expired sign-in.');
        await store.clear();
        if (operation !== generation) return true;
        if (callback.error) throw new Error('Sign-in was cancelled.');
        emit({ busy: true, phase: 'finishing', error: '' });
        const session = await post('/auth/providers/finish', { code: callback.code, verifier: pending.verifier });
        if (operation !== generation || !canAccept()) { await discardSession(session).catch(() => {}); return true; }
        await acceptSession(session);
        if (operation === generation) emit({ busy: false, phase: 'idle', error: '' });
      } catch {
        if (operation === generation) {
          await store.clear().catch(() => {});
          const messages = { cancelled: 'Sign-in was cancelled. You can try again.', account_exists: 'An account already uses this email. Sign in with your existing method.', unavailable: 'This sign-in method is currently unavailable. Please use another method.' };
          emit({ busy: false, phase: 'idle', error: messages[callback.error] || 'Sign-in did not finish. Start again or use another sign-in method.' });
        }
      } finally { processing = false; }
      return true;
    },
    cancel,
  };
}

module.exports = { CALLBACK, PENDING_KEY, parseProviderCallback, validAuthorizationUrl, createProviderSignIn };
