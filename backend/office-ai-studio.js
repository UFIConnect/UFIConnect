'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { createTokenVault } = require('./token-vault');
const { createStudioProvider } = require('./office-ai-studio-provider');
const { memoryRedactor } = require('./office-ai-memory');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CHAPTER_SECONDS = 120;
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS office_ai_studio_projects (id UUID PRIMARY KEY,scope_key TEXT NOT NULL DEFAULT 'office',client_request_id UUID NOT NULL,request_hash TEXT NOT NULL,status TEXT NOT NULL,encrypted_payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,active_chapter_id UUID,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  "ALTER TABLE office_ai_studio_projects ADD COLUMN IF NOT EXISTS scope_key TEXT NOT NULL DEFAULT 'office'",
  'ALTER TABLE office_ai_studio_projects DROP CONSTRAINT IF EXISTS office_ai_studio_projects_client_request_id_key',
  'CREATE UNIQUE INDEX IF NOT EXISTS office_ai_studio_projects_scope_request ON office_ai_studio_projects(scope_key,client_request_id)',
  `CREATE TABLE IF NOT EXISTS office_ai_studio_chapters (id UUID PRIMARY KEY,project_id UUID NOT NULL REFERENCES office_ai_studio_projects(id),chapter_index BIGINT NOT NULL,status TEXT NOT NULL,duration_seconds DOUBLE PRECISION NOT NULL,encrypted_payload TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  'CREATE INDEX IF NOT EXISTS office_ai_studio_chapters_project ON office_ai_studio_chapters(project_id,chapter_index,created_at)',
  'CREATE TABLE IF NOT EXISTS office_ai_studio_slots (id SMALLINT PRIMARY KEY,owner UUID,lease_until TIMESTAMPTZ)',
  'INSERT INTO office_ai_studio_slots (id) VALUES (1),(2) ON CONFLICT (id) DO NOTHING',
];
const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: message });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, names) => Object.keys(value).every(key => names.includes(key));
const string = (value, max, fallback = '') => value === undefined ? fallback : typeof value === 'string' && value.length <= max ? value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '') : null;

function validateProject(body) {
  if (!object(body) || !only(body, ['clientRequestId','kind','title','prompt','durationSeconds','creativity','producer','characters','renderStyle'])
    || !UUID.test(body.clientRequestId || '') || !['photo','video','movie'].includes(body.kind)) throw fail(400, 'Choose photo, video or movie and provide a request ID.');
  if (Buffer.byteLength(JSON.stringify(body)) > 64 * 1024) throw fail(413, 'Use a production brief smaller than 64 KB.');
  const prompt = string(body.prompt, 12000), title = string(body.title, 160, 'Untitled production');
  const creativity = body.creativity || 'balanced';
  if (!prompt || title === null || !['strict','balanced','creative'].includes(creativity)) throw fail(400, 'Enter a production brief and choose supported creative freedom.');
  const durationSeconds = body.kind === 'photo' ? 0 : body.durationSeconds;
  if (body.kind !== 'photo' && (!Number.isSafeInteger(durationSeconds) || durationSeconds < 4)) throw fail(400, 'Choose a whole-number video duration of at least four seconds.');
  if (body.renderStyle !== undefined && body.renderStyle !== 'narrated') throw fail(400, 'Choose narrated video with generated images, speech and captions.');
  const producer = body.producer ?? {};
  if (!object(producer) || !only(producer, ['brief','roles']) || string(producer.brief, 4000) === null
    || producer.roles !== undefined && (!Array.isArray(producer.roles) || producer.roles.length > 8 || producer.roles.some(role => !string(role, 100)))) throw fail(400, 'Use a producer brief and up to eight production roles.');
  const characters = body.characters ?? [];
  if (!Array.isArray(characters) || characters.length > 20 || characters.some(character => !object(character)
    || !only(character, ['name','appearance','personality','voice']) || !string(character.name, 100)
    || ['appearance','personality','voice'].some(key => string(character[key], 1800) === null))) throw fail(400, 'Use up to twenty named original characters with appearance, personality and voice notes.');
  if (new Set(characters.map(character => character.name.trim().toLocaleLowerCase('en-US'))).size !== characters.length) throw fail(400, 'Give each character a distinct name.');
  return { clientRequestId: body.clientRequestId.toLowerCase(), kind: body.kind, title: title || 'Untitled production', prompt, durationSeconds, creativity,
    renderStyle: 'narrated', producer: { brief: string(producer.brief, 4000), roles: producer.roles?.map(role => role.trim()) || ['Producer','Screenwriter','Director','Continuity editor'] },
    characters: characters.map(character => Object.fromEntries(['name','appearance','personality','voice'].map(key => [key, string(character[key], key === 'name' ? 100 : 1800)]))) };
}

function nextChapterDuration(remaining) {
  if (!Number.isSafeInteger(remaining) || remaining < 4) throw fail(409, 'The remaining video duration could not be verified.');
  return remaining > CHAPTER_SECONDS && remaining - CHAPTER_SECONDS < 4 ? CHAPTER_SECONDS - 4 : Math.min(CHAPTER_SECONDS, remaining);
}

function createOfficeAIStudio({ db, env = process.env, fetcher = globalThis.fetch, provider, now = Date.now, scope = 'office' } = {}) {
  if (typeof scope !== 'string' || !/^[A-Za-z0-9:_-]{1,200}$/.test(scope)) throw fail(400, 'Choose a valid media workspace.');
  const media = provider || createStudioProvider({ env, fetcher });
  const redact = memoryRedactor(env), running = new Map(), controllers = new Map();
  let ready;
  const stamp = () => new Date(now()).toISOString();
  const crypt = () => createTokenVault(env);
  const seal = (value, context) => crypt().seal(JSON.stringify(value), context);
  const decode = (row, kind) => JSON.parse(crypt().open(row.encrypted_payload, `office:studio:${kind}:${row.id}`));
  async function storage() {
    if (!db?.isConnected?.() || typeof db.query !== 'function' || !env.OAUTH_TOKEN_ENCRYPTION_KEY) throw fail(503, 'Studio needs its encrypted database connection.');
    crypt();
    if (!ready) ready = (async () => { for (const sql of SCHEMA) await db.query(sql); })().catch(error => { ready = null; throw error; });
    await ready;
  }
  function capabilities() {
    const config = media.configured();
    const renderer = config.renderer || 'native', canRender = renderer === 'native' || config.shotstack;
    return { photo: !!(config.openai && config.storage), video: !!(config.openai && canRender && config.storage), movie: !!(config.openai && canRender && config.storage),
      planning: true, chapterSeconds: CHAPTER_SECONDS, customDuration: true, continuable: true, assembly: !!(canRender && config.storage), assemblyBatchChapters: 30,
      providers: config, renderer, renderStyle: 'narrated',
      note: 'Choose any project duration. Generate one chapter of up to two minutes at a time, then continue. Videos use generated still images, narration and captions. Provider access, credits and render limits apply. Completed chapters play in sequence. Assemble the film in stages of up to thirty inputs, continuing until the full MP4 is ready. Producer roles are AI creative directions and character consistency is best effort.' };
  }
  async function projectRow(id) {
    if (!UUID.test(id || '')) throw fail(404, 'Studio project not found.');
    const { rows } = await db.query('SELECT * FROM office_ai_studio_projects WHERE id=$1 AND scope_key=$2', [id, scope]);
    if (!rows.length) throw fail(404, 'Studio project not found.');
    return rows[0];
  }
  async function chapterRow(id) {
    const { rows } = await db.query('SELECT * FROM office_ai_studio_chapters WHERE id=$1', [id]);
    if (!rows.length) throw fail(503, 'The saved generation receipt could not be found.');
    return rows[0];
  }
  async function progress(id) {
    const { rows } = await db.query("SELECT COALESCE(SUM(duration_seconds) FILTER (WHERE status='completed' AND chapter_index>=0),0) AS seconds,COUNT(*) FILTER (WHERE status='completed' AND chapter_index>=0) AS count FROM office_ai_studio_chapters WHERE project_id=$1", [id]);
    return { seconds: Number(rows[0].seconds), count: Number(rows[0].count) };
  }
  async function publicProject(row, offset = 0, includeChapters = true) {
    const saved = decode(row, 'project'), done = await progress(row.id);
    let chapters = [], assembly, activeChapter;
    if (includeChapters) {
      const result = await db.query('SELECT * FROM office_ai_studio_chapters WHERE project_id=$1 AND chapter_index >= $2 ORDER BY chapter_index,created_at LIMIT 101', [row.id, offset]);
      chapters = result.rows.map(item => ({ ...decode(item, 'chapter'), status: item.status }));
      const assemblies = await db.query('SELECT * FROM office_ai_studio_chapters WHERE project_id=$1 AND chapter_index=-1 ORDER BY created_at DESC LIMIT 1', [row.id]);
      if (assemblies.rows.length) {
        const item = assemblies.rows[0], part = { ...decode(item, 'chapter'), status: item.status };
        assembly = { id: part.id, status: part.status, coveredChapters: part.coveredChapters, totalChapters: done.count,
          complete: part.status === 'completed' && part.coveredChapters >= done.count, ...(part.mediaUrl ? { url: part.mediaUrl } : {}) };
        chapters.push(part);
      }
      if (row.active_chapter_id && !chapters.some(item => item.id === row.active_chapter_id)) {
        const active = await chapterRow(row.active_chapter_id); chapters.push({ ...decode(active, 'chapter'), status: active.status });
      }
      activeChapter = chapters.find(item => item.id === row.active_chapter_id);
    }
    const primary = chapters.filter(item => item.index >= 0), more = primary.length > 100;
    const shown = [...primary.slice(0, 100), ...chapters.filter(item => item.index < 0)];
    if (activeChapter && !shown.some(item => item.id === activeChapter.id)) shown.push(activeChapter);
    const artifacts = shown.filter(chapter => chapter.status === 'completed' && chapter.mediaUrl).map(chapter => ({ id: chapter.id,
      kind: saved.kind === 'photo' ? 'image' : 'video', url: chapter.mediaUrl,
      filename: `uficonnect-${row.id}-${chapter.index < 0 ? 'assembled' : chapter.index + 1}.${saved.kind === 'photo' ? 'png' : 'mp4'}`,
      durationSeconds: chapter.durationSeconds }));
    return { ...saved, id: row.id, status: row.status, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
      completedSeconds: done.seconds, remainingSeconds: Math.max(0, saved.durationSeconds - done.seconds), chapterCount: done.count,
      chapters: shown, artifacts, ...(assembly ? { assembly } : {}), nextChapterOffset: more ? primary[99].index + 1 : null,
      ...(row.status === 'failed' && activeChapter?.error ? { error: activeChapter.error } : {}),
      ...(row.status === 'needs_review' ? { error: 'A generation request may have reached the provider without a saved receipt. Review provider jobs before retrying; an earlier attempt may still be billed.' } : {}) };
  }
  async function saveChapter(chapter) {
    await db.query('UPDATE office_ai_studio_chapters SET encrypted_payload=$2,status=$3,updated_at=$4 WHERE id=$1',
      [chapter.id, seal(chapter, `office:studio:chapter:${chapter.id}`), chapter.status, stamp()]);
  }
  async function updateProject(id, status, activeId, expectedActive) {
    await db.query(`UPDATE office_ai_studio_projects SET status=$2,active_chapter_id=$3,version=version+1,updated_at=$4 WHERE id=$1${expectedActive ? " AND active_chapter_id=$5 AND status<>'cancelled'" : ''}`, [id, status, activeId, stamp(), ...(expectedActive ? [expectedActive] : [])]);
  }
  async function perform(project, chapter, assemblyChapters) {
    const controller = new AbortController(); controllers.set(project.id, controller);
    const heartbeat = setInterval(() => {
      Promise.all([
        db.query("UPDATE office_ai_studio_chapters SET updated_at=$2 WHERE id=$1 AND status='dispatching'", [chapter.id, stamp()]),
        db.query('UPDATE office_ai_studio_slots SET lease_until=$2 WHERE owner=$1', [chapter.id, new Date(now() + 9 * 60000).toISOString()]),
        db.query('SELECT status FROM office_ai_studio_projects WHERE id=$1', [project.id]).then(result => { if (result.rows[0]?.status === 'cancelled') controller.abort(); }),
      ]).catch(() => {});
    }, 30000);
    heartbeat.unref?.();
    try {
      const result = assemblyChapters ? await media.assemble(project, assemblyChapters, { signal: controller.signal })
        : project.kind === 'photo' ? await media.photo(project, chapter, { signal: controller.signal }) : await media.chapter(project, chapter, { signal: controller.signal });
      Object.assign(chapter, result); await saveChapter(chapter);
      const latest = await projectRow(project.id);
      if (latest.status === 'cancelled') return;
      if (chapter.status === 'completed') {
        const done = await progress(project.id);
        await updateProject(project.id, project.kind === 'photo' || chapter.index < 0 || done.seconds >= project.durationSeconds ? 'ready' : 'draft', null, chapter.id);
      }
    } catch (error) {
      chapter.status = error.knownRejected || error.beforeDispatch ? 'failed' : 'needs_review';
      chapter.error = redact(error.publicMessage || 'Generation could not be verified. Review provider jobs before retrying.');
      await saveChapter(chapter).catch(() => {});
      const latest = await projectRow(project.id).catch(() => null);
      if (latest && latest.status !== 'cancelled') await updateProject(project.id, chapter.status, chapter.id, chapter.id).catch(() => {});
    } finally {
      clearInterval(heartbeat);
      running.delete(project.id);
      controllers.delete(project.id);
      await db.query('UPDATE office_ai_studio_slots SET owner=NULL,lease_until=NULL WHERE owner=$1', [chapter.id]).catch(() => {});
    }
  }
  async function poll(row) {
    if (!row.active_chapter_id || running.has(row.id)) return row;
    const child = await chapterRow(row.active_chapter_id), chapter = decode(child, 'chapter'); chapter.status = child.status;
    if (chapter.status === 'dispatching' && now() - Date.parse(child.updated_at) > 4 * 60000 && row.status !== 'cancelled') {
      await updateProject(row.id, 'needs_review', child.id, child.id); return projectRow(row.id);
    }
    if (chapter.status !== 'processing' || row.status === 'cancelled' || now() - Date.parse(child.updated_at) < 5000) return row;
    // Polling never submits another render. A failed status lookup leaves the
    // original receipt intact so the next refresh can recover it safely.
    const result = await media.poll(chapter);
    Object.assign(chapter, result); await saveChapter(chapter);
    if (chapter.status === 'completed') {
      const project = decode(row, 'project'), done = await progress(row.id);
      await updateProject(row.id, project.kind === 'photo' || chapter.index < 0 || done.seconds >= project.durationSeconds ? 'ready' : 'draft', null, chapter.id);
    } else if (chapter.status === 'failed') await updateProject(row.id, 'failed', chapter.id, chapter.id);
    return projectRow(row.id);
  }
  const handle = handler => async (req, res) => {
    res.set?.('Cache-Control', 'no-store');
    try { await storage(); return await handler(req, res); }
    catch (error) {
      if (res.headersSent && typeof res.destroy === 'function') return res.destroy();
      return res.status(error.publicMessage ? error.status : 503).json({ error: redact(error.publicMessage || 'Studio storage or provider access is unavailable. Your saved production remains in the database.') });
    }
  };
  const list = handle(async (req, res) => {
    const offset = req.query?.after === undefined ? 0 : Number(req.query.after);
    if (!Number.isSafeInteger(offset) || offset < 0) throw fail(400, 'Choose a valid project offset.');
    const { rows } = await db.query('SELECT * FROM office_ai_studio_projects WHERE scope_key=$2 ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET $1', [offset, scope]);
    return res.json({ capabilities: capabilities(), projects: await Promise.all(rows.slice(0, 30).map(row => publicProject(row, 0, false))), nextProjectOffset: rows.length > 30 ? offset + 30 : null });
  });
  const create = handle(async (req, res) => {
    const input = validateProject(req.body), requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    // Omit credentials pasted into a creative brief before persistence or inference.
    const scrub = value => typeof value === 'string' ? redact(value) : Array.isArray(value) ? value.map(scrub)
      : object(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)])) : value;
    const project = scrub({ ...input, id: randomUUID() });
    const prior = await db.query('SELECT * FROM office_ai_studio_projects WHERE client_request_id=$1 AND scope_key=$2', [input.clientRequestId, scope]);
    if (prior.rows.length) {
      if (prior.rows[0].request_hash !== requestHash) throw fail(409, 'This request ID belongs to a different production brief.');
      return res.json({ project: await publicProject(prior.rows[0]) });
    }
    await db.query('INSERT INTO office_ai_studio_projects (id,client_request_id,request_hash,status,encrypted_payload,created_at,updated_at,scope_key) VALUES ($1,$2,$3,$4,$5,$6,$6,$7) ON CONFLICT (scope_key,client_request_id) DO NOTHING',
      [project.id, input.clientRequestId, requestHash, 'draft', seal(project, `office:studio:project:${project.id}`), stamp(), scope]);
    const result = await db.query('SELECT * FROM office_ai_studio_projects WHERE client_request_id=$1 AND scope_key=$2', [input.clientRequestId, scope]);
    if (result.rows[0].request_hash !== requestHash) throw fail(409, 'This request ID belongs to a different production brief.');
    return res.status(201).json({ project: await publicProject(result.rows[0]) });
  });
  const detail = handle(async (req, res) => {
    const offset = req.query?.after === undefined ? 0 : Number(req.query.after);
    if (!Number.isSafeInteger(offset) || offset < 0) throw fail(400, 'Choose a valid chapter offset.');
    return res.json({ project: await publicProject(await poll(await projectRow(req.params.id)), offset), capabilities: capabilities() });
  });
  async function launch(req, res, assembling) {
    if (!object(req.body || {}) || Object.keys(req.body || {}).length) throw fail(400, 'Generation uses the saved production brief.');
    let row = await poll(await projectRow(req.params.id));
    if (row.status === 'generating') return res.status(202).json({ project: await publicProject(row) });
    if (!['draft','ready'].includes(row.status)) throw fail(409, 'Resume this saved project before generating another chapter.');
    const project = decode(row, 'project'), config = capabilities();
    if (!(project.kind === 'photo' ? config.photo : config.video)) throw fail(503, 'Connect the configured media providers and storage before generating this project.');
    if (running.size >= 2) throw fail(429, 'Two Studio generations are active. Wait for one to finish.');
    const done = await progress(row.id);
    if (!assembling && (project.kind === 'photo' && done.count > 0 || project.kind !== 'photo' && done.seconds >= project.durationSeconds)) throw fail(409, 'This production is complete. Create another project for a variation.');
    let assemblyChapters, coveredChapters;
    if (assembling) {
      if (project.kind === 'photo' || done.seconds < project.durationSeconds) throw fail(409, 'Complete all video chapters before assembling the film.');
      if (!config.assembly) throw fail(503, 'Connect the video renderer and storage before assembling this film.');
      const prior = await db.query("SELECT * FROM office_ai_studio_chapters WHERE project_id=$1 AND chapter_index=-1 AND status='completed' ORDER BY created_at DESC LIMIT 1", [row.id]);
      const prefix = prior.rows.length ? decode(prior.rows[0], 'chapter') : null;
      const covered = prefix?.coveredChapters || 0;
      if (covered >= done.count) return res.json({ project: await publicProject(row) });
      const found = await db.query("SELECT * FROM office_ai_studio_chapters WHERE project_id=$1 AND status='completed' AND chapter_index >= $2 ORDER BY chapter_index LIMIT $3", [row.id, covered, prefix ? 29 : 30]);
      assemblyChapters = [...(prefix ? [prefix] : []), ...found.rows.map(item => decode(item, 'chapter'))];
      coveredChapters = covered + found.rows.length;
    }
    const id = randomUUID();
    const previous = await db.query("SELECT * FROM office_ai_studio_chapters WHERE project_id=$1 AND status='completed' AND chapter_index>=0 ORDER BY chapter_index DESC LIMIT 1", [row.id]);
    const chapter = { id, index: assembling ? -1 : done.count, startSeconds: done.seconds,
      durationSeconds: assembling ? assemblyChapters.reduce((sum, part) => sum + part.durationSeconds, 0) : project.kind === 'photo' ? 0 : nextChapterDuration(project.durationSeconds - done.seconds),
      ...(assembling ? { coveredChapters } : {}), status: 'dispatching', createdAt: stamp(), previousSummary: previous.rows.length ? decode(previous.rows[0], 'chapter').summary || '' : '' };
    // The durable receipt and optimistic project claim commit in one SQL
    // statement. Across processes exactly one caller can submit paid work.
    const slot = await db.query(`UPDATE office_ai_studio_slots SET owner=$1,lease_until=$2 WHERE id=(SELECT id FROM office_ai_studio_slots WHERE owner IS NULL OR lease_until < $3 ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id`,
      [id, new Date(now() + 9 * 60000).toISOString(), stamp()]);
    if (!slot.rows.length) throw fail(429, 'Two Studio generation submissions are active. Wait for one to finish.');
    let claimed;
    try { claimed = await db.query(`WITH claimed AS (UPDATE office_ai_studio_projects SET status='generating',active_chapter_id=$3,version=version+1,updated_at=$4 WHERE id=$1 AND version=$2 AND status IN ('draft','ready') RETURNING id)
      INSERT INTO office_ai_studio_chapters (id,project_id,chapter_index,status,duration_seconds,encrypted_payload,created_at,updated_at)
      SELECT $3,id,$5,$6,$7,$8,$4,$4 FROM claimed RETURNING id`,
      [row.id, row.version, id, stamp(), chapter.index, chapter.status, chapter.durationSeconds, seal(chapter, `office:studio:chapter:${id}`)]);
      if (!claimed.rows.length) throw fail(409, 'Another request changed this production. Refresh before generating.');
    } catch (error) { await db.query('UPDATE office_ai_studio_slots SET owner=NULL,lease_until=NULL WHERE owner=$1', [id]); throw error; }
    const work = perform(project, chapter, assemblyChapters); running.set(project.id, work);
    return res.status(202).json({ project: await publicProject(await projectRow(row.id)) });
  }
  const generate = handle((req, res) => launch(req, res, false));
  const assemble = handle((req, res) => launch(req, res, true));
  const cancel = handle(async (req, res) => {
    const row = await projectRow(req.params.id);
    const updated = await db.query("UPDATE office_ai_studio_projects SET status='cancelled',version=version+1,updated_at=$3 WHERE id=$1 AND version=$2 RETURNING id", [row.id, row.version, stamp()]);
    if (!updated.rows.length) throw fail(409, 'This production changed while stopping. Refresh and stop it again.');
    controllers.get(row.id)?.abort();
    return res.json({ project: await publicProject(await projectRow(row.id)), note: 'Future work is stopped and local generation is cancelled where possible. Requests already accepted by a provider may still finish and be billed.' });
  });
  const resume = handle(async (req, res) => {
    let row = await projectRow(req.params.id);
    const transition = async (status, active) => {
      const result = await db.query('UPDATE office_ai_studio_projects SET status=$3,active_chapter_id=$4,version=version+1,updated_at=$5 WHERE id=$1 AND version=$2 RETURNING id', [row.id, row.version, status, active, stamp()]);
      if (!result.rows.length) throw fail(409, 'This production changed while resuming. Refresh before continuing.');
    };
    if (row.status === 'needs_review') throw fail(409, 'Review the provider job history before retrying this uncertain generation. No duplicate render was submitted.');
    if (row.active_chapter_id) {
      const child = await chapterRow(row.active_chapter_id);
      if (child.status === 'needs_review') throw fail(409, 'Review this uncertain generation in the provider job history before retrying. No duplicate render was submitted.');
      if (['dispatching','processing'].includes(child.status)) {
        if (child.status === 'dispatching' && !running.has(row.id) && now() - Date.parse(child.updated_at) > 4 * 60000) throw fail(409, 'This generation needs provider review before it can be resumed.');
        await transition('generating', child.id);
        row = await poll(await projectRow(row.id));
        return res.json({ project: await publicProject(row) });
      }
    }
    const done = await progress(row.id), project = decode(row, 'project');
    await transition(project.kind === 'photo' ? done.count ? 'ready' : 'draft' : done.seconds >= project.durationSeconds ? 'ready' : 'draft', null);
    return res.json({ project: await publicProject(await projectRow(row.id)) });
  });
  const exportProject = handle(async (req, res) => {
    const project = await publicProject(await projectRow(req.params.id));
    res.set?.('Content-Disposition', `attachment; filename="uficonnect-production-${project.id}.json"`);
    const { chapters, artifacts, nextChapterOffset, ...metadata } = project;
    const note = 'A production plan and complete chapter manifest. Media URLs are publicly retrievable by anyone who has the URL. Save completed downloads.';
    if (typeof res.write !== 'function') return res.json({ format: 'uficonnect-production-v1', project, note });
    res.set?.('Content-Type', 'application/json; charset=utf-8');
    const write = async value => {
      if (res.write(value) !== false) return;
      await new Promise(resolve => {
        const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
        res.once('drain', done); res.once('close', done);
      });
    };
    await write('{"format":"uficonnect-production-v1","note":' + JSON.stringify(note) + ',"project":' + JSON.stringify(metadata).slice(0, -1) + ',"chapters":[');
    let offset = 0, first = true;
    const cutoff = stamp();
    for (;;) {
      if (res.destroyed || res.writableEnded) return;
      const page = await db.query('SELECT * FROM office_ai_studio_chapters WHERE project_id=$1 AND created_at<=$2 ORDER BY chapter_index,id LIMIT 100 OFFSET $3', [project.id, cutoff, offset]);
      for (const row of page.rows) { if (res.destroyed || res.writableEnded) return; await write((first ? '' : ',') + JSON.stringify({ ...decode(row, 'chapter'), status: row.status })); first = false; }
      if (page.rows.length < 100) break;
      offset += 100;
    }
    return res.end(']}}');
  });
  return { list, create, detail, generate, assemble, cancel, resume, exportProject, capabilities, idle: () => Promise.all([...running.values()]) };
}

module.exports = { createOfficeAIStudio, validateProject, nextChapterDuration, STUDIO_SCHEMA: SCHEMA };
