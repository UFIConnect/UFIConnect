'use strict';

// A refresh token may be single-use. The store serializes transactions across
// workers; the map also coalesces simultaneous requests in this process.
function createConnectedTokenRefresher({ withAccount, exchange, persist }) {
  const pending = new Map();
  return function refresh(userId, platform, rejectedToken) {
    const key = `${userId}:${platform}`;
    if (pending.has(key)) return pending.get(key);
    const task = Promise.resolve().then(() => withAccount(userId, async (user, store) => {
      const current = user?.socialTokens?.[platform];
      if (!current) return null; // A disconnected account must stay disconnected.
      if (rejectedToken && current !== rejectedToken) return current;
      const refreshToken = user.socialRefreshTokens?.[platform];
      if (!refreshToken) return null;
      const next = await exchange(platform, current, refreshToken);
      if (!next?.accessToken) return null;
      await persist(user, platform, next.accessToken, next.refreshToken || refreshToken, store, next.grantedScopes);
      return next.accessToken;
    })).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}

module.exports = { createConnectedTokenRefresher };
