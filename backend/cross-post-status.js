'use strict';

const { createHash } = require('node:crypto');

function targetsOf(value) {
  if (Array.isArray(value)) return value;
  try { const targets = JSON.parse(value || '[]'); return Array.isArray(targets) ? targets : []; }
  catch { return []; }
}

// Status checks never publish. Coalesce identical snapshots while preserving
// account boundaries, and compare-and-swap each saved receipt so an older
// poll cannot overwrite a newer publication or another platform's result.
function createCrossPostStatusSynchronizer({ db, publishingTargets, fetchTikTokStatus,
  refreshAccessToken, getCurrentUser, serializeRow, now = Date.now }) {
  const active = new Map();
  async function check(user, rows) {
    const warnings = new Set();
    const replacements = new Map();
    for (const row of rows) {
      const created = Date.parse(row.created_at);
      if (!Number.isFinite(created) || now() - created < 10 * 60000) continue;
      targetsOf(row.targets).forEach((target, index) => {
        if (target.status === 'processing' && !target.publishId && !target.providerId) {
          replacements.set(`${row.id}:${index}`, { ...target, status: 'handoff', deliveryUncertain: true,
            error: 'This delivery could not be confirmed. Review it at the source before trying again.' });
        }
      });
    }
    const pending = rows.flatMap(row => targetsOf(row.targets).map((target, index) => ({ row, target, index })))
      .filter(({ target }) => ['handoff', 'processing'].includes(target.status) && target.publishId
        && user.socialTokens?.[target.platform]
        && (target.platform === 'tiktok' || publishingTargets.canSync(target.platform)));
    const oldestCheckFirst = (a, b) => (Date.parse(a.target.statusCheckedAt) || 0) - (Date.parse(b.target.statusCheckedAt) || 0)
      || (Date.parse(a.row.created_at) || 0) - (Date.parse(b.row.created_at) || 0);
    const youtube = pending.filter(entry => entry.target.platform === 'youtube').sort(oldestCheckFirst).slice(0, 50);
    const other = pending.filter(entry => entry.target.platform !== 'youtube')
      .sort(oldestCheckFirst).slice(0, 10);
    const key = entry => `${entry.row.id}:${entry.index}`;
    async function readWithRenewal(platform, read) {
      const token = user.socialTokens[platform];
      try { return await read(token); }
      catch (error) {
        if (error.status !== 401 || typeof refreshAccessToken !== 'function') throw error;
        const renewed = await refreshAccessToken(user.id, platform, token);
        const current = renewed && await getCurrentUser(user.id);
        if (!current?.socialTokens?.[platform] || current.socialTokens[platform] !== renewed) throw error;
        return read(renewed);
      }
    }
    await Promise.all([
      (async () => {
        if (!youtube.length) return;
        try {
          const next = await readWithRenewal('youtube', token => typeof publishingTargets.syncMany === 'function'
            ? publishingTargets.syncMany('youtube', token, youtube.map(entry => entry.target))
            : Promise.all(youtube.map(entry => publishingTargets.sync('youtube', token, entry.target))));
          if (!Array.isArray(next) || next.length !== youtube.length) throw new Error('Invalid status batch');
          youtube.forEach((entry, index) => replacements.set(key(entry), next[index]));
        } catch {
          warnings.add('YouTube status could not be refreshed. Your accepted uploads have not been resent.');
        }
      })(),
      ...other.map(async entry => {
        try {
          const next = await readWithRenewal(entry.target.platform, token => entry.target.platform === 'tiktok'
            ? fetchTikTokStatus(token, entry.target.publishId, entry.target)
            : publishingTargets.sync(entry.target.platform, token, entry.target));
          replacements.set(key(entry), next);
        } catch {
          warnings.add('Some publishing statuses could not be refreshed. Accepted posts have not been resent.');
        }
      }),
    ]);
    const checks = await Promise.all(rows.map(async row => {
      const original = targetsOf(row.targets);
      const next = original.map((target, index) => {
        const replacement = replacements.get(`${row.id}:${index}`);
        return replacement ? { ...target, ...replacement, statusCheckedAt: replacement.statusCheckedAt || new Date(now()).toISOString() } : target;
      });
      if (JSON.stringify(original) === JSON.stringify(next)) return { row, updated: false };
      try {
        const saved = await db.query(`UPDATE cross_posts SET targets=$1 WHERE id=$2 AND user_id=$3 AND targets=$4::jsonb`,
          [JSON.stringify(next), row.id, user.id, JSON.stringify(original)]);
        if (saved.rowCount === 0) {
          const current = await db.query('SELECT targets FROM cross_posts WHERE id=$1 AND user_id=$2', [row.id, user.id]);
          return { row: current.rows[0] ? { ...row, targets: current.rows[0].targets } : row, updated: false };
        }
        return { row: { ...row, targets: next }, updated: true };
      } catch {
        warnings.add('Some publishing statuses could not be saved. Refresh again; accepted posts have not been resent.');
        return { row, updated: false };
      }
    }));
    return { posts: checks.map(result => serializeRow(result.row)), updated: checks.filter(result => result.updated).length,
      ...(warnings.size ? { warnings: [...warnings], retryAfterMs: 30000 } : {}) };
  }
  return async function synchronize(user, rows) {
    const platforms = [...new Set(rows.flatMap(row => targetsOf(row.targets).map(target => target.platform)))].sort();
    const snapshot = createHash('sha256').update(JSON.stringify(rows.map(row => [row.id, row.targets])))
      .update(JSON.stringify(platforms.map(platform => user.socialTokens?.[platform] || ''))).digest('hex');
    const key = `${user.id}:${snapshot}`;
    if (active.has(key)) return active.get(key);
    const work = check(user, rows);
    // Bound the coalescing registry during bursts; uncached checks still use
    // the durable per-row compare-and-swap above.
    if (active.size < 200) {
      active.set(key, work);
      void work.finally(() => { if (active.get(key) === work) active.delete(key); }).catch(() => {});
    }
    return work;
  };
}

module.exports = { createCrossPostStatusSynchronizer };
