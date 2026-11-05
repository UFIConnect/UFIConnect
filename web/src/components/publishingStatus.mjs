const POLL_DELAYS = [3000, 5000, 10000, 30000];
const RECEIPT_STATUSES = new Set(['processing', 'handoff', 'posted', 'failed']);

export function crossPostRequestConfig(mediaType) {
  return mediaType === 'video' ? { timeout: 360000 } : {};
}

export function pendingPublishingKey(posts = []) {
  return [...new Set(posts.filter(post => post?.id && post.targets?.some(target => target.status === 'processing'
    || target.status === 'handoff' && ['youtube', 'tiktok'].includes(target.platform) && Boolean(target.publishId))).map(post => String(post.id)))].sort().join('|');
}

function mergeTarget(current, incoming) {
  if (!incoming || !RECEIPT_STATUSES.has(incoming.status) || !['processing', 'handoff'].includes(current.status)) return current;
  if (current.publishId && incoming.publishId && current.publishId !== incoming.publishId) return current;
  if (current.providerId && incoming.providerId && current.providerId !== incoming.providerId) return current;
  const currentTime = Date.parse(current.statusCheckedAt), nextTime = Date.parse(incoming.statusCheckedAt);
  if (Number.isFinite(currentTime) && !Number.isFinite(nextTime) && ['processing', 'handoff'].includes(incoming.status)) return current;
  if (Number.isFinite(currentTime) && Number.isFinite(nextTime) && nextTime < currentTime) return current;
  const { error, reconnectRequired, deliveryUncertain, ...previous } = current;
  return { ...previous, ...incoming };
}

export function mergePublishingResults(results, batchId, posts = []) {
  if (!results || !batchId) return results;
  const post = posts.find(row => row?.id === batchId);
  if (!post || !Array.isArray(post.targets)) return results;
  return results.map(target => mergeTarget(target, post.targets.find(next => next.platform === target.platform)));
}

export function mergePublishingHistory(current = [], incoming = []) {
  const previous = new Map((current || []).map(post => [post.id, post]));
  const posts = new Map(previous);
  for (const post of incoming) {
    if (!post?.id || !Array.isArray(post.targets)) continue;
    const old = previous.get(post.id);
    posts.set(post.id, old ? { ...old, ...post, targets: [...post.targets.map(target => {
      const existing = old.targets?.find(value => value.platform === target.platform);
      return existing ? mergeTarget(existing, target) : target;
    }), ...(old.targets || []).filter(target => !post.targets.some(value => value.platform === target.platform))] } : post);
  }
  return [...posts.values()].sort((left, right) => (Date.parse(right.createdAt) || 0) - (Date.parse(left.createdAt) || 0)).slice(0, 50);
}

export function publishingProcessingMessage(target) {
  if (target?.status !== 'processing') return '';
  if (target.platform !== 'youtube') return 'Processing';
  if (!target.publishId && !target.providerId) return 'Sending video to YouTube.';
  const progress = target.processingProgress;
  return `Uploaded to YouTube. Processing${Number.isFinite(progress) && progress >= 0 && progress <= 100 ? ` (${Math.round(progress)}%)` : ''}.`;
}

export function publishingReceiptLink(target) {
  if (!target?.postedUrl || !['posted', 'processing', 'handoff'].includes(target.status)) return null;
  try {
    const url = new URL(target.postedUrl, 'https://uficonnect.org');
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (target.platform === 'youtube' && (!['youtube.com', 'www.youtube.com'].includes(url.hostname)
      || url.pathname !== '/watch' || !/^[A-Za-z0-9_-]{6,64}$/.test(url.searchParams.get('v') || ''))) return null;
    return { href: url.href, label: target.status === 'posted' ? 'View post' : target.platform === 'youtube' ? 'View on YouTube' : 'View at source' };
  } catch { return null; }
}

function retryAfterMs(error, now) {
  const raw = error?.response?.headers?.['retry-after'];
  if (!raw) return 0;
  const seconds = Number(raw);
  const value = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - now;
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 300000)) : 0;
}

// This checks existing receipts only. The publishing request is never retried.
export function createPublishingStatusPolling({ request, onPosts, onState = () => {}, isCurrent = () => true,
  isPending = () => false, document: page = globalThis.document, window: host = globalThis.window,
  schedule = setTimeout, unschedule = clearTimeout, now = Date.now } = {}) {
  let active = true, timer = null, flight = null, attempts = 0, failures = 0, retryAt = 0;
  const current = () => active && isCurrent();
  const visible = () => !page?.hidden;
  const clearTimer = () => { if (timer !== null) unschedule(timer); timer = null; };
  const arm = delay => {
    clearTimer();
    if (current() && visible() && isPending()) timer = schedule(() => { timer = null; void run(); }, delay);
  };
  async function run(manual = false) {
    if (!current() || !visible() || !manual && !isPending()) return;
    if (flight) return flight.promise;
    clearTimer();
    const operation = { controller: new AbortController(), promise: null };
    flight = operation;
    const valid = () => current() && flight === operation && !operation.controller.signal.aborted;
    onState({ syncing: true });
    operation.promise = (async () => {
      let delay;
      try {
        const data = await request(operation.controller.signal);
        if (!valid()) return;
        if (!Array.isArray(data?.posts)) throw new Error('Invalid publishing status response.');
        attempts++;
        onPosts(data.posts);
        delay = POLL_DELAYS[Math.min(attempts, POLL_DELAYS.length - 1)];
        const warnings = Array.isArray(data.warnings) ? data.warnings.filter(value => typeof value === 'string').slice(0, 3) : [];
        if (warnings.length) {
          failures++;
          delay = Math.max(delay, Math.min(300000, Math.max(30000, Number(data.retryAfterMs) || 0)));
          retryAt = now() + delay;
        } else { failures = 0; retryAt = 0; }
        onState({ error: warnings.map(value => value.slice(0, 300)).join(' '), lastCheckedAt: new Date(now()).toISOString() });
      } catch (error) {
        if (!valid()) return;
        failures++;
        delay = Math.max(POLL_DELAYS[Math.min(attempts + failures, POLL_DELAYS.length - 1)],
          Math.min(120000, 5000 * 2 ** Math.min(failures, 5)), retryAfterMs(error, now()));
        retryAt = now() + delay;
        onState({ error: 'Status updates are delayed. Your upload has not been resent. We will keep checking; you can also refresh results.' });
      } finally {
        if (flight === operation) flight = null;
        if (current()) { onState({ syncing: false }); arm(delay ?? POLL_DELAYS[0]); }
      }
    })();
    return operation.promise;
  }
  const wake = () => {
    if (!current() || !visible() || !isPending()) { clearTimer(); return; }
    if (flight) return;
    if (retryAt > now()) arm(retryAt - now());
    else arm(0);
  };
  page?.addEventListener('visibilitychange', wake);
  host?.addEventListener('focus', wake);
  arm(POLL_DELAYS[0]);
  return {
    refresh: () => run(true),
    update() { if (!isPending()) clearTimer(); else if (!flight && timer === null) arm(POLL_DELAYS[0]); },
    close() {
      active = false; clearTimer(); flight?.controller.abort();
      page?.removeEventListener('visibilitychange', wake);
      host?.removeEventListener('focus', wake);
    },
  };
}
