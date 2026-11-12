import { normalizeCareerSource } from '../backend/job-sources.mjs';

export function jobReadIdentity(job) {
  const id = typeof job?.id === 'string' || Number.isSafeInteger(job?.id) ? String(job.id) : '';
  const source = normalizeCareerSource(job?.source);
  if (!id.trim() || id.length > 700 || id.includes('\0') || !source || source.length > 100) return null;
  return { id, source: source === 'muse' ? 'themuse' : source };
}

export function jobReadKey(job) {
  const identity = jobReadIdentity(job);
  return identity ? JSON.stringify([identity.source, identity.id]) : '';
}
