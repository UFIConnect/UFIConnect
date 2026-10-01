import { randomBytes } from 'node:crypto';

// This protects explicit local VPN actions from replay. It does not prove
// hardware identity, prevent device cloning, or replace the Origin/CSRF checks.
export function createVpnChallenges({ now = Date.now, random = () => randomBytes(32).toString('hex') } = {}) {
  const pending = new Map();
  function prune() { for (const [key, value] of pending) if (value.expiresAt <= now()) pending.delete(key); }
  return {
    issue({ action, profileId, origin }) {
      prune();
      if (!['connect', 'disconnect'].includes(action) || !/^[a-f0-9]{32}$/.test(profileId || '') || !origin) return null;
      if (pending.size >= 20) return null;
      const nonce = random();
      const expiresAt = now() + 30000;
      pending.set(nonce, { action, profileId, origin, expiresAt });
      return { nonce, expiresAt: new Date(expiresAt).toISOString() };
    },
    consume({ nonce, action, profileId, origin }) {
      prune();
      if (typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce)) return false;
      const challenge = pending.get(nonce);
      pending.delete(nonce); // Even a mismatched use burns the challenge.
      return Boolean(challenge && challenge.action === action && challenge.profileId === profileId && challenge.origin === origin);
    },
  };
}
