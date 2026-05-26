const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const https = require('https');
const db = require('./db');

dotenv.config();

const app = express();
app.use(helmet());

// Allow web frontend origin in production, all origins in dev
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : true; // allow all in dev
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Health-check endpoint (used by AWS load balancer / monitoring)
app.get('/health', (_req, res) => res.json({ status: 'ok', db: db.isConnected() }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';

// ─── Time helpers ─────────────────────────────────────────────────────────────
const NOW = Date.now();
const ago = (ms) => new Date(NOW - ms).toISOString();
const H = 3600000;
const D = 86400000;

// ─── Role → category mapping ─────────────────────────────────────────────────
const ROLE_CATEGORIES = {
  'Engineer / Developer':       ['Engineering', 'AI & ML'],
  'Designer / Creative':        ['Design', 'Marketing'],
  'Product Manager':            ['AI & ML', 'Startups', 'Engineering'],
  'Marketer / Growth':          ['Marketing', 'Startups'],
  'Founder / Entrepreneur':     ['Startups', 'Finance', 'Marketing'],
  'Investor':                   ['Finance', 'Startups'],
  'Data / Analytics':           ['AI & ML', 'Engineering'],
  'Student / Learner':          ['Education', 'Engineering'],
  'Sales / Business Dev':       ['Startups', 'Marketing', 'Finance'],
  'Operations / Finance':       ['Finance', 'Startups'],
  'Content Creator':            ['Marketing', 'Design', 'Education'],
  'Community Manager':          ['Marketing', 'Education'],
  'Researcher / Academic':      ['AI & ML', 'Education', 'Engineering'],
  'HR / People Ops':            ['Education', 'Startups'],
};

// ─── Interest → category mapping ─────────────────────────────────────────────
// Maps fine-grained onboarding interests to group categories
const INTEREST_TO_CATEGORY = {
  // AI & ML
  'Machine Learning': 'AI & ML', 'Deep Learning': 'AI & ML', 'LLMs / GPT': 'AI & ML',
  'Computer Vision': 'AI & ML', 'NLP / Text AI': 'AI & ML', 'AI Ethics': 'AI & ML',
  'Data Science': 'AI & ML', 'MLOps': 'AI & ML', 'AI Research': 'AI & ML',
  'Robotics': 'Engineering', 'Autonomous Vehicles': 'Engineering',
  // Engineering
  'Web Development': 'Engineering', 'Mobile Development': 'Engineering',
  'DevOps / Cloud': 'Engineering', 'Cybersecurity': 'Engineering',
  'Blockchain / Web3': 'Engineering', 'Open Source': 'Engineering',
  'System Design': 'Engineering', 'API Design': 'Engineering',
  'Frontend Dev': 'Engineering', 'Backend Dev': 'Engineering',
  'Game Development': 'Engineering',
  // Business / Startups
  'Startups': 'Startups', 'SaaS': 'Startups', 'Bootstrapping': 'Startups',
  'VC / Fundraising': 'Finance', 'Product-Market Fit': 'Startups',
  'Growth Hacking': 'Marketing', 'B2B Sales': 'Startups',
  'No-Code / Low-Code': 'Engineering',
  // Design
  'UX / UI Design': 'Design', 'Product Design': 'Design', 'Branding': 'Design',
  'Motion Design': 'Design', 'Design Systems': 'Design', 'Typography': 'Design',
  'Visual Design': 'Design', 'Illustration': 'Design', 'Figma / Sketch': 'Design',
  // Finance
  'Personal Finance': 'Finance', 'Investing': 'Finance', 'Crypto / DeFi': 'Finance',
  'Fintech': 'Finance', 'Real Estate': 'Finance', 'Stock Market': 'Finance',
  'Budgeting': 'Finance', 'Tax Strategy': 'Finance',
  // Marketing
  'Content Marketing': 'Marketing', 'SEO / SEM': 'Marketing', 'Social Media': 'Marketing',
  'Email Marketing': 'Marketing', 'Paid Ads': 'Marketing', 'Influencer Marketing': 'Marketing',
  'Brand Strategy': 'Marketing', 'Copywriting': 'Marketing', 'Analytics': 'AI & ML',
  // Remote Work
  'Remote Work': 'Remote Work', 'Freelancing': 'Remote Work', 'Digital Nomad': 'Remote Work',
  'Async Work': 'Remote Work', 'Work-Life Balance': 'Remote Work',
  // Education
  'Online Learning': 'Education', 'Career Switching': 'Education', 'Mentorship': 'Education',
  'Bootcamps': 'Education', 'Academic Research': 'Education', 'Certifications': 'Education',
  // People / Culture
  'Diversity & Inclusion': 'Education', 'Leadership': 'Startups', 'Team Building': 'Startups',
  'Mental Health': 'Education', 'Productivity': 'Education',
  // Content / Media
  'Podcasting': 'Marketing', 'YouTube / Video': 'Marketing', 'Newsletter': 'Marketing',
  'Technical Writing': 'Engineering', 'Blogging': 'Marketing',
  // E-commerce
  'E-commerce': 'Startups', 'Dropshipping': 'Startups', 'Amazon FBA': 'Startups',
  'Shopify': 'Startups', 'D2C Brands': 'Startups',
};

// ─── Interest → subreddit mapping ────────────────────────────────────────────
const INTEREST_TO_SUBREDDIT = {
  'Machine Learning':   ['MachineLearning','deeplearning'],
  'Deep Learning':      ['deeplearning','MachineLearning'],
  'LLMs / GPT':         ['LocalLLaMA','singularity'],
  'NLP / Text AI':      ['LanguageModelRoundup','MachineLearning'],
  'Computer Vision':    ['computervision','MachineLearning'],
  'AI Ethics':          ['AIethics','artificial'],
  'AI Research':        ['MachineLearning','artificial'],
  'Data Science':       ['datascience','datasets'],
  'MLOps':              ['mlops','devops'],
  'Web Development':    ['webdev','programming'],
  'Mobile Development': ['androiddev','iOSProgramming'],
  'DevOps / Cloud':     ['devops','aws'],
  'Cybersecurity':      ['netsec','cybersecurity'],
  'Blockchain / Web3':  ['ethereum','defi'],
  'Open Source':        ['opensource','programming'],
  'System Design':      ['ExperiencedDevs','programming'],
  'Frontend Dev':       ['webdev','javascript'],
  'Backend Dev':        ['node','golang'],
  'Game Development':   ['gamedev','gamedesign'],
  'Startups':           ['startups','entrepreneur'],
  'SaaS':               ['SaaS','startups'],
  'Bootstrapping':      ['entrepreneur','smallbusiness'],
  'VC / Fundraising':   ['venturecapital','startups'],
  'Growth Hacking':     ['GrowthHacking','startups'],
  'B2B Sales':          ['sales','startups'],
  'UX / UI Design':     ['UXDesign','userexperience'],
  'Product Design':     ['ProductDesign','UXDesign'],
  'Branding':           ['graphic_design','branding'],
  'Design Systems':     ['UXDesign','webdev'],
  'Visual Design':      ['graphic_design','design'],
  'Illustration':       ['learnart','illustration'],
  'Personal Finance':   ['personalfinance','FinancialPlanning'],
  'Investing':          ['investing','stocks'],
  'Crypto / DeFi':      ['CryptoCurrency','defi'],
  'Fintech':            ['fintech','CryptoCurrency'],
  'Stock Market':       ['stocks','investing'],
  'Content Marketing':  ['marketing','content_marketing'],
  'SEO / SEM':          ['SEO','bigseo'],
  'Social Media':       ['socialmedia','marketing'],
  'Email Marketing':    ['Emailmarketing','marketing'],
  'Copywriting':        ['copywriting','marketing'],
  'Remote Work':        ['remotework','digitalnomad'],
  'Freelancing':        ['freelance','digitalnomad'],
  'Digital Nomad':      ['digitalnomad','remotework'],
  'Online Learning':    ['learnprogramming','edtech'],
  'Career Switching':   ['cscareerquestions','learnprogramming'],
  'Mentorship':         ['cscareerquestions','ExperiencedDevs'],
  'Podcasting':         ['podcasting','content_marketing'],
  'Technical Writing':  ['technicalwriting','writing'],
  'Blogging':           ['blogging','writing'],
  'E-commerce':         ['ecommerce','shopify'],
  'Shopify':            ['shopify','ecommerce'],
};

// Role → subreddits
const ROLE_TO_SUBREDDITS = {
  'Engineer / Developer':     ['programming','webdev','devops'],
  'Designer / Creative':      ['UXDesign','graphic_design','userexperience'],
  'Product Manager':          ['ProductManagement','startups','UXDesign'],
  'Marketer / Growth':        ['marketing','GrowthHacking','SEO'],
  'Founder / Entrepreneur':   ['entrepreneur','startups','SaaS'],
  'Investor':                 ['venturecapital','investing','startups'],
  'Data / Analytics':         ['datascience','MachineLearning','datasets'],
  'Student / Learner':        ['learnprogramming','cscareerquestions','webdev'],
  'Sales / Business Dev':     ['sales','startups','entrepreneur'],
  'Operations / Finance':     ['personalfinance','investing','entrepreneur'],
  'Content Creator':          ['content_marketing','podcasting','blogging'],
  'Community Manager':        ['community','socialmedia','marketing'],
  'Researcher / Academic':    ['MachineLearning','science','datascience'],
  'HR / People Ops':          ['humanresources','cscareerquestions','startups'],
};

// ─── Reddit live post fetching ────────────────────────────────────────────────
const redditCache = new Map(); // subreddit → { posts, fetchedAt }
const REDDIT_TTL  = 30 * 60 * 1000; // 30 minutes

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': 'UFIConnect/1.0 (https://uficonnect.org)',
        'Accept': 'application/json',
      },
    };
    https.get(url, opts, (res) => {
      // Follow one redirect
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchJSON(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse failed for ${url}: ${e.message}`)); }
      });
    }).on('error', reject).setTimeout(8000, function() { this.destroy(new Error('timeout')); });
  });
}

async function fetchSubredditPosts(sub) {
  const cached = redditCache.get(sub);
  if (cached && Date.now() - cached.fetchedAt < REDDIT_TTL) return cached.posts;

  try {
    const data = await fetchJSON(`https://www.reddit.com/r/${sub}/hot.json?limit=8&raw_json=1`);
    const posts = (data?.data?.children || [])
      .filter(({ data: p }) => !p.stickied && !p.over_18)
      .map(({ data: p }) => {
        // Find a matching group in our groups array
        const matchedGroup = groups.find((g) => g.subreddit === sub || g.subreddit?.toLowerCase() === sub.toLowerCase());
        return {
          id:            `reddit_${p.id}`,
          authorId:      `reddit_${p.author}`,
          groupId:       matchedGroup?.id || `ext_${sub.toLowerCase()}`,
          content:       p.selftext?.slice(0, 500) || p.title,
          title:         p.title,
          url:           `https://reddit.com${p.permalink}`,
          source:        'reddit',
          sourceLabel:   `r/${sub}`,
          sourceUrl:     `https://reddit.com${p.permalink}`,
          author:        { id: `reddit_${p.author}`, name: `u/${p.author}`, title: `r/${sub}`, organization: 'Reddit' },
          likes:         [],
          likesCount:    p.ups || 0,
          commentsCount: p.num_comments || 0,
          createdAt:     new Date(p.created_utc * 1000).toISOString(),
          isExternal:    true,
          group:         matchedGroup
            ? { id: matchedGroup.id, name: matchedGroup.name, category: matchedGroup.category }
            : { id: `ext_${sub}`, name: `r/${sub}`, category: 'Engineering' },
        };
      });
    redditCache.set(sub, { posts, fetchedAt: Date.now() });
    return posts;
  } catch (e) {
    console.warn(`Reddit fetch r/${sub}:`, e.message);
    return redditCache.get(sub)?.posts || [];
  }
}

async function getPersonalizedRedditPosts(interests = [], role = '') {
  // Collect subreddits from interests + role, deduplicate, take up to 6
  const subSet = new Set();
  (ROLE_TO_SUBREDDITS[role] || []).forEach((s) => subSet.add(s));
  interests.forEach((i) => (INTEREST_TO_SUBREDDIT[i] || []).forEach((s) => subSet.add(s)));
  if (subSet.size === 0) ['programming','startups','MachineLearning'].forEach((s) => subSet.add(s));

  const subs = [...subSet].slice(0, 6);
  const results = await Promise.all(subs.map(fetchSubredditPosts));
  return results.flat();
}

// ─── Platform config (OAuth metadata) ────────────────────────────────────────
const PLATFORMS = {
  linkedin: {
    name: 'LinkedIn', color: '#0A66C2', icon: 'linkedin',
    description: 'Import your professional profile and network activity.',
    scopes: ['r_liteprofile', 'r_emailaddress', 'r_posts'],
    authUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    loginUrl: 'https://www.linkedin.com/login',
    setupUrl: 'https://www.linkedin.com/developers/apps',
    reviewRequired: true,
    note: 'r_posts requires LinkedIn Partner Program access.',
  },
  github: {
    name: 'GitHub', color: '#24292F', icon: 'github',
    description: 'Showcase your repos, contributions, and open-source work.',
    scopes: ['read:user', 'public_repo'],
    authUrl: 'https://github.com/login/oauth/authorize',
    loginUrl: 'https://github.com/login',
    setupUrl: 'https://github.com/settings/apps',
    reviewRequired: false,
    note: null,
  },
  twitter: {
    name: 'X (Twitter)', color: '#000000', icon: 'twitter',
    description: 'Follow hashtags and conversations in your fields.',
    scopes: ['tweet.read', 'users.read', 'follows.read'],
    authUrl: 'https://twitter.com/i/oauth2/authorize',
    loginUrl: 'https://twitter.com/i/flow/login',
    setupUrl: 'https://developer.twitter.com/en/portal/dashboard',
    reviewRequired: false,
    note: 'Basic tier API required ($100/month). Elevated access for higher volume.',
  },
  instagram: {
    name: 'Instagram', color: '#E1306C', icon: 'instagram',
    description: 'Import your posts and follow industry creators.',
    scopes: ['user_profile', 'user_media'],
    authUrl: 'https://api.instagram.com/oauth/authorize',
    loginUrl: 'https://www.instagram.com/accounts/login/',
    setupUrl: 'https://developers.facebook.com/apps',
    reviewRequired: false,
    note: 'Instagram Basic Display API. Requires a Facebook Developer account.',
  },
  facebook: {
    name: 'Facebook', color: '#1877F2', icon: 'facebook',
    description: 'See posts and discussions from your Facebook Groups.',
    scopes: ['email', 'public_profile', 'user_posts', 'groups_access_member_info'],
    authUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    loginUrl: 'https://www.facebook.com/login',
    setupUrl: 'https://developers.facebook.com/apps',
    reviewRequired: true,
    note: 'user_posts and groups_access_member_info require Facebook App Review.',
  },
  discord: {
    name: 'Discord', color: '#5865F2', icon: 'discord',
    description: 'Connect with servers and communities in your field.',
    scopes: ['identify', 'guilds'],
    authUrl: 'https://discord.com/api/oauth2/authorize',
    loginUrl: 'https://discord.com/login',
    setupUrl: 'https://discord.com/developers/applications',
    reviewRequired: false,
    note: null,
  },
  youtube: {
    name: 'YouTube', color: '#FF0000', icon: 'youtube',
    description: 'Follow channels and surface video content in your areas.',
    scopes: ['https://www.googleapis.com/auth/youtube.readonly'],
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    loginUrl: 'https://accounts.google.com/ServiceLogin?service=youtube',
    setupUrl: 'https://console.cloud.google.com/apis',
    reviewRequired: false,
    note: null,
  },
  reddit: {
    name: 'Reddit', color: '#FF4500', icon: 'reddit',
    description: 'Pull posts from subreddits matching your interests.',
    scopes: ['read', 'identity', 'subscribe'],
    authUrl: 'https://www.reddit.com/api/v1/authorize',
    loginUrl: 'https://www.reddit.com/login',
    setupUrl: 'https://www.reddit.com/prefs/apps',
    reviewRequired: false,
    note: 'Free API. Register an app at reddit.com/prefs/apps to get credentials.',
  },
  medium: {
    name: 'Medium', color: '#000000', icon: 'medium',
    description: 'Follow writers and surface articles in your areas of interest.',
    scopes: ['basicProfile', 'publishPost'],
    authUrl: 'https://medium.com/m/oauth/authorize',
    loginUrl: 'https://medium.com/m/signin',
    setupUrl: 'https://medium.com/me/settings/security',
    reviewRequired: false,
    note: null,
  },
  dribbble: {
    name: 'Dribbble', color: '#EA4C89', icon: 'dribbble',
    description: 'Showcase your design work and follow top creatives.',
    scopes: ['public'],
    authUrl: 'https://dribbble.com/oauth/authorize',
    loginUrl: 'https://dribbble.com/session/new',
    setupUrl: 'https://dribbble.com/account/applications/new',
    reviewRequired: false,
    note: null,
  },
  behance: {
    name: 'Behance', color: '#1769FF', icon: 'behance',
    description: 'Display your creative portfolio and discover design projects.',
    scopes: ['activity_read', 'project_read'],
    authUrl: 'https://www.behance.net/v2/oauth/authenticate',
    loginUrl: 'https://www.behance.net/signin',
    setupUrl: 'https://www.adobe.io/',
    reviewRequired: false,
    note: null,
  },
  indeed: {
    name: 'Indeed', color: '#003A9B', icon: 'indeed',
    description: 'Get job recommendations matched to your profile and groups.',
    scopes: ['employer', 'resume_read', 'job_search'],
    authUrl: 'https://secure.indeed.com/account/oauth2/v2/authorize',
    loginUrl: 'https://secure.indeed.com/account/login',
    setupUrl: 'https://developer.indeed.com',
    reviewRequired: true,
    note: 'Indeed Publisher API. Apply at developer.indeed.com for API access.',
  },
};

// ─── Mock social posts per platform ──────────────────────────────────────────
const SOCIAL_POSTS = {
  facebook: [
    { id: 'fb1', platform: 'facebook', source: 'Product Builders Group', author: 'James Liu', avatar: 'JL', content: 'Our PM community just hit 50k members. Running a free workshop on AI feature prioritisation next Thursday — link in comments.', time: ago(1.2*H), likes: 312, comments: 47 },
    { id: 'fb2', platform: 'facebook', source: 'Remote Work Collective', author: 'Priya Nair', avatar: 'PN', content: 'Poll results: 78% of remote workers say async-first culture is the single biggest driver of productivity. Not tools, not meetings — culture.', time: ago(5*H), likes: 891, comments: 134 },
    { id: 'fb3', platform: 'facebook', source: 'Startup Founders Hub', author: 'Marco Rossi', avatar: 'MR', content: 'Just closed our Series A. 18 months of runway, 8 months of hard work. The fundraising advice I wish I had: your deck tells a story, not a business plan.', time: ago(1*D), likes: 2103, comments: 289 },
  ],
  instagram: [
    { id: 'ig1', platform: 'instagram', source: '@ux_weekly', author: 'ux_weekly', avatar: 'UW', content: 'The best interfaces are the ones users never notice. Frictionless design is invisible design. Swipe for 5 principles we learned from 10k usability tests. 🎨', time: ago(3*H), likes: 4820, comments: 203 },
    { id: 'ig2', platform: 'instagram', source: '@buildinpublic', author: 'buildinpublic', avatar: 'BP', content: 'Month 6 revenue update: $0 → $8,400 MRR. No VC, no paid ads, just content and community. Thread in bio. 🚀', time: ago(8*H), likes: 7341, comments: 512 },
    { id: 'ig3', platform: 'instagram', source: '@devlife', author: 'devlife', avatar: 'DL', content: 'POV: your side project just got its first paying customer at 2am on a Tuesday. This is the way. 💻', time: ago(2*D), likes: 18900, comments: 841 },
  ],
  linkedin: [
    { id: 'li1', platform: 'linkedin', source: 'LinkedIn Feed', author: 'Sarah Okonkwo', avatar: 'SO', content: 'I interviewed 200 engineering managers this year. The #1 trait that separated great from good? They gave credit loudly and took blame quietly. Underrated leadership skill.', time: ago(2*H), likes: 14200, comments: 987 },
    { id: 'li2', platform: 'linkedin', source: 'LinkedIn Feed', author: 'David Park', avatar: 'DP', content: 'Unpopular opinion: "We move fast and break things" is not a culture — it is a warning sign. The best teams I have worked on moved thoughtfully and built things that lasted.', time: ago(11*H), likes: 8760, comments: 1240 },
    { id: 'li3', platform: 'linkedin', source: 'AI & ML in Business', author: 'Amara Diallo', avatar: 'AD', content: 'The companies winning with AI are not the ones with the most models. They are the ones who identified the exact three decisions in their workflow where AI removes the most friction.', time: ago(1.5*D), likes: 21300, comments: 2100 },
  ],
  twitter: [
    { id: 'tw1', platform: 'twitter', source: '#buildinpublic', author: '@shl', avatar: 'SH', content: 'The market does not care about your effort. It only cares about the value you deliver. Ship faster.', time: ago(45*60*1000), likes: 3420, comments: 287 },
    { id: 'tw2', platform: 'twitter', source: '#devtools', author: '@t3dotgg', avatar: 'T3', content: 'Hot take: the biggest unlock for most dev teams is not a better framework. It is writing down what "done" means before you start.', time: ago(4*H), likes: 5810, comments: 634 },
    { id: 'tw3', platform: 'twitter', source: '#startups', author: '@paulg', avatar: 'PG', content: 'The best founders are not the ones who had the clearest vision from day one. They are the ones who updated their vision the fastest when reality disagreed.', time: ago(18*H), likes: 28900, comments: 1820 },
  ],
  reddit: [
    { id: 're1', platform: 'reddit', source: 'r/MachineLearning', author: 'u/ml_practitioner', avatar: 'ML', content: 'We benchmarked 12 embedding models on our proprietary dataset. Results were surprising — the 7B parameter model outperformed GPT-4 on domain-specific retrieval by 23%. Full write-up with methodology in comments.', time: ago(6*H), likes: 2341, comments: 412 },
    { id: 're2', platform: 'reddit', source: 'r/startups', author: 'u/bootstrapped_founder', avatar: 'BF', content: 'After 4 failed startups, number 5 just hit profitability. The difference? I stopped building what I thought was cool and started building what one specific person desperately needed.', time: ago(14*H), likes: 8920, comments: 1034 },
    { id: 're3', platform: 'reddit', source: 'r/ExperiencedDevs', author: 'u/senior_dev_42', avatar: 'SD', content: 'Genuine question: at what point did your team stop shipping features and start mostly paying down tech debt? Trying to understand if our 60/40 split is normal.', time: ago(3*H), likes: 1203, comments: 289 },
  ],
};

// ─── Mock Indeed job listings ─────────────────────────────────────────────────
const INDEED_JOBS = [
  { id: 'j1', title: 'Senior ML Engineer', company: 'Anthropic', location: 'San Francisco, CA', type: 'Full-time', salary: '$220k–$280k', tags: ['PyTorch', 'LLMs', 'Python'], posted: ago(1*D) },
  { id: 'j2', title: 'Product Manager, AI', company: 'Scale AI', location: 'Remote', type: 'Full-time', salary: '$160k–$210k', tags: ['AI', 'Roadmapping', 'Data'], posted: ago(2*D) },
  { id: 'j3', title: 'Senior UX Designer', company: 'Linear', location: 'Remote', type: 'Full-time', salary: '$140k–$180k', tags: ['Figma', 'Systems', 'Prototyping'], posted: ago(3*H) },
  { id: 'j4', title: 'Growth Lead', company: 'Notion', location: 'San Francisco, CA', type: 'Full-time', salary: '$150k–$190k', tags: ['Growth', 'Analytics', 'B2B'], posted: ago(8*H) },
  { id: 'j5', title: 'Staff Software Engineer', company: 'Vercel', location: 'Remote', type: 'Full-time', salary: '$200k–$260k', tags: ['React', 'Node', 'Infrastructure'], posted: ago(5*H) },
  { id: 'j6', title: 'Founding Engineer', company: 'Stealth AI Startup', location: 'Remote', type: 'Full-time', salary: '$180k + equity', tags: ['TypeScript', 'LLMs', 'Startup'], posted: ago(2*H) },
  { id: 'j7', title: 'DevRel Engineer', company: 'Supabase', location: 'Remote', type: 'Full-time', salary: '$130k–$170k', tags: ['Postgres', 'OSS', 'Content'], posted: ago(1*D) },
  { id: 'j8', title: 'Data Scientist', company: 'Figma', location: 'San Francisco, CA', type: 'Full-time', salary: '$160k–$200k', tags: ['Python', 'SQL', 'Experimentation'], posted: ago(4*H) },
];

// ─── Registered users ─────────────────────────────────────────────────────────
// Live users — populated from PostgreSQL at login/register, no hardcoded demos
let users = [];

// ─── Groups (let — reloaded from DB at startup) ───────────────────────────────
// ─── ALL_GROUPS_SEED — seeded into PostgreSQL at startup ─────────────────────
const ALL_GROUPS_SEED = [
  // ── UFIConnect internal groups ───────────────────────────────────────────────
  { id: 'g1',  category: 'AI & ML',     name: 'AI Product Managers',         description: 'Connect with PMs building AI, automation, and workflow tools.',              members: 1840, relatedGroups: ['g2','g3','g5','g11'] },
  { id: 'g2',  category: 'AI & ML',     name: 'Machine Learning Engineers',  description: 'Deep-dive discussions on models, infra, and production ML systems.',         members: 3210, relatedGroups: ['g1','g3','g4','g5','g8'] },
  { id: 'g3',  category: 'AI & ML',     name: 'Generative AI Builders',      description: 'LLMs, diffusion models, and the apps being built on top of them.',           members: 5620, relatedGroups: ['g1','g2','g4','g5','g7'] },
  { id: 'g4',  category: 'AI & ML',     name: 'Data Scientists Hub',         description: 'Analytics, experimentation, and data storytelling at scale.',                members: 2780, relatedGroups: ['g2','g3','g5','g6'] },
  { id: 'g5',  category: 'Engineering', name: 'Full-Stack Builders',         description: 'From React to Rust — builders shipping end-to-end products.',               members: 4120, relatedGroups: ['g2','g6','g7','g8','g9'] },
  { id: 'g6',  category: 'Engineering', name: 'DevOps & Cloud Engineers',    description: 'Kubernetes, CI/CD, observability, and platform engineering.',                members: 2340, relatedGroups: ['g5','g7','g8','g4'] },
  { id: 'g7',  category: 'Engineering', name: 'Web3 Developers',             description: 'Smart contracts, DeFi protocols, and decentralised infrastructure.',         members: 1560, relatedGroups: ['g5','g6','g22','g21'] },
  { id: 'g8',  category: 'Engineering', name: 'Open Source Contributors',    description: 'Maintainers and contributors sharing knowledge and collaborating.',          members: 3890, relatedGroups: ['g5','g6','g2','g25'] },
  { id: 'g9',  category: 'Startups',    name: 'Remote Startup Founders',     description: 'Founders building distributed companies and async-first cultures.',          members: 2100, relatedGroups: ['g10','g11','g23','g17','g20'] },
  { id: 'g10', category: 'Startups',    name: 'Bootstrapped Founders',       description: 'Profitable without VC — sharing playbooks for sustainable growth.',         members: 1670, relatedGroups: ['g9','g11','g17','g18'] },
  { id: 'g11', category: 'Startups',    name: 'SaaS Founders',               description: 'ARR, churn, pricing, and everything SaaS metrics.',                         members: 3040, relatedGroups: ['g9','g10','g1','g17','g21'] },
  { id: 'g12', category: 'Startups',    name: 'YC Alumni Network',           description: 'Past and present YC founders sharing deals, intros, and advice.',           members: 980,  relatedGroups: ['g9','g11','g20','g21'] },
  { id: 'g13', category: 'Design',      name: 'UX/UI Designers Network',     description: 'Research, systems, prototypes, and the craft of great product design.',     members: 2890, relatedGroups: ['g14','g15','g16','g1','g5'] },
  { id: 'g14', category: 'Design',      name: 'Product Design Leaders',      description: 'Design leadership: hiring, culture, process, and career growth.',           members: 1230, relatedGroups: ['g13','g15','g1','g11'] },
  { id: 'g15', category: 'Design',      name: 'Brand Strategists',           description: 'Identity, positioning, and the stories that make brands stick.',            members: 870,  relatedGroups: ['g13','g14','g16','g17','g18'] },
  { id: 'g16', category: 'Design',      name: 'Motion & Interaction',        description: 'Microinteractions, animation principles, and delightful UX.',               members: 640,  relatedGroups: ['g13','g14','g15'] },
  { id: 'g17', category: 'Marketing',   name: 'Growth Hackers Club',         description: 'Acquisition channels, retention loops, and growth experiments.',            members: 3560, relatedGroups: ['g18','g19','g9','g11','g15'] },
  { id: 'g18', category: 'Marketing',   name: 'Content Creators Pro',        description: 'Long-form, short-form, video — creating content that converts.',           members: 2100, relatedGroups: ['g17','g19','g15','g25'] },
  { id: 'g19', category: 'Marketing',   name: 'SEO & Analytics Experts',     description: 'Organic search, Core Web Vitals, and data-driven content strategy.',       members: 1780, relatedGroups: ['g17','g18','g4'] },
  { id: 'g20', category: 'Finance',     name: 'Angel Investors Circle',      description: 'Early-stage deal flow, due diligence, and portfolio building.',             members: 760,  relatedGroups: ['g21','g22','g9','g12'] },
  { id: 'g21', category: 'Finance',     name: 'VC-Backed Founders',          description: 'Fundraising, term sheets, board dynamics, and scaling with capital.',       members: 1340, relatedGroups: ['g20','g22','g9','g11','g12'] },
  { id: 'g22', category: 'Finance',     name: 'Crypto & DeFi',               description: 'On-chain finance, yield strategies, and the evolving DeFi stack.',         members: 2240, relatedGroups: ['g7','g20','g21'] },
  { id: 'g23', category: 'Remote Work', name: 'Freelancers Network',         description: 'Clients, contracts, rates, and life as an independent professional.',      members: 4560, relatedGroups: ['g24','g9','g10','g18'] },
  { id: 'g24', category: 'Remote Work', name: 'Digital Nomads',              description: 'Working from anywhere — visas, gear, co-working, and community.',         members: 6120, relatedGroups: ['g23','g9','g26'] },
  { id: 'g25', category: 'Education',   name: 'EdTech Innovators',           description: 'Learning experiences, instructional design, and ed-tech product.',        members: 1050, relatedGroups: ['g26','g1','g8','g18'] },
  { id: 'g26', category: 'Education',   name: 'Career Changers',             description: 'From any background into tech — stories, resources, and support.',        members: 3780, relatedGroups: ['g25','g5','g13','g24'] },
  // ── Social platform communities (internal UFI groups) ────────────────────────
  { id: 'gs1', category: 'Social', name: 'LinkedIn Professionals',       description: 'Connect with LinkedIn members across industries. Share profiles, posts, and network.',  members: 8420,  platform: 'linkedin',  platformUrl: 'https://www.linkedin.com/login', relatedGroups: ['g11','g9','g17'] },
  { id: 'gs2', category: 'Social', name: 'GitHub Open Source',           description: 'Developers sharing repos, OSS projects, and code reviews from GitHub.',               members: 5910,  platform: 'github',    platformUrl: 'https://github.com/login', relatedGroups: ['g8','g5','g6'] },
  { id: 'gs3', category: 'Social', name: 'X / Twitter Tech',             description: 'Hot takes, threads, and discussions from the tech Twitter/X community.',              members: 12300, platform: 'twitter',   platformUrl: 'https://twitter.com/i/flow/login', relatedGroups: ['g1','g3','g17'] },
  { id: 'gs4', category: 'Social', name: 'Instagram Creatives',          description: 'Designers, photographers, and creative professionals sharing their work.',            members: 6780,  platform: 'instagram', platformUrl: 'https://www.instagram.com/accounts/login/', relatedGroups: ['g13','g15','g16'] },
  { id: 'gs5', category: 'Social', name: 'Discord Communities',          description: 'Engineers, gamers, and community builders from Discord servers.',                     members: 9140,  platform: 'discord',   platformUrl: 'https://discord.com/login', relatedGroups: ['g5','g7','g8'] },
  { id: 'gs6', category: 'Social', name: 'YouTube Creators & Viewers',   description: 'Content creators and professionals sharing insights via video.',                     members: 7230,  platform: 'youtube',   platformUrl: 'https://accounts.google.com/ServiceLogin?service=youtube', relatedGroups: ['g18','g25','g19'] },
  { id: 'gs7', category: 'Social', name: 'Reddit Professional Network',  description: 'Discussions and AMAs from professional subreddits and communities.',               members: 15600, platform: 'reddit',    platformUrl: 'https://www.reddit.com/login', relatedGroups: ['g5','g11','g24'] },
  { id: 'gs8', category: 'Social', name: 'Medium Writers & Readers',     description: 'Writers, thinkers, and readers sharing long-form content on Medium.',               members: 4320,  platform: 'medium',    platformUrl: 'https://medium.com/m/signin', relatedGroups: ['g18','g25','g19'] },
  { id: 'gs9', category: 'Social', name: 'Dribbble Design Community',    description: 'Top designers sharing shots, portfolios, and feedback on Dribbble.',                members: 3810,  platform: 'dribbble',  platformUrl: 'https://dribbble.com/session/new', relatedGroups: ['g13','g14','g15'] },
  { id: 'gs10',category: 'Social', name: 'Behance Portfolio Network',    description: 'Creative professionals showcasing projects and portfolios on Behance.',              members: 2940,  platform: 'behance',   platformUrl: 'https://www.behance.net/signin', relatedGroups: ['g13','g15','g16'] },
  { id: 'gs11',category: 'Social', name: 'Indeed Job Seekers',           description: 'Job seekers and recruiters sharing opportunities and career advice.',               members: 11200, platform: 'indeed',    platformUrl: 'https://secure.indeed.com/account/login', relatedGroups: ['g26','g23','g11'] },
  { id: 'gs12',category: 'Social', name: 'Facebook Professional Groups', description: 'Industry groups, mastermind circles, and networking from Facebook.',               members: 18700, platform: 'facebook',  platformUrl: 'https://www.facebook.com/login', relatedGroups: ['g17','g9','g11'] },

  // ── Real public Reddit communities (isExternal: true) ────────────────────────
  { id: 'ext_r_ml',       category: 'AI & ML',     name: 'r/MachineLearning',        description: 'The largest ML research community on Reddit. Papers, discussions, and career advice from 3.5M+ members.',           members: 3500000, isExternal: true, subreddit: 'MachineLearning',     externalUrl: 'https://reddit.com/r/MachineLearning' },
  { id: 'ext_r_ai',       category: 'AI & ML',     name: 'r/artificial',             description: 'AI news, breakthroughs, and debates from 2M+ redditors across research, product, and policy.',                     members: 2000000, isExternal: true, subreddit: 'artificial',          externalUrl: 'https://reddit.com/r/artificial' },
  { id: 'ext_r_ds',       category: 'AI & ML',     name: 'r/datascience',            description: 'Data science career advice, tool comparisons, and project showcases from 1.2M+ members.',                         members: 1200000, isExternal: true, subreddit: 'datascience',         externalUrl: 'https://reddit.com/r/datascience' },
  { id: 'ext_r_llm',      category: 'AI & ML',     name: 'r/LocalLLaMA',             description: 'Running LLMs locally — hardware setups, model comparisons, and fine-tuning guides.',                              members: 580000,  isExternal: true, subreddit: 'LocalLLaMA',          externalUrl: 'https://reddit.com/r/LocalLLaMA' },
  { id: 'ext_r_prog',     category: 'Engineering', name: 'r/programming',            description: 'The original programming community — 6.3M+ developers sharing articles, tools, and industry discourse.',           members: 6300000, isExternal: true, subreddit: 'programming',         externalUrl: 'https://reddit.com/r/programming' },
  { id: 'ext_r_webdev',   category: 'Engineering', name: 'r/webdev',                 description: 'Web development tutorials, job advice, roast-my-site threads, and frontend/backend discussions.',                  members: 2500000, isExternal: true, subreddit: 'webdev',              externalUrl: 'https://reddit.com/r/webdev' },
  { id: 'ext_r_devops',   category: 'Engineering', name: 'r/devops',                 description: 'DevOps practices, Kubernetes, CI/CD pipelines, cloud infra, and SRE war stories.',                               members: 440000,  isExternal: true, subreddit: 'devops',              externalUrl: 'https://reddit.com/r/devops' },
  { id: 'ext_r_react',    category: 'Engineering', name: 'r/reactjs',                description: 'React.js ecosystem — hooks, state management, Next.js, performance, and job hunting.',                             members: 500000,  isExternal: true, subreddit: 'reactjs',             externalUrl: 'https://reddit.com/r/reactjs' },
  { id: 'ext_r_python',   category: 'Engineering', name: 'r/Python',                 description: 'Python scripts, libraries, career questions, and community projects from 1.6M+ Pythonistas.',                    members: 1600000, isExternal: true, subreddit: 'Python',              externalUrl: 'https://reddit.com/r/Python' },
  { id: 'ext_r_js',       category: 'Engineering', name: 'r/javascript',             description: 'JavaScript ecosystem — frameworks, tooling, browser APIs, and TypeScript migration guides.',                       members: 2200000, isExternal: true, subreddit: 'javascript',          externalUrl: 'https://reddit.com/r/javascript' },
  { id: 'ext_r_startups', category: 'Startups',    name: 'r/startups',               description: 'Founder stories, early-stage advice, product pivots, and team building from 1.4M+ entrepreneurs.',               members: 1400000, isExternal: true, subreddit: 'startups',            externalUrl: 'https://reddit.com/r/startups' },
  { id: 'ext_r_entrep',   category: 'Startups',    name: 'r/Entrepreneur',           description: '1.5M+ business owners sharing revenue milestones, hiring tips, and marketing wins.',                              members: 1500000, isExternal: true, subreddit: 'Entrepreneur',        externalUrl: 'https://reddit.com/r/Entrepreneur' },
  { id: 'ext_r_saas',     category: 'Startups',    name: 'r/SaaS',                   description: 'SaaS metrics, pricing strategy, churn reduction, and tool stack discussions.',                                    members: 290000,  isExternal: true, subreddit: 'SaaS',                externalUrl: 'https://reddit.com/r/SaaS' },
  { id: 'ext_r_pm',       category: 'Startups',    name: 'r/ProductManagement',      description: 'Product manager career growth, roadmap frameworks, stakeholder management, and interview prep.',                  members: 220000,  isExternal: true, subreddit: 'ProductManagement',   externalUrl: 'https://reddit.com/r/ProductManagement' },
  { id: 'ext_r_ux',       category: 'Design',      name: 'r/UXDesign',               description: 'UX research, portfolio critiques, design systems, and career advice from 530K+ designers.',                      members: 530000,  isExternal: true, subreddit: 'UXDesign',            externalUrl: 'https://reddit.com/r/UXDesign' },
  { id: 'ext_r_gfx',      category: 'Design',      name: 'r/graphic_design',         description: 'Logo critiques, branding showcases, typography discussion, and freelance pricing from 5.6M+ creatives.',         members: 5600000, isExternal: true, subreddit: 'graphic_design',      externalUrl: 'https://reddit.com/r/graphic_design' },
  { id: 'ext_r_mktg',     category: 'Marketing',   name: 'r/marketing',              description: 'Digital marketing strategies, campaign post-mortems, and tool recommendations.',                                  members: 500000,  isExternal: true, subreddit: 'marketing',           externalUrl: 'https://reddit.com/r/marketing' },
  { id: 'ext_r_seo',      category: 'Marketing',   name: 'r/SEO',                    description: 'Search engine optimisation — technical SEO, content strategy, algorithm updates, and link building.',             members: 280000,  isExternal: true, subreddit: 'SEO',                 externalUrl: 'https://reddit.com/r/SEO' },
  { id: 'ext_r_pf',       category: 'Finance',     name: 'r/personalfinance',        description: 'Budgeting, debt payoff, investing basics, and financial independence advice from 20M+ members.',                  members: 20000000,isExternal: true, subreddit: 'personalfinance',     externalUrl: 'https://reddit.com/r/personalfinance' },
  { id: 'ext_r_inv',      category: 'Finance',     name: 'r/investing',              description: 'Long-term investing, ETFs, stock picks, and portfolio strategy from 2.5M+ investors.',                           members: 2500000, isExternal: true, subreddit: 'investing',           externalUrl: 'https://reddit.com/r/investing' },
  { id: 'ext_r_crypto',   category: 'Finance',     name: 'r/CryptoCurrency',         description: 'Crypto news, DeFi protocols, NFT analysis, and on-chain data from 6M+ members.',                               members: 6000000, isExternal: true, subreddit: 'CryptoCurrency',      externalUrl: 'https://reddit.com/r/CryptoCurrency' },
  { id: 'ext_r_nomad',    category: 'Remote Work', name: 'r/digitalnomad',           description: 'Visa guides, best coworking spots, tax strategies, and remote work tools from 1.8M+ nomads.',                   members: 1800000, isExternal: true, subreddit: 'digitalnomad',        externalUrl: 'https://reddit.com/r/digitalnomad' },
  { id: 'ext_r_remote',   category: 'Remote Work', name: 'r/remotework',             description: 'Remote job leads, home office setups, async communication, and WFH culture.',                                    members: 450000,  isExternal: true, subreddit: 'remotework',          externalUrl: 'https://reddit.com/r/remotework' },
  { id: 'ext_r_free',     category: 'Remote Work', name: 'r/freelance',              description: 'Freelance rates, client red flags, contract templates, and growing a solo business.',                            members: 400000,  isExternal: true, subreddit: 'freelance',           externalUrl: 'https://reddit.com/r/freelance' },
  { id: 'ext_r_learn',    category: 'Education',   name: 'r/learnprogramming',       description: 'Beginner-friendly coding community — 4.3M+ people learning Python, JavaScript, and beyond.',                    members: 4300000, isExternal: true, subreddit: 'learnprogramming',    externalUrl: 'https://reddit.com/r/learnprogramming' },
  { id: 'ext_r_cscareer', category: 'Education',   name: 'r/cscareerquestions',      description: 'Salary negotiations, interview prep, resume reviews, and career switching advice for developers.',               members: 1200000, isExternal: true, subreddit: 'cscareerquestions',   externalUrl: 'https://reddit.com/r/cscareerquestions' },

  // ── Real Discord servers ──────────────────────────────────────────────────────
  { id: 'ext_d_reactiflux', category: 'Engineering', name: 'Reactiflux Discord',    description: 'The largest React.js Discord server — 80K+ developers discussing React, Redux, GraphQL, and TypeScript.',         members: 80000,   isExternal: true, platform: 'discord', externalUrl: 'https://discord.gg/reactiflux' },
  { id: 'ext_d_pydisc',    category: 'Engineering', name: 'Python Discord',          description: 'Official Python community Discord — 300K+ members, code reviews, project showcases, and mentorship.',            members: 300000,  isExternal: true, platform: 'discord', externalUrl: 'https://discord.gg/python' },
  { id: 'ext_d_design',    category: 'Design',      name: 'Design Buddies Discord', description: '100K+ UX/UI designers sharing portfolio feedback, job leads, and career advice.',                                  members: 100000,  isExternal: true, platform: 'discord', externalUrl: 'https://discord.gg/designbuddies' },
  { id: 'ext_d_tph',       category: 'Engineering', name: "The Programmer's Hangout",'description': 'Welcoming community for programmers at all levels — 80K+ members, code challenges, and project collabs.',       members: 80000,   isExternal: true, platform: 'discord', externalUrl: 'https://discord.gg/programming' },

  // ── LinkedIn Groups ───────────────────────────────────────────────────────────
  { id: 'ext_li_pm',       category: 'Startups',    name: 'Product Management Professionals', description: 'LinkedIn\'s largest PM group — product strategy, roadmapping, and career growth for product managers.', members: 500000,  isExternal: true, platform: 'linkedin', externalUrl: 'https://linkedin.com/groups/42115' },
  { id: 'ext_li_gh',       category: 'Marketing',   name: 'Growth Hackers (LinkedIn)',         description: 'Growth marketing tactics, A/B test results, and acquisition case studies shared by 300K+ marketers.',  members: 300000,  isExternal: true, platform: 'linkedin', externalUrl: 'https://linkedin.com/groups/1868995' },

  // ── Hacker News ──────────────────────────────────────────────────────────────
  { id: 'ext_hn',          category: 'Engineering', name: 'Hacker News',            description: 'Y Combinator\'s community for startup and technology discussion — the internet\'s sharpest tech commentary.',       members: 5000000, isExternal: true, platform: 'hackernews', externalUrl: 'https://news.ycombinator.com' },
  { id: 'ext_devto',       category: 'Engineering', name: 'DEV Community',          description: 'dev.to — 1M+ developers writing tutorials, sharing learnings, and building in public.',                           members: 1000000, isExternal: true, platform: 'devto',      externalUrl: 'https://dev.to' },
];

// Live in-memory groups list — populated from DB at startup, falls back to seed
let groups = [...ALL_GROUPS_SEED];

// Real posts — user-created, stored in community_posts table and kept in memory
let posts = [];

// Real connections — user-created
let connections = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getConnectionStatus(fromId, toId) {
  const c = connections.find(
    (x) => (x.fromId === fromId && x.toId === toId) || (x.fromId === toId && x.toId === fromId)
  );
  if (!c) return 'none';
  if (c.status === 'accepted') return 'connected';
  if (c.fromId === fromId) return 'pending_sent';
  return 'pending_received';
}

function sanitizeUser(u) {
  return { id: u.id, name: u.name, title: u.title, organization: u.organization || '', skills: u.skills || [] };
}

function fullProfile(user) {
  return {
    id: user.id, name: user.name, email: user.email, title: user.title,
    bio: user.bio, skills: user.skills, organization: user.organization,
    joinedGroups: user.joinedGroups, onboardingComplete: user.onboardingComplete,
    preferences: user.preferences,
    links: user.links || {},
    roleSettings: user.roleSettings || {},
    connectedPlatforms: Object.keys(user.socialAccounts || {}),
  };
}

// ── DB ↔ memory helpers ───────────────────────────────────────────────────────
function isDBId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(id));
}

function dbRowToMemUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    title: row.title || '',
    bio: row.bio || '',
    skills: row.skills || [],
    organization: row.organization || '',
    joinedGroups: row.joined_groups || [],
    onboardingComplete: row.onboarding_complete || false,
    preferences: row.role ? { role: row.role, goals: row.goals || [], interests: row.interests || [], experience: row.experience } : null,
    links: row.links || {},
    roleSettings: row.role_settings || {},
    socialAccounts: {},
  };
}

function syncToMemory(memUser) {
  const idx = users.findIndex(u => u.id === memUser.id);
  if (idx >= 0) users[idx] = memUser; else users.push(memUser);
  return memUser;
}

async function fetchAndSyncUser(id) {
  if (!db.isConnected()) return null;
  try {
    const [uRes, saRes] = await Promise.all([
      db.query('SELECT * FROM users WHERE id = $1', [id]),
      db.query('SELECT platform, platform_user_id, connected_at FROM social_accounts WHERE user_id = $1', [id]),
    ]);
    if (!uRes.rows[0]) return null;
    const mem = dbRowToMemUser(uRes.rows[0]);
    saRes.rows.forEach(sa => {
      mem.socialAccounts[sa.platform] = { connected: true, username: sa.platform_user_id, connectedAt: sa.connected_at };
    });
    return syncToMemory(mem);
  } catch (err) { console.error('fetchAndSyncUser:', err.message); return null; }
}

async function fetchAndSyncUserByEmail(email) {
  if (!db.isConnected()) return null;
  try {
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!rows[0]) return null;
    const mem = dbRowToMemUser(rows[0]);
    return syncToMemory(mem);
  } catch (err) { console.error('fetchAndSyncUserByEmail:', err.message); return null; }
}

// Get user from memory (syncing from DB if needed)
async function getUser(id) {
  const mem = users.find(u => u.id === id);
  if (mem) return mem;
  return fetchAndSyncUser(id);
}

async function migrateDB() {
  if (!db.isConnected()) return;
  try {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS links JSONB DEFAULT '{}'`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS joined_groups TEXT[] DEFAULT '{}'`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role_settings JSONB DEFAULT '{}'`);

    // Groups table — persists across deploys
    await db.query(`
      CREATE TABLE IF NOT EXISTS community_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT DEFAULT '',
        member_count INTEGER DEFAULT 0,
        platform TEXT,
        platform_url TEXT,
        external_url TEXT,
        subreddit TEXT,
        is_external BOOLEAN DEFAULT false,
        related_groups TEXT[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Posts table — persists across deploys
    await db.query(`
      CREATE TABLE IF NOT EXISTS community_posts (
        id TEXT PRIMARY KEY,
        group_id TEXT,
        author_id TEXT,
        author_name TEXT,
        author_title TEXT,
        content TEXT NOT NULL,
        url TEXT,
        source TEXT DEFAULT 'uficonnect',
        source_label TEXT,
        likes TEXT[] DEFAULT '{}',
        comments_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log('✅ DB migration applied');
  } catch (err) { console.warn('DB migration:', err.message); }
}

// ─── Seed groups into DB and load back into memory ────────────────────────────
async function seedAndLoadGroups() {
  if (!db.isConnected()) return;
  try {
    for (const g of ALL_GROUPS_SEED) {
      await db.query(`
        INSERT INTO community_groups
          (id,name,category,description,member_count,platform,platform_url,external_url,subreddit,is_external,related_groups)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (id) DO UPDATE SET
          name=EXCLUDED.name,
          description=EXCLUDED.description,
          member_count=GREATEST(community_groups.member_count, EXCLUDED.member_count),
          platform=EXCLUDED.platform,
          platform_url=EXCLUDED.platform_url,
          external_url=EXCLUDED.external_url,
          subreddit=EXCLUDED.subreddit,
          is_external=EXCLUDED.is_external
      `, [
        g.id, g.name, g.category, g.description || '',
        g.members || g.member_count || 0,
        g.platform || null, g.platformUrl || null,
        g.externalUrl || null, g.subreddit || null,
        g.isExternal || false,
        g.relatedGroups || [],
      ]);
    }
    const { rows } = await db.query('SELECT * FROM community_groups ORDER BY member_count DESC');
    groups.length = 0;
    rows.forEach((r) => groups.push({
      id: r.id, name: r.name, category: r.category,
      description: r.description, members: r.member_count,
      platform: r.platform, platformUrl: r.platform_url,
      externalUrl: r.external_url, subreddit: r.subreddit,
      isExternal: r.is_external, relatedGroups: r.related_groups || [],
    }));
    console.log(`✅ Loaded ${groups.length} groups from DB`);
  } catch (err) { console.warn('seedAndLoadGroups:', err.message); }
}

function recommendGroups(userId, triggerGroupId, count = 3) {
  const user = users.find((u) => u.id === userId);
  if (!user) return [];
  const triggerGroup = groups.find((g) => g.id === triggerGroupId);
  const joined = new Set(user.joinedGroups || []);
  const prefs = user.preferences || {};
  const interestedCats = new Set(prefs.interests || []);
  const roleCats = ROLE_CATEGORIES[prefs.role] || [];
  const scores = {};
  groups.forEach((group) => {
    if (joined.has(group.id) || group.id === triggerGroupId) return;
    let score = 0;
    if (triggerGroup && group.category === triggerGroup.category) score += 3;
    if (triggerGroup?.relatedGroups?.includes(group.id)) score += 4;
    if (interestedCats.has(group.category)) score += 2;
    if (roleCats.includes(group.category)) score += 1;
    score += Math.log10(group.members) * 0.3;
    scores[group.id] = score;
  });
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, count).map(([id]) => groups.find((g) => g.id === id));
}

function pickOnboardingGroups(prefs, count = 5) {
  const { role = '', interests = [], goals = [] } = prefs;
  const roleCats = new Set(ROLE_CATEGORIES[role] || []);
  const interestSet = new Set(interests);
  const scores = {};
  groups.forEach((group) => {
    let score = 0;
    if (interestSet.has(group.category)) score += 4;
    if (roleCats.has(group.category)) score += 3;
    if (goals.includes('Get funding / find investors') && group.category === 'Finance') score += 2;
    if (goals.includes('Find collaborators or co-founders') && group.category === 'Startups') score += 2;
    if (goals.includes('Learn from experts') && group.category === 'Education') score += 2;
    if (goals.includes('Find jobs or freelance work') && group.category === 'Remote Work') score += 2;
    score += Math.log10(group.members) * 0.2;
    scores[group.id] = score;
  });
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, count).map(([id]) => id);
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Authorization header missing.' });
  const token = authHeader.split(' ')[1];
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ message: 'Invalid or expired token.' }); }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
app.post('/auth/register', async (req, res) => {
  const { name, email, password, title } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'Missing fields.' });
  const emailLc = email.toLowerCase();

  if (db.isConnected()) {
    try {
      const exists = await db.query('SELECT id FROM users WHERE email=$1', [emailLc]);
      if (exists.rows.length) return res.status(409).json({ message: 'Email already registered.' });
      const hash = bcrypt.hashSync(password, 10);
      const { rows } = await db.query(
        `INSERT INTO users (name, email, password_hash, title) VALUES ($1,$2,$3,$4) RETURNING *`,
        [name, emailLc, hash, title || null]
      );
      const mem = syncToMemory(dbRowToMemUser(rows[0]));
      const token = jwt.sign({ id: mem.id, email: mem.email }, JWT_SECRET, { expiresIn: '7d' });
      return res.status(201).json({ token, profile: fullProfile(mem) });
    } catch (err) { console.error('register DB error:', err.message); }
  }

  // In-memory fallback
  if (users.find((u) => u.email === emailLc)) return res.status(409).json({ message: 'Email already registered.' });
  const newUser = { id: `u${Date.now()}`, name, email: emailLc, passwordHash: bcrypt.hashSync(password, 10), title: title || '', bio: '', skills: [], organization: '', joinedGroups: [], onboardingComplete: false, preferences: null, socialAccounts: {}, links: {} };
  users.push(newUser);
  const token = jwt.sign({ id: newUser.id, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, profile: fullProfile(newUser) });
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const emailLc = (email || '').toLowerCase();

  // Check DB first (persisted users)
  if (db.isConnected()) {
    const dbUser = await fetchAndSyncUserByEmail(emailLc);
    if (dbUser && bcrypt.compareSync(password, dbUser.passwordHash)) {
      const token = jwt.sign({ id: dbUser.id, email: dbUser.email }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, profile: fullProfile(dbUser) });
    }
  }

  // Fall back to in-memory cache (users synced from DB at login)
  const user = users.find((u) => u.email === emailLc || u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) return res.status(401).json({ message: 'Invalid email or password.' });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, profile: fullProfile(user) });
});

// ─── Profile ──────────────────────────────────────────────────────────────────
app.get('/profile', authenticate, async (req, res) => {
  // Always try to refresh from DB so data survives restarts
  const user = await getUser(req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  res.json(fullProfile(user));
});

app.patch('/profile', authenticate, async (req, res) => {
  const user = await getUser(req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  const { name, title, bio, skills, organization, links, roleSettings } = req.body;
  if (name) user.name = name;
  if (title !== undefined) user.title = title;
  if (bio !== undefined) user.bio = bio;
  if (skills) user.skills = skills;
  if (organization !== undefined) user.organization = organization;
  if (links !== undefined) user.links = links;
  if (roleSettings !== undefined) user.roleSettings = roleSettings;
  if (db.isConnected() && isDBId(user.id)) {
    db.query(
      `UPDATE users SET name=$1,title=$2,bio=$3,skills=$4,organization=$5,links=$6,role_settings=$7 WHERE id=$8`,
      [user.name, user.title, user.bio, user.skills, user.organization,
       JSON.stringify(user.links || {}), JSON.stringify(user.roleSettings || {}), user.id]
    ).catch(e => console.error('PATCH profile DB:', e.message));
  }
  res.json(fullProfile(user));
});

app.post('/profile/onboarding', authenticate, async (req, res) => {
  const user = await getUser(req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  const prefs = req.body.preferences || {
    role: req.body.role, goals: req.body.goals,
    interests: req.body.interests, experience: req.body.experience,
  };
  user.preferences = prefs;
  user.onboardingComplete = true;
  const suggested = pickOnboardingGroups(prefs);
  suggested.forEach((gid) => {
    if (!user.joinedGroups.includes(gid)) {
      user.joinedGroups.push(gid);
      const g = groups.find((gr) => gr.id === gid);
      if (g) g.members += 1;
    }
  });
  if (db.isConnected() && isDBId(user.id)) {
    db.query(
      `UPDATE users SET role=$1,goals=$2,interests=$3,experience=$4,onboarding_complete=true,joined_groups=$5 WHERE id=$6`,
      [prefs.role, prefs.goals || [], prefs.interests || [], prefs.experience, user.joinedGroups, user.id]
    ).catch(e => console.error('onboarding DB:', e.message));
  }
  res.json({ profile: fullProfile(user), autoJoined: suggested });
});

// ─── Groups ───────────────────────────────────────────────────────────────────
app.get('/groups', (req, res) => {
  const { category } = req.query;
  const result = category ? groups.filter((g) => g.category === category) : groups;
  res.json({ groups: result });
});

app.get('/groups/categories', (req, res) => {
  res.json({ categories: [...new Set(groups.map((g) => g.category))] });
});

app.get('/groups/recommend', authenticate, (req, res) => {
  const { triggerGroupId, count = 3 } = req.query;
  if (!triggerGroupId) return res.status(400).json({ message: 'triggerGroupId required.' });
  res.json({ recommended: recommendGroups(req.user.id, triggerGroupId, Number(count)) });
});

// Group members — registered users + sample users who have joined it
app.get('/groups/:id/members', authenticate, (req, res) => {
  const groupId = req.params.id;
  const group = groups.find((g) => g.id === groupId);
  if (!group) return res.status(404).json({ message: 'Group not found.' });

  const requesterId = req.user.id;
  const allMembers = users.filter((u) => u.joinedGroups.includes(groupId) && u.id !== requesterId);

  const membersWithStatus = allMembers.map((u) => ({
    ...sanitizeUser(u),
    connectionStatus: getConnectionStatus(requesterId, u.id),
  }));

  res.json({ members: membersWithStatus, total: group.members });
});

app.post('/groups/:id/join', authenticate, async (req, res) => {
  const user = await getUser(req.user.id);
  const group = groups.find((g) => g.id === req.params.id);
  if (!user || !group) return res.status(404).json({ message: 'Not found.' });
  if (!user.joinedGroups.includes(group.id)) {
    user.joinedGroups.push(group.id);
    group.members += 1;
    if (db.isConnected() && isDBId(user.id)) {
      db.query('UPDATE users SET joined_groups=$1 WHERE id=$2', [user.joinedGroups, user.id])
        .catch(e => console.error('group join DB:', e.message));
    }
  }
  res.json({ joinedGroups: user.joinedGroups, recommended: recommendGroups(user.id, group.id, 3) });
});

app.delete('/groups/:id/join', authenticate, async (req, res) => {
  const user = await getUser(req.user.id);
  const group = groups.find((g) => g.id === req.params.id);
  if (!user || !group) return res.status(404).json({ message: 'Not found.' });
  const idx = user.joinedGroups.indexOf(group.id);
  if (idx > -1) {
    user.joinedGroups.splice(idx, 1);
    group.members = Math.max(0, group.members - 1);
    if (db.isConnected() && isDBId(user.id)) {
      db.query('UPDATE users SET joined_groups=$1 WHERE id=$2', [user.joinedGroups, user.id])
        .catch(e => console.error('group leave DB:', e.message));
    }
  }
  res.json({ joinedGroups: user.joinedGroups });
});

// ─── Feed (internal + live Reddit posts, personalized by interests & role) ────
app.get('/feed', authenticate, async (req, res) => {
  const user   = await getUser(req.user.id);
  const joined = new Set(user?.joinedGroups || []);
  const prefs  = user?.preferences || {};

  // Categories relevant to this user
  const relevantCategories = new Set([
    ...(prefs.interests || []).map(i => INTEREST_TO_CATEGORY[i]).filter(Boolean),
    ...(ROLE_CATEGORIES[prefs.role] || []),
  ]);

  function scorePost(groupId, cat) {
    if (joined.has(groupId))               return 3;
    if (cat && relevantCategories.has(cat)) return 2;
    return 1;
  }

  // Internal posts
  const internal = posts.map((p) => {
    const author = users.find((u) => u.id === p.authorId);
    const group  = groups.find((g) => g.id === p.groupId);
    const cat    = group?.category;
    const relevance = scorePost(p.groupId, cat);
    return {
      ...p,
      author:          author ? sanitizeUser(author) : { id: p.authorId, name: 'Unknown', title: '', organization: '' },
      group:           group  ? { id: group.id, name: group.name, category: cat } : null,
      likedByMe:       (p.likes || []).includes(req.user.id),
      likesCount:      (p.likes || []).length,
      fromJoinedGroup: joined.has(p.groupId),
      forYou:          relevance >= 2,
      relevance,
      source:          'uficonnect',
      sourceLabel:     'UFIConnect',
      sourceUrl:       null,
      isExternal:      false,
    };
  });

  // Live Reddit posts — fetched async, cached 30 min
  let redditPosts = [];
  try {
    const raw = await getPersonalizedRedditPosts(prefs.interests || [], prefs.role || '');
    redditPosts = raw.map((p) => {
      const group = groups.find((g) => g.id === p.groupId);
      const cat   = group?.category || p.group?.category;
      const relevance = scorePost(p.groupId, cat);
      return {
        ...p,
        group:           group ? { id: group.id, name: group.name, category: cat } : p.group,
        likedByMe:       false,
        fromJoinedGroup: joined.has(p.groupId),
        forYou:          relevance >= 2,
        relevance,
      };
    });
  } catch (e) {
    console.warn('Reddit feed error:', e.message);
  }

  const all = [...internal, ...redditPosts];
  all.sort((a, b) =>
    b.relevance !== a.relevance
      ? b.relevance - a.relevance
      : new Date(b.createdAt) - new Date(a.createdAt)
  );

  res.json({ posts: all });
});

// Create a post in a group
app.post('/groups/:id/posts', authenticate, async (req, res) => {
  const user  = await getUser(req.user.id);
  const group = groups.find((g) => g.id === req.params.id);
  if (!user || !group) return res.status(404).json({ message: 'Not found.' });
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ message: 'Content is required.' });

  const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const post = {
    id, authorId: user.id, groupId: group.id,
    content: content.trim(), likes: [], commentsCount: 0,
    createdAt: new Date().toISOString(),
    source: 'uficonnect', sourceLabel: 'UFIConnect',
  };
  posts.unshift(post);

  if (db.isConnected()) {
    db.query(
      `INSERT INTO community_posts (id,group_id,author_id,author_name,content,source,source_label,created_at)
       VALUES ($1,$2,$3,$4,$5,'uficonnect','UFIConnect',$6) ON CONFLICT DO NOTHING`,
      [id, group.id, user.id, user.name, content.trim(), post.createdAt]
    ).catch(e => console.error('create post DB:', e.message));
  }
  res.status(201).json({ post });
});

app.post('/feed/:postId/like', authenticate, (req, res) => {
  const post = posts.find((p) => p.id === req.params.postId);
  if (!post) return res.status(404).json({ message: 'Post not found.' });
  const idx = post.likes.indexOf(req.user.id);
  if (idx > -1) { post.likes.splice(idx, 1); }
  else { post.likes.push(req.user.id); }
  res.json({ likedByMe: post.likes.includes(req.user.id), likesCount: post.likes.length });
});

// ─── Connections ──────────────────────────────────────────────────────────────
app.post('/users/:id/connect', authenticate, (req, res) => {
  const fromId = req.user.id;
  const toId = req.params.id;
  if (fromId === toId) return res.status(400).json({ message: 'Cannot connect with yourself.' });

  const existing = connections.find(
    (c) => (c.fromId === fromId && c.toId === toId) || (c.fromId === toId && c.toId === fromId)
  );

  if (!existing) {
    connections.push({ id: `conn${Date.now()}`, fromId, toId, status: 'pending', createdAt: new Date().toISOString() });
    return res.json({ connectionStatus: 'pending_sent' });
  }

  if (existing.status === 'pending' && existing.toId === fromId) {
    existing.status = 'accepted';
    return res.json({ connectionStatus: 'connected' });
  }

  res.json({ connectionStatus: getConnectionStatus(fromId, toId) });
});

app.get('/users/connections', authenticate, (req, res) => {
  const uid = req.user.id;
  const myConnections = connections
    .filter((c) => (c.fromId === uid || c.toId === uid) && c.status === 'accepted')
    .map((c) => {
      const otherId = c.fromId === uid ? c.toId : c.fromId;
      const other = users.find((u) => u.id === otherId);
      return other ? sanitizeUser(other) : null;
    })
    .filter(Boolean);
  res.json({ connections: myConnections });
});

// ─── Social accounts ─────────────────────────────────────────────────────────

// List platform configs + user's connection status
app.get('/social/platforms', authenticate, async (req, res) => {
  const user = await getUser(req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  const result = Object.entries(PLATFORMS).map(([key, cfg]) => {
    const connected = user.socialAccounts?.[key];
    return {
      id: key,
      name: cfg.name,
      color: cfg.color,
      icon: cfg.icon,
      description: cfg.description,
      scopes: cfg.scopes,
      authUrl: cfg.authUrl,
      setupUrl: cfg.setupUrl,
      reviewRequired: cfg.reviewRequired,
      note: cfg.note,
      connected: !!connected,
      username: connected?.username || null,
      connectedAt: connected?.connectedAt || null,
    };
  });
  res.json({ platforms: result });
});

// Connect a platform (mock OAuth exchange — swap for real token exchange in production)
app.post('/social/connect', authenticate, async (req, res) => {
  const user = await getUser(req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  const { platform, mockUsername } = req.body;
  if (!PLATFORMS[platform]) return res.status(400).json({ message: 'Unknown platform.' });
  if (!user.socialAccounts) user.socialAccounts = {};
  const username = mockUsername || `user_${Math.random().toString(36).slice(2, 8)}`;
  user.socialAccounts[platform] = { connected: true, username, accessToken: `mock_token_${Date.now()}`, connectedAt: new Date().toISOString() };
  if (db.isConnected() && isDBId(user.id)) {
    db.query(
      `INSERT INTO social_accounts (user_id,platform,platform_user_id,access_token) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id,platform) DO UPDATE SET platform_user_id=$3,access_token=$4,connected_at=NOW()`,
      [user.id, platform, username, user.socialAccounts[platform].accessToken]
    ).catch(e => console.error('social connect DB:', e.message));
  }
  res.json({ platform, connected: true, username });
});

// Disconnect a platform
app.delete('/social/connect/:platform', authenticate, async (req, res) => {
  const user = await getUser(req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  if (user.socialAccounts) delete user.socialAccounts[req.params.platform];
  if (db.isConnected() && isDBId(user.id)) {
    db.query('DELETE FROM social_accounts WHERE user_id=$1 AND platform=$2', [user.id, req.params.platform])
      .catch(e => console.error('social disconnect DB:', e.message));
  }
  res.json({ platform: req.params.platform, connected: false });
});

// Aggregated social feed from all connected platforms
app.get('/social/feed', authenticate, async (req, res) => {
  const user = await getUser(req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  const connected = Object.keys(user.socialAccounts || {});
  const posts = connected.flatMap((platform) => SOCIAL_POSTS[platform] || []);
  posts.sort((a, b) => new Date(b.time) - new Date(a.time));
  res.json({ posts, connectedPlatforms: connected });
});

// Indeed job listings (filtered by user profile)
app.get('/social/jobs', authenticate, async (req, res) => {
  const user = await getUser(req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  const skills = new Set((user.skills || []).map((s) => s.toLowerCase()));
  const scored = INDEED_JOBS.map((job) => {
    const matches = job.tags.filter((t) => skills.has(t.toLowerCase())).length;
    return { ...job, relevanceScore: matches };
  }).sort((a, b) => b.relevanceScore - a.relevanceScore);
  res.json({ jobs: scored, indeedConnected: !!(user.socialAccounts?.indeed) });
});

// ─── Opportunities data ───────────────────────────────────────────────────────
const OPPORTUNITIES = [
  // Jobs
  { id: 'op1',  type: 'job',       title: 'Senior ML Engineer',           org: 'Anthropic',            location: 'San Francisco / Remote', pay: '$220k–$280k',       tags: ['PyTorch','LLMs','Python'],       source: 'Indeed',       sourceUrl: 'https://indeed.com', posted: ago(1*D),  remote: true },
  { id: 'op2',  type: 'job',       title: 'Product Manager, AI Platform', org: 'Scale AI',             location: 'Remote',                 pay: '$160k–$210k',       tags: ['AI','Roadmapping','B2B'],        source: 'LinkedIn',     sourceUrl: 'https://linkedin.com', posted: ago(2*D), remote: true },
  { id: 'op3',  type: 'job',       title: 'Staff Software Engineer',      org: 'Vercel',               location: 'Remote',                 pay: '$200k–$260k',       tags: ['React','Node','Infrastructure'], source: 'AngelList',    sourceUrl: 'https://angel.co', posted: ago(5*H), remote: true },
  { id: 'op4',  type: 'job',       title: 'Founding Engineer',            org: 'Stealth AI Startup',   location: 'Remote',                 pay: '$180k + equity',    tags: ['TypeScript','LLMs','Startup'],   source: 'YC Jobs',      sourceUrl: 'https://ycombinator.com/jobs', posted: ago(2*H), remote: true },
  { id: 'op5',  type: 'job',       title: 'Senior UX Designer',           org: 'Linear',               location: 'Remote',                 pay: '$140k–$180k',       tags: ['Figma','Systems','Prototyping'], source: 'Remote.co',    sourceUrl: 'https://remote.co', posted: ago(3*H), remote: true },
  { id: 'op6',  type: 'job',       title: 'Growth Lead',                  org: 'Notion',               location: 'San Francisco, CA',      pay: '$150k–$190k',       tags: ['Growth','Analytics','B2B'],     source: 'Indeed',       sourceUrl: 'https://indeed.com', posted: ago(8*H), remote: false },
  { id: 'op7',  type: 'job',       title: 'Data Scientist',               org: 'Figma',                location: 'San Francisco, CA',      pay: '$160k–$200k',       tags: ['Python','SQL','Experimentation'],source: 'LinkedIn',     sourceUrl: 'https://linkedin.com', posted: ago(4*H), remote: false },
  { id: 'op8',  type: 'job',       title: 'DevRel Engineer',              org: 'Supabase',             location: 'Remote',                 pay: '$130k–$170k',       tags: ['Postgres','OSS','Content'],     source: 'Remote.co',    sourceUrl: 'https://remote.co', posted: ago(1*D), remote: true },

  // Gigs
  { id: 'op9',  type: 'gig',       title: 'LLM Fine-tuning Specialist',   org: 'Fintech Startup',      location: 'Remote',                 pay: '$120–$180/hr',      tags: ['LLMs','Python','Fine-tuning'],   source: 'Toptal',       sourceUrl: 'https://toptal.com', posted: ago(6*H), remote: true },
  { id: 'op10', type: 'gig',       title: 'Product Design System Audit',  org: 'E-commerce Brand',     location: 'Remote',                 pay: '$8k project',       tags: ['Figma','Design Systems','UX'],   source: 'Contra',       sourceUrl: 'https://contra.com', posted: ago(10*H), remote: true },
  { id: 'op11', type: 'gig',       title: 'React Native Developer',       org: 'Healthcare App',       location: 'Remote',                 pay: '$90–$130/hr',       tags: ['React Native','TypeScript'],     source: 'Upwork',       sourceUrl: 'https://upwork.com', posted: ago(3*H), remote: true },
  { id: 'op12', type: 'gig',       title: 'Content Strategy Consultant',  org: 'Series B SaaS',        location: 'Remote',                 pay: '$5k–$10k/month',    tags: ['Content','SEO','Strategy'],     source: 'Gun.io',       sourceUrl: 'https://gun.io', posted: ago(1*D), remote: true },
  { id: 'op13', type: 'gig',       title: 'Growth Advisor (equity)',      org: 'Pre-seed Startup',     location: 'Remote',                 pay: '0.25–0.5% equity',  tags: ['Growth','GTM','B2B'],           source: 'Contra',       sourceUrl: 'https://contra.com', posted: ago(2*D), remote: true },

  // Grants
  { id: 'op14', type: 'grant',     title: 'Mozilla Tech Fund',            org: 'Mozilla Foundation',   location: 'Global',                 pay: 'Up to $150k',       tags: ['Open Source','Privacy','Web'],   source: 'mozilla.org',  sourceUrl: 'https://foundation.mozilla.org', posted: ago(5*D), remote: true },
  { id: 'op15', type: 'grant',     title: 'Google.org AI for Good',       org: 'Google',               location: 'Global',                 pay: '$100k–$1M',         tags: ['AI','Social Impact','Research'], source: 'google.org',   sourceUrl: 'https://google.org', posted: ago(3*D), remote: true },
  { id: 'op16', type: 'grant',     title: 'Open Source Sustainability',   org: 'GitHub Sponsors',      location: 'Global',                 pay: '$500–$5k/month',    tags: ['Open Source','OSS'],            source: 'GitHub',       sourceUrl: 'https://github.com/sponsors', posted: ago(7*D), remote: true },
  { id: 'op17', type: 'grant',     title: 'Founders Fellowship',          org: 'On Deck',              location: 'Remote',                 pay: '$25k + network',    tags: ['Startups','Founders','Pre-seed'],source: 'On Deck',      sourceUrl: 'https://beondeck.com', posted: ago(4*D), remote: true },
  { id: 'op18', type: 'grant',     title: 'AI Safety Research Grant',     org: 'Open Philanthropy',    location: 'Global',                 pay: '$50k–$500k',        tags: ['AI Safety','Research','LLMs'],  source: 'openphilanthropy.org', sourceUrl: 'https://openphilanthropy.org', posted: ago(6*D), remote: true },

  // Events
  { id: 'op19', type: 'event',     title: 'AI Engineer World Fair',       org: 'Swyx / Latent.Space', location: 'San Francisco, CA',      pay: 'Free – $299',       tags: ['AI','Engineering','Networking'], source: 'Luma',         sourceUrl: 'https://lu.ma', posted: ago(2*D), remote: false },
  { id: 'op20', type: 'event',     title: 'Remote Work Summit 2025',      org: 'GitLab / Remote.com',  location: 'Virtual',                pay: 'Free',              tags: ['Remote Work','Culture','Async'], source: 'Eventbrite',   sourceUrl: 'https://eventbrite.com', posted: ago(3*D), remote: true },
  { id: 'op21', type: 'event',     title: 'Product Design Meetup NYC',    org: 'Figma Community',      location: 'New York, NY',           pay: 'Free',              tags: ['Design','UX','Networking'],     source: 'Meetup',       sourceUrl: 'https://meetup.com', posted: ago(1*D), remote: false },
  { id: 'op22', type: 'event',     title: 'SaaS Open 2025',               org: 'OpenView Partners',    location: 'Boston / Virtual',       pay: 'Free',              tags: ['SaaS','Growth','B2B'],          source: 'Luma',         sourceUrl: 'https://lu.ma', posted: ago(4*D), remote: true },

  // Hackathons
  { id: 'op23', type: 'hackathon', title: 'LLM App Hackathon',            org: 'Devpost / LangChain',  location: 'Virtual',                pay: '$50k in prizes',    tags: ['LLMs','Python','AI'],           source: 'Devpost',      sourceUrl: 'https://devpost.com', posted: ago(2*D), remote: true },
  { id: 'op24', type: 'hackathon', title: 'Climate Tech Challenge',        org: 'MCJ Collective',       location: 'Virtual',                pay: '$25k + mentorship', tags: ['Climate','Tech','Impact'],      source: 'Devpost',      sourceUrl: 'https://devpost.com', posted: ago(5*D), remote: true },
  { id: 'op25', type: 'hackathon', title: 'MLH Open Source Hackathon',    org: 'Major League Hacking', location: 'Virtual',                pay: 'Prizes + swag',     tags: ['Open Source','Any Stack'],      source: 'MLH',          sourceUrl: 'https://mlh.io', posted: ago(1*D), remote: true },
  { id: 'op26', type: 'hackathon', title: 'Kaggle LLM Competition',       org: 'Kaggle / Google',      location: 'Virtual',                pay: '$150k total prizes',tags: ['LLMs','ML','Python'],           source: 'Kaggle',       sourceUrl: 'https://kaggle.com', posted: ago(3*D), remote: true },

  // Open Source
  { id: 'op27', type: 'opensource',title: 'Good First Issues — Vercel AI',org: 'Vercel',               location: 'Remote',                 pay: 'Volunteer / bounty',tags: ['TypeScript','AI','OSS'],        source: 'GitHub',       sourceUrl: 'https://github.com/vercel/ai', posted: ago(1*D), remote: true },
  { id: 'op28', type: 'opensource',title: 'LangChain.js Contributors',    org: 'LangChain',            location: 'Remote',                 pay: 'OSS Bounties',      tags: ['TypeScript','LLMs','OSS'],      source: 'GitHub',       sourceUrl: 'https://github.com/langchain-ai/langchainjs', posted: ago(2*D), remote: true },
  { id: 'op29', type: 'opensource',title: 'Expo Framework Contributor',   org: 'Expo / Software Mansion',location: 'Remote',               pay: 'Volunteer + swag',  tags: ['React Native','TypeScript'],     source: 'GitHub',       sourceUrl: 'https://github.com/expo/expo', posted: ago(3*D), remote: true },

  // Learning
  { id: 'op30', type: 'learning',  title: 'Practical Deep Learning',      org: 'fast.ai',              location: 'Online',                 pay: 'Free',              tags: ['Python','Deep Learning','AI'],   source: 'fast.ai',      sourceUrl: 'https://fast.ai', posted: ago(10*D), remote: true },
  { id: 'op31', type: 'learning',  title: 'Startup School',               org: 'Y Combinator',         location: 'Online',                 pay: 'Free',              tags: ['Startups','Founders','GTM'],    source: 'YC',           sourceUrl: 'https://startupschool.org', posted: ago(7*D), remote: true },
  { id: 'op32', type: 'learning',  title: 'Full-Stack Open 2025',         org: 'University of Helsinki',location: 'Online',                pay: 'Free + certificate',tags: ['React','Node','TypeScript'],     source: 'fullstackopen.com', sourceUrl: 'https://fullstackopen.com', posted: ago(14*D), remote: true },
  { id: 'op33', type: 'learning',  title: 'Design for Developers',        org: 'Scrimba',              location: 'Online',                 pay: '$29/month',         tags: ['CSS','Design','Figma'],         source: 'Scrimba',      sourceUrl: 'https://scrimba.com', posted: ago(5*D), remote: true },

  // LinkedIn Jobs
  { id: 'op34', type: 'job', title: 'Senior Software Engineer',          org: 'Stripe',               location: 'San Francisco, CA',      pay: '$180k–$240k',       tags: ['Python','Go','Distributed Systems'], source: 'LinkedIn', sourceUrl: 'https://linkedin.com/jobs', posted: ago(1*D), remote: false },
  { id: 'op35', type: 'job', title: 'Product Manager, AI',               org: 'OpenAI',               location: 'San Francisco, CA',      pay: '$200k–$280k',       tags: ['AI','Product','LLMs'],          source: 'LinkedIn', sourceUrl: 'https://linkedin.com/jobs', posted: ago(2*D), remote: false },
  { id: 'op36', type: 'job', title: 'UX Designer — Design Systems',      org: 'Figma',                location: 'Remote',                 pay: '$140k–$180k',       tags: ['Design','Figma','UX'],          source: 'LinkedIn', sourceUrl: 'https://linkedin.com/jobs', posted: ago(1*D), remote: true },
  { id: 'op37', type: 'job', title: 'Growth Engineer',                   org: 'Linear',               location: 'Remote',                 pay: '$160k–$200k',       tags: ['TypeScript','React','Growth'],  source: 'LinkedIn', sourceUrl: 'https://linkedin.com/jobs', posted: ago(3*D), remote: true },
  { id: 'op38', type: 'job', title: 'ML Engineer — Recommendations',     org: 'Spotify',              location: 'New York, NY',           pay: '$170k–$210k',       tags: ['Python','ML','PyTorch'],        source: 'LinkedIn', sourceUrl: 'https://linkedin.com/jobs', posted: ago(2*D), remote: false },
  { id: 'op39', type: 'job', title: 'Developer Advocate',                org: 'Vercel',               location: 'Remote',                 pay: '$130k–$160k',       tags: ['Next.js','React','DevRel'],     source: 'LinkedIn', sourceUrl: 'https://linkedin.com/jobs', posted: ago(4*D), remote: true },
  { id: 'op40', type: 'job', title: 'Head of Product',                   org: 'Notion',               location: 'San Francisco, CA',      pay: '$220k–$300k',       tags: ['Product','Strategy','B2B'],     source: 'LinkedIn', sourceUrl: 'https://linkedin.com/jobs', posted: ago(2*D), remote: false },
  { id: 'op41', type: 'job', title: 'Backend Engineer — Infra',          org: 'Cloudflare',           location: 'Remote',                 pay: '$150k–$190k',       tags: ['Go','Rust','Infrastructure'],   source: 'LinkedIn', sourceUrl: 'https://linkedin.com/jobs', posted: ago(1*D), remote: true },
  { id: 'op42', type: 'job', title: 'Data Scientist',                    org: 'Airbnb',               location: 'San Francisco, CA',      pay: '$160k–$200k',       tags: ['Python','SQL','Statistics'],    source: 'LinkedIn', sourceUrl: 'https://linkedin.com/jobs', posted: ago(3*D), remote: false },
  { id: 'op43', type: 'job', title: 'Engineering Manager',               org: 'Shopify',              location: 'Remote',                 pay: '$180k–$230k',       tags: ['Leadership','Ruby','React'],    source: 'LinkedIn', sourceUrl: 'https://linkedin.com/jobs', posted: ago(5*D), remote: true },
];

const OP_TYPE_META = {
  job:        { label: 'Job',         emoji: '💼', color: '#2563EB', bg: '#EFF6FF' },
  gig:        { label: 'Gig',         emoji: '⚡', color: '#7C3AED', bg: '#F3EEFF' },
  grant:      { label: 'Grant',       emoji: '🏦', color: '#059669', bg: '#ECFDF5' },
  event:      { label: 'Event',       emoji: '📅', color: '#D97706', bg: '#FFFBEB' },
  hackathon:  { label: 'Hackathon',   emoji: '🏆', color: '#DB2777', bg: '#FDF2F8' },
  opensource: { label: 'Open Source', emoji: '🌐', color: '#EA580C', bg: '#FFF7ED' },
  learning:   { label: 'Learning',    emoji: '🎓', color: '#0284C7', bg: '#F0F9FF' },
};

// Role → preferred opportunity types
const ROLE_OP_TYPES = {
  'Engineer / Developer':     new Set(['job','gig','hackathon','opensource','learning']),
  'Designer / Creative':      new Set(['job','gig','event','learning']),
  'Product Manager':          new Set(['job','event','learning']),
  'Marketer / Growth':        new Set(['job','gig','event','learning']),
  'Founder / Entrepreneur':   new Set(['grant','event','learning','job']),
  'Investor':                 new Set(['event','grant']),
  'Data / Analytics':         new Set(['job','gig','hackathon','learning']),
  'Student / Learner':        new Set(['learning','hackathon','opensource','grant']),
  'Sales / Business Dev':     new Set(['job','event','gig']),
  'Operations / Finance':     new Set(['job','event','learning']),
  'Content Creator':          new Set(['gig','job','event','learning']),
  'Community Manager':        new Set(['job','event','gig']),
  'Researcher / Academic':    new Set(['grant','learning','hackathon']),
  'HR / People Ops':          new Set(['job','event','learning']),
};

app.get('/opportunities', authenticate, async (req, res) => {
  const { type, remote, search } = req.query;
  const user      = await getUser(req.user.id);
  const role      = user?.preferences?.role || '';
  const skills    = new Set((user?.skills || []).map((s) => s.toLowerCase()));
  const interests = new Set((user?.preferences?.interests || []).map((s) => s.toLowerCase()));
  const roleTypes = ROLE_OP_TYPES[role] || new Set();

  let results = OPPORTUNITIES;
  if (type && type !== 'all') results = results.filter((o) => o.type === type);
  if (remote === 'true')       results = results.filter((o) => o.remote);
  if (search) {
    const q = search.toLowerCase();
    results = results.filter((o) =>
      o.title.toLowerCase().includes(q) ||
      o.org.toLowerCase().includes(q) ||
      o.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  results = results.map((o) => {
    let score = 0;
    // Skill match — highest weight
    o.tags.forEach((t) => { if (skills.has(t.toLowerCase())) score += 3; });
    // Role-type match
    if (roleTypes.has(o.type)) score += 2;
    // Interest keyword match against tags
    o.tags.forEach((t) => { if (interests.has(t.toLowerCase())) score += 1; });
    return { ...o, matchScore: score };
  });

  results.sort((a, b) => b.matchScore - a.matchScore || new Date(b.posted) - new Date(a.posted));
  res.json({ opportunities: results, meta: OP_TYPE_META });
});

// ─── Messages ─────────────────────────────────────────────────────────────────

const conversations = [
  {
    id: 'conv1',
    participants: ['u1', 'su1'],
    messages: [
      { id: 'm1', senderId: 'su1', content: 'Hey Maria! Loved your post about AI-assisted roadmapping. Would love to chat more about your evaluation framework.', createdAt: ago(3*D), read: true },
      { id: 'm2', senderId: 'u1',  content: 'Thanks Alex! Happy to share. We ended up building our own lightweight eval suite — happy to walk you through it.', createdAt: ago(2*D + 23*H), read: true },
      { id: 'm3', senderId: 'su1', content: 'That would be amazing. Are you free for a quick call this week?', createdAt: ago(2*D), read: true },
      { id: 'm4', senderId: 'u1',  content: 'Thursday works for me. What timezone are you in?', createdAt: ago(1*D + 20*H), read: true },
      { id: 'm5', senderId: 'su1', content: 'PST. Thursday 2pm works perfectly!', createdAt: ago(1*D), read: false },
    ],
  },
  {
    id: 'conv2',
    participants: ['u1', 'su6'],
    messages: [
      { id: 'm6', senderId: 'su6', content: 'Maria, saw you joined the SaaS Founders group. We are building something in the same space — would love to compare notes.', createdAt: ago(5*H), read: false },
      { id: 'm7', senderId: 'su6', content: 'Also — your profile says Future Networks. Are you the team that spoke at ProductHQ last year?', createdAt: ago(4*H + 50*60000), read: false },
    ],
  },
];

function getOtherUser(conv, userId) {
  const otherId = conv.participants.find((p) => p !== userId);
  return users.find((u) => u.id === otherId);
}

app.get('/messages', authenticate, (req, res) => {
  const uid = req.user.id;
  const myConvs = conversations.filter((c) => c.participants.includes(uid));
  const result = myConvs.map((c) => {
    const other = getOtherUser(c, uid);
    const last = c.messages[c.messages.length - 1];
    const unread = c.messages.filter((m) => m.senderId !== uid && !m.read).length;
    return {
      id: c.id,
      participant: other ? { id: other.id, name: other.name, title: other.title, organization: other.organization } : null,
      lastMessage: last ? { content: last.content, createdAt: last.createdAt, isMe: last.senderId === uid } : null,
      unreadCount: unread,
    };
  }).sort((a, b) => new Date(b.lastMessage?.createdAt) - new Date(a.lastMessage?.createdAt));
  res.json({ conversations: result });
});

app.get('/messages/:userId', authenticate, (req, res) => {
  const uid = req.user.id;
  const otherId = req.params.userId;
  let conv = conversations.find((c) => c.participants.includes(uid) && c.participants.includes(otherId));
  if (!conv) return res.json({ messages: [], conversationId: null });
  // Mark as read
  conv.messages.forEach((m) => { if (m.senderId !== uid) m.read = true; });
  const other = getOtherUser(conv, uid);
  res.json({
    conversationId: conv.id,
    participant: other ? { id: other.id, name: other.name, title: other.title, organization: other.organization } : null,
    messages: conv.messages,
  });
});

app.post('/messages/:userId', authenticate, (req, res) => {
  const uid = req.user.id;
  const otherId = req.params.userId;
  const { content, attachment } = req.body;
  if (!content?.trim() && !attachment) return res.status(400).json({ message: 'content or attachment required.' });

  let conv = conversations.find((c) => c.participants.includes(uid) && c.participants.includes(otherId));
  if (!conv) {
    conv = { id: `conv${Date.now()}`, participants: [uid, otherId], messages: [] };
    conversations.push(conv);
  }

  const newMsg = {
    id: `m${Date.now()}`,
    senderId: uid,
    content: content?.trim() || '',
    attachment: attachment || null,   // { name, size, mimeType, uri }
    createdAt: new Date().toISOString(),
    read: false,
  };
  conv.messages.push(newMsg);

  const other = getOtherUser(conv, uid);
  res.json({
    message: newMsg,
    participant: other ? { id: other.id, name: other.name, title: other.title, organization: other.organization } : null,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function loadPostsFromDB() {
  if (!db.isConnected()) return;
  try {
    const { rows } = await db.query(
      `SELECT * FROM community_posts ORDER BY created_at DESC LIMIT 500`
    );
    posts.length = 0;
    rows.forEach((r) => posts.push({
      id: r.id, authorId: r.author_id, groupId: r.group_id,
      content: r.content, likes: r.likes || [],
      commentsCount: r.comments_count || 0,
      createdAt: r.created_at, url: r.url,
      source: r.source || 'uficonnect',
      sourceLabel: r.source_label || 'UFIConnect',
    }));
    if (rows.length) console.log(`✅ Loaded ${rows.length} posts from DB`);
  } catch (err) { console.warn('loadPostsFromDB:', err.message); }
}

db.initDB().then(async () => {
  await migrateDB();
  await seedAndLoadGroups();
  await loadPostsFromDB();
  app.listen(PORT, () =>
    console.log(`UFIConnect backend listening on http://localhost:${PORT}`)
  );
});
