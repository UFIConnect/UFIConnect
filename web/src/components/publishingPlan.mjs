import { publishingUnavailableReason } from './publishingAvailability.mjs';
import { composerTextLimit, readSessionDraft } from '../utils/publishingDraft.mjs';

export function publishingPlan(selected, { accounts = {}, connected = {}, plan, media, content = '',
  loading = false, optionReasons = {}, extraReasons = {}, localReason = '', localTextLimit = 2000 } = {}) {
  const ready = [], pending = [];
  for (const platform of new Set(selected || [])) {
    const local = platform === 'local' || platform === 'uficonnect';
    const limit = platform === 'local' ? localTextLimit : composerTextLimit([platform], media).limit;
    const reason = local ? (platform === 'local' ? localReason : '') || extraReasons[platform] || ''
      : loading ? 'Checking connected accounts.'
        : publishingUnavailableReason(accounts[platform], { connected: Boolean(connected[platform]), plan, media })
          || optionReasons[platform] || extraReasons[platform] || '';
    const blocked = reason || (String(content).trim().length > limit ? `Shorten this draft to ${limit.toLocaleString()} characters for this destination.` : '');
    if (blocked) pending.push({ platform, reason: blocked });
    else ready.push(platform);
  }
  return { ready, pending, label: `Publish to ${ready.length} ready ${ready.length === 1 ? 'destination' : 'destinations'}` };
}

export function retainedPublishingTargets(selected, results) {
  const submitted = new Set((results || []).filter(target => ['posted', 'processing', 'handoff'].includes(target.status)).map(target => target.platform));
  return [...new Set(selected || [])].filter(platform => !submitted.has(platform));
}

export function publishingDraftFingerprint(content, media) {
  return JSON.stringify([String(content || '').trim(), media?.url || '', media?.type || '']);
}

export function unconfirmedPublishingReasons(results) {
  return Object.fromEntries((results || []).filter(target => target.deliveryUncertain)
    .map(target => [target.platform, 'Publication could not be confirmed. Review delivery history before retrying this draft.']));
}

export function readPublishingHold(storage, key, fingerprint) {
  try {
    const values = JSON.parse(storage.getItem(key) || '{}')?.[fingerprint];
    if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
    return Object.fromEntries(Object.entries(values).filter(([source, reason]) => /^[a-z][a-z0-9_-]{0,79}$/.test(source)
      && typeof reason === 'string' && reason.length <= 500));
  } catch { return {}; }
}

export function savePublishingHold(storage, key, fingerprint, reasons) {
  if (typeof fingerprint !== 'string' || fingerprint.length > 20000) return;
  if (!Object.keys(reasons).length) return;
  let ledger;
  try { ledger = JSON.parse(storage.getItem(key) || '{}'); } catch { ledger = {}; }
  if (!ledger || typeof ledger !== 'object' || Array.isArray(ledger)) ledger = {};
  const merged = { ...readPublishingHold(storage, key, fingerprint), ...reasons };
  const bounded = Object.fromEntries(Object.entries(merged).filter(([source, reason]) => /^[a-z][a-z0-9_-]{0,79}$/.test(source)
    && typeof reason === 'string' && reason.length <= 500).slice(0, 32));
  delete ledger[fingerprint];
  ledger[fingerprint] = bounded;
  ledger = Object.fromEntries(Object.entries(ledger).slice(-20));
  storage.setItem(key, JSON.stringify(ledger));
}

export function recoverPublishingRun(storage, draftKey, sendingKey, active = false) {
  const draft = readSessionDraft(storage, draftKey);
  const marker = storage.getItem(sendingKey);
  if (!marker || active) return { ...draft, recovered: false };
  let run;
  try { run = JSON.parse(marker); } catch { run = null; }
  const targets = Array.isArray(run?.targets) ? run.targets : draft.selected;
  const fingerprint = typeof run?.fingerprint === 'string' ? run.fingerprint : publishingDraftFingerprint(draft.content, draft.media);
  const reasons = Object.fromEntries(targets.filter(source => typeof source === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(source))
    .map(source => [source, 'An interrupted publishing request needs review. Check delivery history before retrying this draft.']));
  savePublishingHold(storage, `${draftKey}:delivery-holds`, fingerprint, reasons);
  storage.removeItem(sendingKey);
  return { ...draft, recovered: true };
}
