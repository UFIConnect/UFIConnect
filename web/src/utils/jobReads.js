import { jobReadIdentity } from '../../../shared/job-read.mjs';
import client from '../api/client';
import { getAccessToken, privateSessionStorage } from '../auth/session';

export function jobDetailPath(job) {
  const path = `/opportunities/${encodeURIComponent(job.id)}`;
  return job.source && !job.nativeJob ? `${path}?${new URLSearchParams({ source: job.source })}` : path;
}

export function recordJobRead(viewerId, job, token) {
  if (!job?.nativeJob || !viewerId || !token || token !== getAccessToken()) return;
  const publisher = job.authorId || job.author?.id;
  if (!publisher || publisher === viewerId) return;
  const receipt = jobReadIdentity(job);
  if (!receipt || receipt.source !== 'uficonnect') return;
  const key = `ufi_job_read:${JSON.stringify([viewerId, receipt.source, receipt.id])}`;
  if (privateSessionStorage.getItem(key)) return;
  privateSessionStorage.setItem(key, 'pending');
  void client.post('/jobs/read', receipt, { headers: { Authorization: `Bearer ${token}` } })
    .then(() => {
      if (getAccessToken() === token) privateSessionStorage.setItem(key, 'confirmed');
    })
    .catch(() => {
      if (getAccessToken() === token) privateSessionStorage.removeItem(key);
    });
}
