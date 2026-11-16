'use strict';

const { createHash } = require('node:crypto');
const { rateLimit } = require('express-rate-limit');
const { GROUP_CATEGORY_TOPICS, RELATED_SUBTOPICS } = require('./group-topic-rules');
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
  'LLMs & Chatbots': ['large language model', 'large language models', 'llm', 'llms', 'chatbot', 'chatbots', 'retrieval augmented generation'],
  'Cybersecurity': ['cybersecurity', 'ransomware', 'malware', 'data breach', 'zero day'],
  'Cloud & DevOps': ['devops', 'cloud computing', 'ci/cd', 'terraform', 'object storage', 'cloud infrastructure'],
  'Frontend Dev': ['frontend development', 'front end development', 'css layout'],
  'Backend Dev': ['backend development', 'back end development', 'backend engineer', 'backend server'],
  'Mobile Dev': ['mobile development', 'android development', 'ios development', 'targetsdk', 'play console', 'android sdk', 'swiftui'],
  'Python': ['python', 'pandas', 'numpy', 'django', 'fastapi'],
  'JavaScript': ['javascript', 'ecmascript', 'intl.datetimeformat'], 'TypeScript': ['typescript'],
  'Go': ['golang', 'go programming', 'go language'], 'Rust': ['rust programming', 'rust language', 'rust compiler'],
  'Node': ['node.js', 'nodejs'], 'React': ['react.js', 'reactjs', 'react component', 'react hook', 'react framework'],
  'Database': ['database', 'postgresql', 'mysql', 'mongodb'], 'Docker & Containers': ['docker', 'containerization'],
  'Kubernetes': ['kubernetes', 'k8s', 'kubectl'],
  'Travel & Adventure': ['travel itinerary', 'travel guide', 'backpacking trip'],
  'Cooking & Recipes': ['recipe', 'recipes', 'cooking', 'meal preparation'], 'Fitness & Gym': ['strength training', 'weightlifting', 'gym workout'],
  'Science & Research': ['scientific research', 'peer reviewed', 'research paper'],
  // Use subject phrases and established technical names rather than splitting
  // display labels on '&'. Generic words such as 'work', 'content', 'model',
  // 'running', 'go', and 'rust' are not enough evidence for a topic.
  'Computer Vision': ['computer vision', 'object detection', 'image segmentation'],
  'Data Science': ['data science', 'data scientist', 'data analytics'],
  'Developer Tools': ['developer tools', 'developer tooling', 'code editor', 'integrated development environment'],
  'Open Source': ['open source', 'open source software'],
  'Web3 / Crypto': ['web3', 'cryptocurrency', 'cryptocurrencies', 'bitcoin', 'ethereum'],
  'Game Dev': ['game development', 'game developer', 'game engine', 'unreal engine', 'godot'],
  'No-Code / Low-Code': ['no code', 'low code', 'visual programming'],
  'Architecture': ['software architecture', 'system architecture', 'distributed systems', 'microservices'],
  'Testing & QA': ['software testing', 'unit testing', 'integration testing', 'test automation', 'quality assurance'],
  'API Design': ['api design', 'rest api', 'restful api', 'openapi'],
  'Venture Capital': ['venture capital', 'venture capitalist'],
  'Growth Marketing': ['growth marketing', 'growth hacking', 'conversion optimization'],
  'UI/UX Design': ['ux design', 'ui design', 'user experience design', 'user interface design', 'usability testing'],
  'SEO & Content': ['search engine optimization', 'seo', 'content marketing'],
  'Newsletter & Writing': ['newsletter', 'newsletters', 'copywriting'],
  'FinTech': ['fintech', 'financial technology'],
  'Career Growth': ['career development', 'career growth', 'career advice', 'job interview'],
  'Freelancing': ['freelancing', 'freelancer', 'freelance work'],
  'Side Projects': ['side project', 'side projects', 'side hustle'],
  'Startup': ['startup', 'startup founder', 'product market fit'],
  'E-commerce': ['e commerce', 'ecommerce', 'online retail'],
  'Creator Economy': ['creator economy', 'creator monetization'],
  'Content Creator': ['content creator', 'content creation'],
  'Remote Work': ['remote work', 'working remotely', 'work from home'],
  'EdTech': ['edtech', 'educational technology'],
  'Health Tech': ['health technology', 'healthtech', 'digital health'],
  'Climate Tech': ['climate technology', 'climatetech', 'carbon capture'],
  'Music Discovery': ['music discovery', 'new album', 'new single', 'album review'],
  'Personal Finance': ['personal finance', 'personal budget', 'retirement savings', 'emergency fund', 'debt repayment'],
  'Mental Health': ['mental health', 'anxiety disorder', 'clinical depression', 'psychotherapy'],
  'Sports': ['sports news', 'sports highlights', 'sports results'],
  'Fashion': ['fashion', 'runway show', 'fashion week'],
  'Film & TV': ['film and tv', 'film & tv', 'television industry', 'tv production'],
  'Movies & Shows': ['movie review', 'movie trailer', 'tv series', 'television series'],
  'Pets & Animals': ['animal rescue', 'wildlife', 'animal behavior'],
  'Home & Garden': ['home and garden', 'home & garden', 'landscaping'],
  'Food & Drink': ['food and drink', 'food & drink', 'food tasting', 'beverage'],
  'Books': ['book review', 'book recommendation', 'new book release'],
  'Hardware / IoT': ['iot', 'internet of things', 'embedded systems', 'computer hardware'],
  'AR / VR': ['augmented reality', 'virtual reality', 'mixed reality'],
  'B2B / Enterprise': ['b2b', 'enterprise software', 'business to business'],
  'D2C / Consumer Apps': ['d2c', 'direct to consumer', 'consumer apps'],
  'Angel Investing': ['angel investing', 'angel investor'],
  'Product-Led Growth': ['product led growth'],
  'Sales & Revenue': ['sales strategy', 'sales pipeline', 'revenue growth'],
  'CRM': ['crm', 'customer relationship management'],
  '3D & CGI': ['3d modeling', '3d rendering', 'cgi', 'computer generated imagery'],
  'Film & Video': ['filmmaking', 'cinematography', 'video editing', 'film production'],
  'Music Production': ['music production', 'audio mixing', 'audio mastering'],
  'Supply Chain': ['supply chain', 'supply chains', 'logistics management'],
  'Operations Excellence': ['operational excellence', 'process improvement', 'lean manufacturing'],
  'BioTech': ['biotech', 'biotechnology'], 'LegalTech': ['legaltech', 'legal technology'],
  'GovTech': ['govtech', 'government technology'], 'AgriTech': ['agritech', 'agricultural technology'],
  'SpaceTech': ['spacetech', 'space technology'], 'PropTech': ['proptech', 'property technology'],
  'RetailTech': ['retailtech', 'retail technology'], 'FoodTech': ['foodtech', 'food technology'],
  'SportsTech': ['sportstech', 'sports technology'],
  'Nonprofit Impact': ['nonprofit impact', 'charitable giving'],
  'Recruiting & Hiring': ['recruiting', 'recruitment', 'talent acquisition', 'hiring process'],
  'Diversity & Inclusion': ['diversity and inclusion', 'diversity & inclusion', 'workplace inclusion'],
  'People Ops': ['people operations', 'human resources'],
  'Podcasting': ['podcasting', 'podcast', 'podcasts'],
  'YouTube & Video': ['youtube channel', 'youtube creator', 'youtube video'],
  'Social Media': ['social media', 'social networking'],
  'Subscription Businesses': ['subscription business', 'subscription model', 'recurring revenue'],
  'Yoga & Meditation': ['yoga', 'yogic', 'pranayama'],
  'Running & Cycling': ['marathon training', 'running training', 'cycling', 'bicycle racing'],
  'Nutrition & Diet': ['nutrition', 'dietary', 'balanced diet', 'dietitian'],
  'Live Events & Concerts': ['concert', 'concerts', 'music festival', 'concert tour'],
  'DJing & Remixing': ['djing', 'remixing', 'dj set'],
  'Football & Soccer': ['football', 'soccer'], 'Basketball': ['basketball', 'nba'],
  'Tennis & Golf': ['tennis', 'golf'], 'Combat Sports': ['boxing', 'mixed martial arts', 'jiu jitsu', 'wrestling'],
  'Esports & Competitive Gaming': ['esports', 'competitive gaming', 'gaming tournament'],
  'Art & Painting': ['fine art', 'oil painting', 'watercolor painting', 'art exhibition'],
  'Theatre & Performing Arts': ['theatre', 'theater production', 'performing arts', 'stage performance'],
  'Museums & Galleries': ['museum', 'museums', 'art gallery'],
  'Restaurant Culture': ['restaurant review', 'restaurant opening', 'fine dining'],
  'Wine & Spirits': ['wine', 'winemaking', 'whisky', 'whiskey', 'distillery'],
  'Coffee Culture': ['coffee', 'espresso', 'barista'],
  'Baking & Pastry': ['baking', 'sourdough', 'pastry', 'patisserie'],
  'Solo Travel': ['solo travel', 'traveling solo', 'travelling solo'],
  'Cultural Tourism': ['cultural tourism', 'heritage tourism'],
  'Budget Travel': ['budget travel', 'cheap flights', 'travel deals'],
  'Sustainable Fashion': ['sustainable fashion', 'ethical fashion'],
  'Beauty & Skincare': ['skincare', 'skin care', 'cosmetics', 'makeup tutorial'],
  'Reading & Book Clubs': ['book club', 'reading group'],
  'Fiction & Storytelling': ['fiction writing', 'storytelling', 'short story'],
  'Non-Fiction & Learning': ['nonfiction', 'non fiction', 'lifelong learning'],
  'Poetry & Creative Writing': ['poetry', 'poem', 'creative writing'],
  'Video Games': ['video game', 'video games', 'playstation', 'xbox', 'nintendo'],
  'Mobile Gaming': ['mobile gaming', 'mobile game', 'mobile games'],
  'Game Streaming & Content': ['game streaming', 'gaming livestream', 'twitch streamer'],
  'Tabletop & Board Games': ['board game', 'board games', 'tabletop gaming', 'dungeons and dragons'],
  'Interior Design & Decor': ['interior design', 'interior decor', 'home decor'],
  'Home Improvement': ['home renovation', 'home improvement', 'kitchen remodel'],
  'Gardening & Plants': ['gardening', 'houseplants', 'vegetable garden'],
  'Pet Ownership': ['pet care', 'dog training', 'cat care', 'pet adoption'],
  'Mindfulness & Meditation': ['mindfulness', 'mindful meditation', 'meditation practice'],
  'Philosophy & Ethics': ['philosophy', 'moral philosophy', 'ethical theory'],
  'Parenting & Family': ['parenting', 'childcare', 'child care'],
  'Environmental Activism': ['environmental activism', 'climate activism'],
  'Zero Waste Living': ['zero waste', 'plastic free living'],
  'Medicine & Clinical Practice': ['clinical practice', 'clinical medicine', 'patient diagnosis', 'hiv diagnosis'],
  'Law & Legal Practice': ['legal practice', 'case law', 'litigation'],
  'Architecture & Urban Design': ['urban design', 'urban planning', 'building design'],
  'Aviation & Aerospace': ['aviation', 'aerospace', 'aircraft'],
  'Military & Defense': ['military', 'defense policy', 'defence policy'],
  'Policy & Government': ['public policy', 'government policy', 'legislation'],
  'Accounting & Tax': ['accounting', 'taxation', 'tax return'],
  'Insurance & Risk': ['insurance', 'risk management'],
  'Agriculture & Farming': ['agriculture', 'farming', 'crop production'],
  'Pharmaceutical & Drug Development': ['pharmaceutical', 'drug development', 'drug discovery'],
  'Psychology & Behavioral Science': ['psychology', 'behavioral science', 'behavioural science'],
  'Construction & Skilled Trades': ['construction industry', 'skilled trades', 'carpentry', 'plumbing'],
  'Manufacturing & Industry': ['manufacturing', 'industrial production'],
  'Energy & Utilities': ['renewable energy', 'power grid', 'electric utility'],
  'Environmental Science': ['environmental science', 'greenhouse gas', 'carbon dioxide pollution', 'climate change'],
  'Veterinary Science': ['veterinary', 'veterinarian'],
  'Ocean & Marine Sciences': ['oceanography', 'marine biology', 'marine science'],
  'Nonprofit Management': ['nonprofit management', 'charity management'],
  'Journalism & Media': ['journalism', 'news reporting', 'newsroom'],
  'Screenwriting & Film': ['screenwriting', 'screenplay'],
  'Culinary Arts': ['culinary', 'culinary arts'],
  'MLOps': ['mlops', 'machine learning operations'],
  'AI Ethics': ['ai ethics', 'responsible ai', 'algorithmic bias'],
  'Digital Nomad': ['digital nomad', 'digital nomads'],
  'Networking': ['professional networking', 'networking event', 'business networking'],
};
const normalize = value => String(value || '').slice(0, 16000).normalize('NFKD').toLowerCase()
  .replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC')
  .replace(/[\p{Pd}_]+/gu, ' ').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
const labelOf = value => normalize(value).replace(/^(?:r\/|#)/, '');
const compact = value => value.replace(/[^\p{L}\p{N}]/gu, '');
const escapeRegex = value => value.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
const cleanText = value => String(value || '').slice(0, 16000).replace(/<[^<>]*>|https?:\/\/[^\s<]+/giu, ' ');
const MIN_MARGIN = 2;
const contextRequiredTopics = new Set(['Go', 'Rust', 'React', 'Node', 'Architecture', 'Networking']);
const termPatterns = new Map(), topicRuleCache = new WeakMap(), subtopicRuleCache = new Map();
const isUnknownTopic = value => UNKNOWN.includes(String(value || '').trim().toLowerCase());
const TOPIC_EVIDENCE_VERSION = createHash('sha256')
  .update(JSON.stringify(['subject-evidence-v1', ALIASES, SPECIFIC_SUBTOPICS, GENERAL_SUBTOPICS, RELATED_SUBTOPICS, GROUP_CATEGORY_TOPICS]))
  .digest('hex').slice(0, 16);

const categorySubtopics = new Map();
for (const [label, topics] of Object.entries(GROUP_CATEGORY_TOPICS)) {
  for (const topic of topics) {
    if (!categorySubtopics.has(topic)) categorySubtopics.set(topic, {});
    categorySubtopics.get(topic)[label] = [];
  }
}

function compileTerms(values) {
  return [...new Set(values.map(labelOf).filter(Boolean))].map(term => {
    if (!termPatterns.has(term)) {
      if (termPatterns.size >= 2048) termPatterns.clear();
      termPatterns.set(term, new RegExp('(?:^|[^\\p{L}\\p{N}])' + escapeRegex(term) + '(?=$|[^\\p{L}\\p{N}])', 'u'));
    }
    return { term, pattern: termPatterns.get(term), tag: compact(term) };
  });
}

function evidenceFields(post) {
  const tags = new Set();
  function capture(value) {
    return normalize(cleanText(value).normalize('NFKC').replace(/(?:^|[^\p{L}\p{N}#])#([\p{L}\p{N}_]{1,60})(?=$|[^\p{L}\p{N}_])/gu, (_match, tag) => {
      if (tags.size < 24) tags.add(compact(normalize(tag)));
      return ' ';
    }));
  }
  return { title: capture(post.title), body: capture(post.content), tags };
}

function termMatch(fields, { term, pattern, tag }) {
  if (fields.title.includes(term) && pattern.test(fields.title)) return { term, field: 'title', score: 5 };
  if (tag.length >= 3 && fields.tags.has(tag)) return { term, field: 'hashtag', score: 4 };
  if (fields.body.includes(term) && pattern.test(fields.body)) return { term, field: 'body', score: 3 };
  return null;
}

function subtopicRules(topic) {
  const related = RELATED_SUBTOPICS[topic] || {};
  const rules = { ...SPECIFIC_SUBTOPICS[topic] };
  for (const [name, terms] of Object.entries(related)) {
    rules[name] = [...new Set([...(rules[name] || []), name, ...terms].map(labelOf))];
  }
  return { ...rules, ...categorySubtopics.get(topic), ...GENERAL_SUBTOPICS };
}

function compiledSubtopics(topic) {
  const key = Object.hasOwn(SPECIFIC_SUBTOPICS, topic) || Object.hasOwn(RELATED_SUBTOPICS, topic) ? topic : null;
  if (!subtopicRuleCache.has(key)) {
    const rules = subtopicRules(key);
    const names = [...new Set([...Object.keys(SPECIFIC_SUBTOPICS[key] || {}), ...Object.keys(RELATED_SUBTOPICS[key] || {})])];
    const subject = names.map(name => ({ name, terms: compileTerms(rules[name]) }));
    subtopicRuleCache.set(key, { subject, related: subject.filter(({ name }) => Object.hasOwn(RELATED_SUBTOPICS[key] || {}, name)),
      general: Object.entries(GENERAL_SUBTOPICS).map(([name, terms]) => ({ name, terms: compileTerms(terms) })) });
  }
  return subtopicRuleCache.get(key);
}

function topicCatalog(topics) {
  let cached = topicRuleCache.get(topics);
  if (!cached || cached.names.length !== topics.length || cached.names.some((name, index) => name !== topics[index])) {
    const names = [...new Set(topics)].filter(topic => typeof topic === 'string' && !isUnknownTopic(topic));
    cached = { names: [...topics], byLabel: new Map(names.map(topic => [labelOf(topic), topic])),
      rules: names.map(topic => ({ topic, terms: compileTerms([...(contextRequiredTopics.has(topic) ? [] : [topic]), ...(ALIASES[topic] || [])]),
        related: compiledSubtopics(topic).related })),
    };
    topicRuleCache.set(topics, cached);
  }
  return cached;
}

// Aliases for a single subject establish one signal. Repeating spellings or
// hashtags does not let that subject win against a competing one.
function subtopicMatches(fields, rules) {
  return rules.flatMap(({ name, terms }) => {
    const evidence = terms.map(term => termMatch(fields, term)).filter(Boolean).sort((a, b) => b.score - a.score);
    return evidence.length ? [{ name, score: evidence[0].score, evidence }] : [];
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
const leading = matches => matches.length && (!matches[1] || matches[0].score - matches[1].score >= MIN_MARGIN) ? matches[0] : null;

function rankCandidates(fields, catalog, includeSubjects) {
  const matches = [];
  for (const { topic, terms, related } of catalog.rules) {
    const direct = terms.map(term => termMatch(fields, term)).filter(Boolean);
    const textScore = direct.reduce((total, item) => item.field === 'hashtag' ? total : total + item.score + Number(item.term.includes(' ')), 0);
    const score = Math.max(textScore, direct.some(item => item.field === 'hashtag') ? 4 : 0);
    const subject = includeSubjects && subtopicMatches(fields, related)[0];
    if (subject && subject.score >= score) matches.push({ topic, score: subject.score, evidence: subject.evidence });
    else if (score) matches.push({ topic, score, evidence: direct.sort((a, b) => b.score - a.score) });
  }
  return matches.sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic));
}

function rankTopicCandidates(post, topics) {
  return rankCandidates(evidenceFields(post), topicCatalog(topics), false)
    .map(({ topic, score, evidence }) => ({ topic, score, evidence: evidence.map(item => item.term) }));
}

function classifyTopic(post, topics, matches = rankTopicCandidates(post, topics)) {
  const best = leading(matches) || matches.find(row => row.topic === post.topic && row.score === matches[0].score);
  return best ? { ...best, subtopic: classifyRoutingSubtopic(post, best.topic) } : null;
}

function publicGroupSubject(group, catalog) {
  const name = labelOf(group?.subreddit || group?.name);
  if (!name || group.isPrivate) return null;
  const current = catalog.byLabel.get(name);
  const subjects = catalog.rules.flatMap(({ topic, related }) => related
    .filter(rule => rule.terms.some(term => term.term === name)).map(rule => ({ topic, subtopic: rule.name })));
  if (subjects.length === 1 && (!current || current === subjects[0].topic)) return { ...subjects[0], name };
  if (current) return { topic: current, name };
  const exact = catalog.rules.filter(({ terms }) => terms.some(term => term.term === name));
  return exact.length === 1 ? { topic: exact[0].topic, name } : null;
}

function subtopicDecision(fields, topic, groupSubject, sourceSubject) {
  const rules = compiledSubtopics(topic);
  const matches = subtopicMatches(fields, rules.subject);
  const subject = leading(matches);
  if (subject) return { subtopic: subject.name, subtopicEvidence: subject.evidence[0].field };
  if (matches.length) return { subtopic: null, subtopicAmbiguous: true };
  if (sourceSubject) return { subtopic: sourceSubject, subtopicEvidence: 'source-topic' };
  if (groupSubject?.topic === topic && groupSubject?.subtopic) return { subtopic: groupSubject.subtopic, subtopicEvidence: 'public-group' };
  const general = leading(subtopicMatches(fields, rules.general));
  return { subtopic: general?.name || null, subtopicEvidence: general?.evidence[0].field };
}

function classifyRoutingSubtopic(post, topic, group) {
  return subtopicDecision(evidenceFields(post), topic, group && publicGroupSubject(group, topicCatalog([topic]))).subtopic;
}

function classifySubtopic(post, topic) {
  return classifyRoutingSubtopic(post, topic);
}

// Return the competing labels as well as the winning route so callers never
// need to apply a fallback when the content itself supplies conflicting clues.
function assessPostTopic(post, topics, { group } = {}) {
  const catalog = topicCatalog(topics);
  const fields = evidenceFields(post);
  const label = labelOf(post.topic);
  const current = catalog.byLabel.get(label);
  const groupSubject = publicGroupSubject(group, catalog);
  const route = (topic, evidence, evidenceSource, confidence, sourceSubject) => ({
    topic, ...subtopicDecision(fields, topic, groupSubject, sourceSubject), evidence, evidenceSource, confidence,
  });
  if (current) return { decision: route(current, [], 'existing-topic', 'high') };

  const matches = rankCandidates(fields, catalog, true);
  const match = leading(matches);
  if (match) return { decision: route(match.topic, match.evidence.map(item => item.term),
    match.evidence[0].field, match.score >= 5 ? 'high' : 'medium') };
  if (matches.length) return { competing: matches.filter(item => matches[0].score - item.score < MIN_MARGIN).map(item => item.topic) };

  if (!isUnknownTopic(label)) {
    const sourceFields = evidenceFields({ title: label });
    const sourceMatches = rankCandidates(sourceFields, catalog, true);
    const source = leading(sourceMatches);
    if (source) {
      const subject = leading(subtopicMatches(sourceFields, compiledSubtopics(source.topic).subject));
      return { decision: route(source.topic, source.evidence.map(item => item.term), 'source-topic', 'medium', subject?.name) };
    }
    if (sourceMatches.length) return { competing: sourceMatches.filter(item => sourceMatches[0].score - item.score < MIN_MARGIN).map(item => item.topic) };
  }
  if (groupSubject) return { decision: route(groupSubject.topic, [groupSubject.name], 'public-group', 'medium') };
  return {};
}

function resolvePostTopic(post, topics, options) {
  return assessPostTopic(post, topics, options).decision || null;
}

function createOfficeTopicTransfer({ db, topics, transfer, onClassified = () => {}, topicAgents = null, guardian = null, groupForPost = () => null }) {
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
    const guardianState = guardian ? await guardian.snapshot() : null;
    const assigned = new Map((routing?.agents || []).flatMap(agent => agent.topics.map(topic => [topic,agent.id])));
    return { available: true, generatedAt: new Date().toISOString(), topics: [...byTopic.values()].map(item => ({ ...item, agentId: assigned.get(item.topic) || null })).sort((a, b) => b.staged - a.staged || b.live - a.live || a.topic.localeCompare(b.topic)), unknown: { live: unknown.live, staged: unknown.staged }, taxonomy: [...byTopic.values()].map(item => ({ topic: item.topic, subtopics: item.subtopics.map(subtopic => subtopic.name) })), agents: routing?.agents || [], routing, guardian: guardianState,
      note: guardian ? 'The Unknown topic guardian targets zero Unknown live posts and protects the 500 ceiling. Ambiguous posts are preserved separately for review and retry; held posts are not included in live inventory.' : topicAgents ? 'Counts are stored live and staging inventory. Each topic has an assigned routing agent. New writes are classified immediately; recovery checks every 15 seconds. Ambiguous content remains Unknown or Unclassified and retries later.' : 'Counts are stored live and staging inventory. Unknown topics remain visible when content evidence is ambiguous. Subtopics are assigned by bounded optimization passes; unreviewed items remain Unclassified.' };
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
            const { rows } = await client.query(`SELECT p.id,p.title,p.content,p.topic${topicAgents ? ',p.group_id,p.source,p.source_url' : ''} FROM ${table} p
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
              const group = groupForPost(post), guessed = resolvePostTopic(post, topics, { group });
              const topic = guessed?.topic || post.topic, subtopic = guessed?.subtopic || (topic ? classifyRoutingSubtopic(post, topic, group) : null);
              if (topic && topic !== post.topic) { const result = await client.query(`UPDATE ${table} SET topic=$2 WHERE id=$1 AND topic IS NOT DISTINCT FROM $3`, [post.id, topic, post.topic]); updated += result.rowCount || 0; if (result.rowCount) changes.push({ id: post.id, topic, subtopic }); }
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
module.exports = { OFFICE_TOPIC_SCHEMA, UNKNOWN, isUnknownTopic, classifyTopic, classifySubtopic, classifyRoutingSubtopic, assessPostTopic, resolvePostTopic, TOPIC_EVIDENCE_VERSION,
  rankTopicCandidates, subtopicRules, createOfficeTopicTransfer, registerOfficeTopicRoutes };
