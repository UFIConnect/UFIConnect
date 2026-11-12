import { jobReadIdentity, jobReadKey } from '../../../shared/job-read.mjs';
import client from '../api/client';
import { getAccessToken, privateSessionStorage } from '../auth/session';

export function jobDetailPath(job) {
  const path = `/opportunities/${encodeURIComponent(job.id)}`;
  return job.source && !job.nativeJob ? `${path}?${new URLSearchParams({ source: job.source })}` : path;
}

function receiptCacheKey(viewerId, job) {
  const key = jobReadKey(job);
  return viewerId && key ? `ufi_job_read:${JSON.stringify([viewerId, key])}` : '';
}

export function hasReadJob(viewerId, job) {
  return Boolean(viewerId && (job.read === true || privateSessionStorage.getItem(receiptCacheKey(viewerId, job))));
}

export function recordJobRead(viewerId, job, token) {
  const receipt = jobReadIdentity(job);
  if (!viewerId || !receipt || !token || token !== getAccessToken()) return;
  const key = receiptCacheKey(viewerId, job);
  const state = privateSessionStorage.getItem(key);
  if (state === 'confirmed' || state === 'pending') return;
  if (job.read === true) {
    privateSessionStorage.setItem(key, 'confirmed');
    return;
  }
  privateSessionStorage.setItem(key, 'pending');
  void client.post('/jobs/read', receipt, { headers: { Authorization: `Bearer ${token}` } })
    .then(() => {
      if (getAccessToken() === token) privateSessionStorage.setItem(key, 'confirmed');
    })
    .catch(() => {
      if (getAccessToken() === token) privateSessionStorage.setItem(key, 'opened');
    });
}
