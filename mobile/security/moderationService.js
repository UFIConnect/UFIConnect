const REPORT_REASONS = Object.freeze([
  { value: 'child_safety', label: 'Child safety concern' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'other', label: 'Other' },
]);

function filterBlockedUsers(items, blockedIds, getUserId) {
  const blocked = new Set(blockedIds);
  return items.filter(item => !blocked.has(getUserId(item)));
}

// One store per signed-in session. It never persists tokens or account data.
function createModerationStore({ client, apiBase, token, viewerId }) {
  let snapshot = { blockedIds: [], loaded: !token, loading: false, error: '' };
  let disposed = false;
  let refreshVersion = 0;
  const localBlocks = new Set();
  const listeners = new Set();
  const pendingBlocks = new Map();
  const options = { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 };
  function update(next) {
    if (disposed) return;
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  }
  function requireSession() {
    if (typeof token !== 'string' || !token.trim() || disposed) throw new Error('Sign in again to use safety controls.');
  }
  function requireId(id) {
    if (typeof id !== 'string' || !id.trim()) throw new Error('This item is missing its account or content ID.');
    return id;
  }
  async function refresh() {
    if (!token || disposed) return;
    const version = ++refreshVersion;
    update({ loading: true, error: '' });
    try {
      const response = await client.get(`${apiBase}/users/blocked`, options);
      if (!Array.isArray(response.data?.users)) throw new Error('Invalid blocked-account response');
      if (version !== refreshVersion) return;
      const ids = response.data.users.map(user => user.id).filter(id => typeof id === 'string');
      update({ blockedIds: [...new Set([...ids, ...localBlocks])], loaded: true, loading: false });
    } catch {
      if (version === refreshVersion) update({ loading: false, error: 'Could not load blocked accounts. Please retry.' });
    }
  }
  async function report({ targetType, targetId, reason, details = '' }) {
    requireSession();
    requireId(targetId);
    if (!['post', 'user'].includes(targetType)) throw new Error('Choose a post or user to report.');
    if (!REPORT_REASONS.some(item => item.value === reason)) throw new Error('Choose a reason for your report.');
    const response = await client.post(`${apiBase}/reports`, {
      targetType, targetId, reason,
      details: typeof details === 'string' ? details.trim().slice(0, 1000) : '',
    }, options);
    if (response.data?.ok !== true) throw new Error('Your report was not confirmed. Please retry.');
  }
  function block(userId) {
    try { requireSession(); requireId(userId); }
    catch (error) { return Promise.reject(error); }
    if (userId === viewerId) return Promise.reject(new Error('You cannot block your own account.'));
    if (pendingBlocks.has(userId)) return pendingBlocks.get(userId);
    const operation = (async () => {
      const response = await client.post(`${apiBase}/users/${encodeURIComponent(userId)}/block`, {}, options);
      if (response.data?.ok !== true || response.data?.blocked !== true) throw new Error('The block was not confirmed. Please retry.');
      if (disposed) return;
      localBlocks.add(userId);
      update({ blockedIds: [...new Set([...snapshot.blockedIds, userId])] });
    })().finally(() => pendingBlocks.delete(userId));
    pendingBlocks.set(userId, operation);
    return operation;
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    refresh, report, block,
    resume() { disposed = false; },
    dispose() { disposed = true; refreshVersion++; listeners.clear(); },
  };
}

module.exports = { REPORT_REASONS, createModerationStore, filterBlockedUsers };
