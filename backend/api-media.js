'use strict';

const { randomUUID } = require('node:crypto');
const express = require('express');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROVIDER_ID = /^video_[A-Za-z0-9_-]{1,200}$/;
const API_MEDIA_SCHEMA = `CREATE TABLE IF NOT EXISTS ufi_api_media_jobs (
  id UUID PRIMARY KEY, key_id UUID NOT NULL REFERENCES ufi_api_keys(id),
  provider_id TEXT, state TEXT NOT NULL CHECK(state IN ('dispatching','queued','in_progress','completed','failed','unknown')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;
const failure = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const publicJob = job => ({ id: job.id, status: job.state === 'dispatching' ? 'unknown' : job.state,
  progress: job.progress, ...(job.state === 'failed' ? { error: 'The video could not be generated.' } : {}) });

function registerAPIMediaRoutes(app, { db, apiKeys, generateImage, createVideo, getVideo, streamVideo, screenPrompt }) {
  let ready;
  async function storage() {
    if (!db?.isConnected?.()) throw failure(503, 'Media job storage is temporarily unavailable.');
    if (!ready) ready = db.query(API_MEDIA_SCHEMA).catch(error => { ready = null; throw error; });
    await ready;
  }
  function input(req, video = false) {
    if (Object.keys(req.query).length || !object(req.body)
      || Object.keys(req.body).some(key => !(video ? ['prompt', 'seconds'] : ['prompt']).includes(key))
      || typeof req.body.prompt !== 'string' || !req.body.prompt.trim() || req.body.prompt.length > 1000 || req.body.prompt.includes('\0')) {
      throw failure(400, 'Provide a prompt of 1 to 1,000 characters.');
    }
    const seconds = req.body.seconds === undefined ? 4 : req.body.seconds;
    if (video && ![4, 8, 12].includes(seconds)) throw failure(400, 'Video seconds must be 4, 8, or 12.');
    return { prompt: req.body.prompt.trim(), seconds };
  }
  async function screen(prompt) {
    if (typeof screenPrompt !== 'function') throw failure(503, 'Generation screening is temporarily unavailable.');
    let result;
    try { result = await screenPrompt(prompt); }
    catch { throw failure(503, 'Generation screening is temporarily unavailable.'); }
    if (!result?.allowed) throw failure(result?.reason === 'screening_unavailable' ? 503 : 422,
      result?.reason === 'screening_unavailable' ? 'Generation screening is temporarily unavailable.' : 'This prompt could not be used for generation.');
  }
  function normalized(provider) {
    const state = ['queued', 'in_progress', 'completed', 'failed'].includes(provider?.status) ? provider.status : null;
    if (!state) throw failure(502, 'The video provider did not confirm its status.');
    const progress = state === 'completed' ? 100 : Number.isFinite(provider.progress) ? Math.max(0, Math.min(100, Math.floor(provider.progress))) : 0;
    return { state, progress };
  }
  async function owned(req) {
    if (!UUID.test(req.params.id) || Object.keys(req.query).length) throw failure(404, 'Video not found.');
    await storage();
    const { rows: [job] } = await db.query('SELECT * FROM ufi_api_media_jobs WHERE id=$1 AND key_id=$2', [req.params.id, req.ufiApiKey.id]);
    if (!job) throw failure(404, 'Video not found.');
    return job;
  }
  function report(res, error, fallback) {
    const status = error.publicMessage || [401, 403, 429].includes(error.status) ? error.status : 503;
    if (status === 429) res.set('Retry-After', '3600');
    if (res.headersSent) return res.destroy();
    res.type('application/json');
    return res.status(status).json({ error: error.publicMessage || ([401, 403, 429].includes(error.status) ? error.message : fallback) });
  }
  const json = express.json({ limit: '64kb', strict: true });
  const guard = scope => [apiKeys.privateResponse, apiKeys.requestLimit, apiKeys.authenticate(scope)];
  app.post('/api/v1/images/generations', ...guard('images:generate'), json, async (req, res) => {
    try {
      const { prompt } = input(req);
      if (typeof generateImage !== 'function') throw failure(503, 'Photo generation is not configured.');
      await storage();
      await screen(prompt);
      const usage = await apiKeys.consumeGeneration(req.ufiApiKey.id, 'images:generate');
      let image;
      try { image = await generateImage(prompt); }
      catch { throw failure(502, 'The photo provider did not confirm a result. This request remains counted; do not automatically retry.'); }
      const match = typeof image === 'string' && /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
      if (!match || match[1].length > 40 * 1024 * 1024 || match[1].length % 4
        || Buffer.from(match[1], 'base64').toString('base64') !== match[1]) throw failure(502, 'The photo provider returned an invalid result.');
      return res.json({ created: Math.floor(Date.now() / 1000), data: [{ b64_json: match[1] }], usage });
    } catch (error) { return report(res, error, 'Photo generation is temporarily unavailable.'); }
  });
  app.post('/api/v1/videos/generations', ...guard('videos:generate'), json, async (req, res) => {
    let job, dispatched = false;
    try {
      const { prompt, seconds } = input(req, true);
      if (typeof createVideo !== 'function') throw failure(503, 'Video generation is not configured.');
      await storage();
      await screen(prompt);
      const usage = await apiKeys.consumeGeneration(req.ufiApiKey.id, 'videos:generate');
      const id = randomUUID();
      ({ rows: [job] } = await db.query(`INSERT INTO ufi_api_media_jobs(id,key_id,state) VALUES($1,$2,'dispatching') RETURNING *`, [id, req.ufiApiKey.id]));
      // Persist the local job before submission. A timeout leaves an unknown
      // outcome that reads never resubmit, including after a process restart.
      dispatched = true;
      const provider = await createVideo({ prompt, seconds });
      if (!PROVIDER_ID.test(provider?.id || '')) throw failure(502, 'The video provider did not confirm a job.');
      const { state, progress } = normalized(provider);
      ({ rows: [job] } = await db.query('UPDATE ufi_api_media_jobs SET provider_id=$2,state=$3,progress=$4,updated_at=NOW() WHERE id=$1 RETURNING *', [id, provider.id, state, progress]));
      return res.status(202).json({ ...publicJob(job), usage });
    } catch (error) {
      if (job && dispatched) {
        const state = error.generationRejected ? 'failed' : 'unknown';
        await db.query('UPDATE ufi_api_media_jobs SET state=$2,updated_at=NOW() WHERE id=$1', [job.id, state]).catch(() => {});
        return res.status(502).json({ id: job.id, status: state, progress: 0,
          error: state === 'failed' ? 'The video provider rejected this request.' : 'The video provider did not confirm submission. This request remains counted; do not automatically retry.' });
      }
      return report(res, error, 'Video generation is temporarily unavailable.');
    }
  });
  app.get('/api/v1/videos/:id', ...guard('videos:generate'), async (req, res) => {
    try {
      let job = await owned(req);
      if (job.provider_id && ['queued', 'in_progress'].includes(job.state)) {
        if (typeof getVideo !== 'function') throw failure(503, 'Video status is temporarily unavailable.');
        let provider;
        try { provider = await getVideo(job.provider_id); }
        catch { throw failure(502, 'Video status is temporarily unavailable.'); }
        const { state, progress } = normalized(provider);
        const updated = await db.query("UPDATE ufi_api_media_jobs SET state=$3,progress=GREATEST(progress,$4),updated_at=NOW() WHERE id=$1 AND key_id=$2 AND state IN ('queued','in_progress') RETURNING *", [job.id, req.ufiApiKey.id, state, progress]);
        job = updated.rows[0] || await owned(req);
      }
      return res.json(publicJob(job));
    } catch (error) { return report(res, error, 'Video status is temporarily unavailable.'); }
  });
  app.get('/api/v1/videos/:id/content', ...guard('videos:generate'), async (req, res) => {
    try {
      const job = await owned(req);
      if (job.state !== 'completed' || !PROVIDER_ID.test(job.provider_id || '')) throw failure(409, 'This video is not ready to download.');
      if (typeof streamVideo !== 'function') throw failure(503, 'Video download is temporarily unavailable.');
      res.set('Content-Type', 'video/mp4');
      await streamVideo(job.provider_id, res);
    } catch (error) { return report(res, error, 'Video download is temporarily unavailable.'); }
  });
  return { storage };
}

module.exports = { registerAPIMediaRoutes, API_MEDIA_SCHEMA };
