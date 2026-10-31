'use strict';

const { rateLimit } = require('express-rate-limit');
const failure = (status, message) => Object.assign(new Error(message), { status });
const UNKNOWN = ['', 'unknown', 'unclassified', 'uncategorized', 'general', 'none', 'null'];
const UNKNOWN_SQL = "lower(btrim(COALESCE(p.topic,''))) = ANY($1::text[])";
const OFFICE_TOPIC_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS office_feed_topic_assignments (
    post_id TEXT PRIMARY KEY, topic TEXT, subtopic TEXT, checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS office_feed_topic_assignment_topic ON office_feed_topic_assignments(topic,subtopic)`,
];
const GENERAL_SUBTOPICS = {
  'Tutorials & guides': ['tutorial', 'step by step', 'how to', 'beginner guide', 'getting started'],
  'Research & analysis': ['research paper', 'study finds', 'systematic review', 'benchmark', 'white paper'],
  'News & releases': ['announced', 'announcement', 'released', 'launches', 'new release'],
  'Tools & resources': ['toolkit', 'open source tool', 'resource list', 'cheat sheet', 'template'],
};
const SPECIFIC_SUBTOPICS = {
  'AI & Machine Learning': { 'Model training': ['model training', 'fine tuning', 'training data'], 'AI safety': ['ai safety', 'model alignment', 'ai governance'], 'Neural networks': ['neural network', 'deep learning'] },
  'Generative AI': { 'Image generation': ['image generation', 'diffusion model'], 'Text generation': ['text generation', 'prompt engineering'], 'AI agents': ['ai agent', 'agentic'] },
  'LLMs & Chatbots': { 'Retrieval & RAG': ['retrieval augmented', 'rag pipeline', 'vector search'], 'Evaluation': ['llm evaluation', 'language model benchmark'], 'Chat assistants': ['chatbot', 'chat assistant'] },
  'Cybersecurity': { 'Vulnerabilities': ['vulnerability', 'zero day', 'cve'], 'Threat intelligence': ['malware', 'ransomware', 'phishing'], 'Identity & access': ['authentication', 'passkey', 'identity management'] },
  'Cloud & DevOps': { 'CI/CD': ['continuous integration', 'ci/cd', 'deployment pipeline'], 'Infrastructure': ['infrastructure as code', 'terraform', 'cloud infrastructure'], 'Observability': ['observability', 'distributed tracing'] },
  'React': { 'Components': ['react component', 'jsx', 'server component'], 'State management': ['react state', 'redux', 'zustand'], 'Performance': ['react performance', 'usememo', 'react profiler'] },
  'Python': { 'Data & automation': ['pandas', 'numpy', 'python automation'], 'Web frameworks': ['django', 'flask', 'fastapi'], 'Language & packages': ['python package', 'pypi', 'python typing'] },
  'Database': { 'SQL': ['sql query', 'postgresql', 'mysql'], 'NoSQL': ['mongodb', 'nosql', 'document database'], 'Performance': ['query optimization', 'database index', 'query planner'] },
  'Startup': { 'Funding': ['seed funding', 'funding round', 'venture funding'], 'Product discovery': ['product market fit', 'customer discovery'], 'Scaling': ['scaling a startup', 'startup growth'] },
  'Travel & Adventure': { 'Destinations': ['destination', 'itinerary', 'sightseeing'], 'Budget travel': ['budget travel', 'cheap flights', 'travel deals'], 'Outdoor adventure': ['hiking', 'backpacking', 'trekking'] },
  'Cooking & Recipes': { 'Quick meals': ['quick meal', 'weeknight dinner', '30 minute meal'], 'Baking': ['baking', 'sourdough', 'pastry'], 'Vegetarian': ['vegetarian recipe', 'vegan recipe', 'plant based meal'] },
  'Fitness & Gym': { 'Strength': ['strength training', 'weightlifting', 'resistance training'], 'Cardio': ['cardio', 'aerobic exercise'], 'Recovery': ['muscle recovery', 'mobility exercise'] },
  'Music Discovery': { 'New releases': ['new album', 'new single', 'album release'], 'Live music': ['concert', 'live performance'], 'Playlists': ['playlist', 'music discovery'] },
  'Personal Finance': { 'Budgeting': ['budgeting', 'emergency fund'], 'Investing': ['index fund', 'retirement saving', 'investment portfolio'], 'Debt': ['credit card debt', 'debt repayment'] },
  'Gaming': { 'Game releases': ['game release', 'new game', 'game trailer'], 'Guides': ['walkthrough', 'game guide'], 'Esports': ['esports', 'gaming tournament'] },
};
const ALIASES = {
  'AI & Machine Learning': ['machine learning', 'artificial intelligence', 'deep learning', 'neural network'],
  'Generative AI': ['generative ai', 'diffusion model', 'image generation'],
  'LLMs & Chatbots': ['large language model', 'llm', 'chatbot', 'retrieval augmented generation'],
  'Cybersecurity': ['cybersecurity', 'ransomware', 'malware', 'data breach', 'zero day'],
  'Cloud & DevOps': ['devops', 'cloud computing', 'ci/cd', 'terraform'],
  'Frontend Dev': ['frontend development', 'front end development', 'css layout'],
  'Backend Dev': ['backend development', 'back end development'],
  'Mobile Dev': ['mobile development', 'android development', 'ios development'],
  'Python': ['python', 'pandas', 'numpy', 'django', 'fastapi'],
  'JavaScript': ['javascript', 'ecmascript'], 'TypeScript': ['typescript'],
  'Go': ['golang', 'go programming', 'go language'], 'Rust': ['rust programming', 'rust language', 'rust compiler'],
  'Node': ['node.js', 'nodejs'], 'React': ['react.js', 'reactjs', 'react component', 'react hook', 'react framework'],
  'Database': ['database', 'postgresql', 'mysql', 'mongodb'], 'Docker & Containers': ['docker', 'containerization'],
  'Travel & Adventure': ['travel itinerary', 'travel guide', 'backpacking trip'],
  'Cooking & Recipes': ['recipe', 'cooking', 'meal preparation'], 'Fitness & Gym': ['strength training', 'weightlifting', 'gym workout'],
  'Science & Research': ['scientific research', 'peer reviewed', 'research paper'],
};
const textOf = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[-_]+/g, ' ').slice(0, 16000);
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function hasTerm(text, term) { return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(textOf(term))}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text); }
const isUnknownTopic = value => UNKNOWN.includes(String(value || '').trim().toLowerCase());
function subtopicRules(topic) { return { ...SPECIFIC_SUBTOPICS[topic], ...GENERAL_SUBTOPICS }; }
function subtopicMatches(title, content, rules) {
  return Object.entries(rules || {}).map(([name, terms]) => ({ name,
    // A title names the subject; repeated copies of the same term in the
    // body should not outweigh that evidence or inflate confidence.
    score: terms.reduce((sum, term) => sum + (hasTerm(title, term) ? 4 : hasTerm(content, term) ? 1 : 0), 0),
  })).filter(row => row.score > 0).sort((a, b) => b.score - a.score);
}
function classifySubtopic(post, topic) {
  const title = textOf(post.title), content = textOf(post.content);
  // Subject-specific evidence takes precedence over the post's format:
  // a Django tutorial belongs to Web frameworks, even though it is a guide.
  // Competing subject matches remain unresolved rather than falling back
  // to a generic format label that would hide the ambiguity.
  const specific = subtopicMatches(title, content, SPECIFIC_SUBTOPICS[topic]);
  const matches = specific.length ? specific : subtopicMatches(title, content, GENERAL_SUBTOPICS);
  return matches.length && (!matches[1] || matches[0].score > matches[1].score) ? matches[0].name : null;
}
function classifyTopic(post, topics) {
  const title = textOf(post.title), content = textOf(post.content);
  const matches = topics.map(topic => {
    const terms = ALIASES[topic] || [topic];
    const evidence = terms.filter(term => hasTerm(title, term) || hasTerm(content, term));
    const score = evidence.reduce((sum, term) => sum + (hasTerm(title, term) ? 5 : 3) + (term.split(/\s+/).length > 1 ? 1 : 0), 0);
    return { topic, score, evidence };
  }).filter(row => row.score >= 3).sort((a, b) => b.score - a.score);
  if (!matches.length) return null;
  if (matches[1] && matches[0].score - matches[1].score < 2) {
    const existing = matches.find(row => row.topic === post.topic);
    if (existing && existing.score === matches[0].score) return { ...existing, subtopic: classifySubtopic(post, existing.topic) };
    return null;
  }
  return { ...matches[0], subtopic: classifySubtopic(post, matches[0].topic) };
}

function createOfficeTopicTransfer({ db, topics, transfer, onClassified = () => {}, topicAgents = null }) {
  let optimizing = false;
  function available() { if (!db.isConnected()) throw failure(503, 'Topic storage is temporarily unavailable.'); }
  async function report() {
    available();
    const { rows } = await db.query(`SELECT stage,CASE WHEN ${UNKNOWN_SQL} THEN 'Unknown' ELSE p.topic END AS topic,
      CASE WHEN a.topic=p.topic${topicAgents ? ' AND a.source_fetched_at=p.fetched_at' : ''} THEN a.subtopic ELSE NULL END AS subtopic,COUNT(*)::int AS count
      FROM (SELECT id,topic,fetched_at,'live' AS stage FROM feed_posts_cache UNION ALL SELECT id,topic,fetched_at,'staged' AS stage FROM feed_posts_staging) p
      LEFT JOIN office_feed_topic_assignments a ON a.post_id=p.id GROUP BY 1,2,3`, [UNKNOWN]);
    const byTopic = new Map([...topics, 'Unknown'].map(topic => [topic, { topic, live: 0, staged: 0, subtopics: Object.keys(subtopicRules(topic)).map(name => ({ name, live: 0, staged: 0 })).concat({ name: 'Unclassified', live: 0, staged: 0 }) }]));
    for (const row of rows) {
      if (!byTopic.has(row.topic)) byTopic.set(row.topic, { topic: row.topic, live: 0, staged: 0, subtopics: [{ name: 'Unclassified', live: 0, staged: 0 }] });
      const item = byTopic.get(row.topic); item[row.stage] += Number(row.count);
      const name = row.subtopic || 'Unclassified';
      let subtopic = item.subtopics.find(entry => entry.name === name);
      if (!subtopic) { subtopic = { name, live: 0, staged: 0 }; item.subtopics.push(subtopic); }
      subtopic[row.stage] += Number(row.count);
    }
    const unknown = byTopic.get('Unknown');
    if (topicAgents) await topicAgents.observeTopics([...byTopic.keys()]);
    const routing = topicAgents ? await topicAgents.snapshot() : null;
    const assigned = new Map((routing?.agents || []).flatMap(agent => agent.topics.map(topic => [topic,agent.id])));
    return { available: true, generatedAt: new Date().toISOString(), topics: [...byTopic.values()].map(item => ({ ...item, agentId: assigned.get(item.topic) || null })).sort((a, b) => b.staged - a.staged || b.live - a.live || a.topic.localeCompare(b.topic)), unknown: { live: unknown.live, staged: unknown.staged }, taxonomy: [...byTopic.values()].map(item => ({ topic: item.topic, subtopics: item.subtopics.map(subtopic => subtopic.name) })), agents: routing?.agents || [], routing,
      note: topicAgents ? 'Counts are stored live and staging inventory. Each topic has an assigned routing agent. New writes are classified immediately; recovery checks every 15 seconds. Ambiguous content remains Unknown or Unclassified and retries later.' : 'Counts are stored live and staging inventory. Unknown topics remain visible when content evidence is ambiguous. Subtopics are assigned by bounded optimization passes; unreviewed items remain Unclassified.' };
  }
  async function transferTopic(body = {}) {
    available();
    const maxBatches = body.maxBatches == null ? 1 : Number(body.maxBatches);
    const topic = body.topic;
    if (body.confirmed !== true || typeof topic !== 'string' || topic.length > 160 || !topic.trim() || !Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 3
      || Object.keys(body).some(key => !['topic', 'subtopic', 'maxBatches', 'confirmed'].includes(key))) throw failure(400, 'Choose a topic and confirm one to three transfer batches.');
    if (!topics.includes(topic) && topic !== 'Unknown') {
      const { rows } = await db.query('SELECT 1 FROM feed_posts_staging WHERE topic=$1 LIMIT 1', [topic]);
      if (!rows.length) throw failure(400, 'Unknown topic selection.');
    }
    const subtopic = body.subtopic || null;
    if (subtopic !== null && ![...Object.keys(subtopicRules(topic)), 'Unclassified'].includes(subtopic)) throw failure(400, 'Invalid subtopic.');
    const result = await transfer({ topic, subtopic, maxBatches, reason: `office-topic:${topic}${subtopic ? ` / ${subtopic}` : ''}` });
    if (!result || result.skipped) throw failure(409, 'A staging transfer is already running. Refresh and retry when it completes.');
    if (result.error) throw failure(503, `Transfer failed; uncommitted staging rows are retained. ${result.error}`);
    return { ok: true, topic, subtopic, ...result };
  }
  async function optimizeUnknown(body = {}) {
    available();
    if (body.confirmed !== true || Object.keys(body).some(key => key !== 'confirmed')) throw failure(400, 'Confirm the topic optimization command.');
    if (optimizing) throw failure(409, 'Topic optimization is already running.');
    optimizing = true;
    let checked = 0, updated = 0, subtopicsAssigned = 0;
    const changes = [];
    try {
      // Row locks prevent concurrent workers from classifying the same rows.
      await db.withClient(async client => {
        await client.query('BEGIN');
        try {
          const routingStats = [];
          for (const table of ['feed_posts_staging', 'feed_posts_cache']) {
            const { rows } = await client.query(`SELECT p.id,p.title,p.content,p.topic FROM ${table} p
              LEFT JOIN office_feed_topic_assignments a ON a.post_id=p.id
              WHERE a.post_id IS NULL OR a.topic IS DISTINCT FROM p.topic OR ${topicAgents
                ? 'a.rule_version IS DISTINCT FROM $2::text OR a.retry_at<=NOW() OR a.source_fetched_at IS DISTINCT FROM p.fetched_at'
                : "a.checked_at < NOW()-INTERVAL '1 day'"}
              ORDER BY CASE WHEN ${UNKNOWN_SQL} THEN 0 ELSE 1 END,p.fetched_at DESC,p.id LIMIT 500 FOR UPDATE OF p SKIP LOCKED`, topicAgents ? [UNKNOWN,topicAgents.ruleVersion] : [UNKNOWN]);
            if (topicAgents) {
              const result = await topicAgents.classifyPersisted(rows, { targetTable: table, queryRunner: client, trackStats: false });
              checked += result.checked; updated += result.resolved; subtopicsAssigned += result.assigned;
              changes.push(...result.changes);
              routingStats.push(...result.stats);
            } else for (const post of rows) {
              checked++;
              const guessed = isUnknownTopic(post.topic) ? classifyTopic(post, topics) : null;
              const topic = guessed?.topic || post.topic, subtopic = topic ? classifySubtopic(post, topic) : null;
              if (guessed) { const result = await client.query(`UPDATE ${table} SET topic=$2 WHERE id=$1 AND topic IS NOT DISTINCT FROM $3`, [post.id, topic, post.topic]); updated += result.rowCount || 0; if (result.rowCount) changes.push({ id: post.id, topic }); }
              if (subtopic) subtopicsAssigned++;
              await client.query(`INSERT INTO office_feed_topic_assignments(post_id,topic,subtopic) VALUES($1,$2,$3)
                ON CONFLICT(post_id) DO UPDATE SET topic=EXCLUDED.topic,subtopic=EXCLUDED.subtopic,checked_at=NOW()`, [post.id, topic || null, subtopic]);
            }
          }
          if (topicAgents) await topicAgents.flushStats(routingStats, { queryRunner: client });
          await client.query('COMMIT');
        } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      });
      onClassified(changes);
      const snapshot = await report();
      return { ok: true, checked, updated, subtopicsAssigned, remaining: snapshot.unknown.live + snapshot.unknown.staged, unknown: snapshot.unknown, message: `Reviewed ${checked} stored posts; resolved ${updated} unknown topics and assigned ${subtopicsAssigned} subtopics. Ambiguous items remain Unknown.` };
    } finally { optimizing = false; }
  }
  return { report, transferTopic, optimizeUnknown };
}
function registerOfficeTopicRoutes(app, { requireOfficeToken, ...options }) {
  const service = createOfficeTopicTransfer(options);
  const privateResponse = (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); };
  const route = action => async (req, res) => { try { res.json(await action(req)); } catch (error) { res.status(error.status || 503).json({ message: error.status ? error.message : 'Topic tools are temporarily unavailable.' }); } };
  const limit = rateLimit({ windowMs: 60000, limit: 10, standardHeaders: true, legacyHeaders: false });
  app.get('/office/topic-transfer', privateResponse, requireOfficeToken, route(() => service.report()));
  app.post('/office/topic-transfer/transfer', privateResponse, requireOfficeToken, limit, route(req => service.transferTopic(req.body)));
  app.post('/office/topic-transfer/optimize-unknown', privateResponse, requireOfficeToken, limit, route(req => service.optimizeUnknown(req.body)));
  return service;
}
module.exports = { OFFICE_TOPIC_SCHEMA, UNKNOWN, isUnknownTopic, classifyTopic, classifySubtopic, createOfficeTopicTransfer, registerOfficeTopicRoutes };
