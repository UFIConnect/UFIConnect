const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
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
  'Engineer / Developer':     ['Engineering', 'AI & ML'],
  'Designer / Creative':      ['Design', 'Marketing'],
  'Product Manager':          ['AI & ML', 'Startups', 'Engineering'],
  'Marketer / Growth':        ['Marketing', 'Startups'],
  'Founder / Entrepreneur':   ['Startups', 'Finance', 'Marketing'],
  'Investor':                 ['Finance', 'Startups'],
  'Data / Analytics':         ['AI & ML', 'Engineering'],
  'Student / Learner':        ['Education', 'Engineering'],
};

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
const users = [
  {
    id: 'u1', name: 'Maria Chen', email: 'maria@example.com',
    passwordHash: bcrypt.hashSync('password123', 10),
    title: 'Product Lead', bio: 'Building the future of distributed teams.',
    skills: ['Community', 'Growth', 'Strategy'], organization: 'Future Networks',
    joinedGroups: ['g1', 'g2', 'g7'], onboardingComplete: true,
    preferences: { role: 'Product Manager', goals: ['Connect with peers in my field', 'Stay updated on trends'], interests: ['AI & ML', 'Startups', 'Engineering'], experience: 'Senior (7-14 years)' },
    socialAccounts: {},
  },
];

// ─── Sample community users ───────────────────────────────────────────────────
const sampleUsers = [
  { id: 'su1',  name: 'Alex Park',       title: 'ML Engineer',        organization: 'OpenCore',        avatar: null, joinedGroups: ['g1','g2','g3','g5'],           skills: ['PyTorch','MLOps','Python'] },
  { id: 'su2',  name: 'Jordan Lee',      title: 'Product Designer',   organization: 'Pixel Labs',      avatar: null, joinedGroups: ['g13','g14','g15','g16'],        skills: ['Figma','UX Research','Systems'] },
  { id: 'su3',  name: 'Sam Rivera',      title: 'Growth Lead',        organization: 'Launchpad',       avatar: null, joinedGroups: ['g9','g10','g11','g17','g18'],   skills: ['SEO','Paid Ads','Analytics'] },
  { id: 'su4',  name: 'Casey Morgan',    title: 'CTO',                organization: 'Stackr',          avatar: null, joinedGroups: ['g5','g6','g9','g11','g12'],    skills: ['Go','Kubernetes','Architecture'] },
  { id: 'su5',  name: 'Riley Chen',      title: 'VC Analyst',         organization: 'Seed Capital',   avatar: null, joinedGroups: ['g20','g21','g22','g12'],       skills: ['Due Diligence','Finance','Web3'] },
  { id: 'su6',  name: 'Morgan Kim',      title: 'Senior PM',          organization: 'Wave',            avatar: null, joinedGroups: ['g1','g11','g13','g17'],        skills: ['Roadmapping','Data','Strategy'] },
  { id: 'su7',  name: 'Taylor Nguyen',   title: 'Founder',            organization: 'Nomad OS',        avatar: null, joinedGroups: ['g9','g23','g24','g10'],        skills: ['Fundraising','Remote','Product'] },
  { id: 'su8',  name: 'Drew Santos',     title: 'DevOps Engineer',    organization: 'CloudBridge',     avatar: null, joinedGroups: ['g5','g6','g7','g8'],           skills: ['Terraform','AWS','CI/CD'] },
  { id: 'su9',  name: 'Avery Patel',     title: 'Data Scientist',     organization: 'Insight Co',      avatar: null, joinedGroups: ['g2','g3','g4','g5'],           skills: ['Python','SQL','LLMs'] },
  { id: 'su10', name: 'Quinn Zhang',     title: 'UX Designer',        organization: 'Form Studio',     avatar: null, joinedGroups: ['g13','g15','g16','g17'],       skills: ['Prototyping','Motion','Figma'] },
  { id: 'su11', name: 'Blake Thompson',  title: 'Marketing Director', organization: 'Amplify',         avatar: null, joinedGroups: ['g17','g18','g19','g11'],       skills: ['Content','Growth','Branding'] },
  { id: 'su12', name: 'Reese Williams',  title: 'Full Stack Dev',     organization: 'BuildCo',         avatar: null, joinedGroups: ['g5','g6','g8','g25'],          skills: ['React','Node','Postgres'] },
  { id: 'su13', name: 'Jamie Foster',    title: 'Content Lead',       organization: 'Story',           avatar: null, joinedGroups: ['g18','g23','g24','g26'],       skills: ['Writing','Video','SEO'] },
  { id: 'su14', name: 'Skyler Brooks',   title: 'Startup Advisor',    organization: 'Independent',     avatar: null, joinedGroups: ['g9','g10','g11','g12','g20'],  skills: ['GTM','Hiring','Fundraising'] },
  { id: 'su15', name: 'Cameron Davis',   title: 'EdTech Founder',     organization: 'Learn Forward',   avatar: null, joinedGroups: ['g25','g26','g9','g5'],         skills: ['Curriculum','EdTech','Community'] },
];

// ─── Groups ───────────────────────────────────────────────────────────────────
const groups = [
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
];

// ─── Posts ────────────────────────────────────────────────────────────────────
const posts = [
  // g1 – AI Product Managers
  { id: 'p1',  authorId: 'su6', groupId: 'g1', createdAt: ago(1.5*H), likes: ['su1','su9'], commentsCount: 4, content: 'Just shipped our first AI feature. Took 3x longer than expected because of evaluation frameworks — turns out measuring quality is harder than building the thing. Happy to do an AMA on what we learned.' },
  { id: 'p2',  authorId: 'su1', groupId: 'g1', createdAt: ago(6*H),   likes: ['su6','u1'],  commentsCount: 7, content: 'Hot take: most "AI features" are just search with extra steps. The real value is in workflow integration. Curious if others are seeing the same pattern.' },
  { id: 'p3',  authorId: 'u1',  groupId: 'g1', createdAt: ago(1*D),   likes: ['su1','su6','su9'], commentsCount: 11, content: 'We ran an experiment: one team used AI-assisted roadmapping, one did it manually. The AI team moved 40% faster but flagged 2x fewer risks. Trade-offs are real.' },

  // g2 – Machine Learning Engineers
  { id: 'p4',  authorId: 'su9', groupId: 'g2', createdAt: ago(2*H),   likes: ['su1','su4','su8'],  commentsCount: 9,  content: 'What is everyone using for RAG pipelines in 2025? We evaluated LlamaIndex vs LangChain and ended up rolling our own lightweight version. The overhead of both frameworks was killing latency.' },
  { id: 'p5',  authorId: 'su1', groupId: 'g2', createdAt: ago(14*H),  likes: ['su4','su9'],        commentsCount: 5,  content: 'Finally got inference latency under 100ms. The trick was quantization + dynamic batching together. Neither alone was enough. Happy to share the config if useful.' },
  { id: 'p6',  authorId: 'su4', groupId: 'g2', createdAt: ago(2*D),   likes: ['su1'],              commentsCount: 3,  content: 'Unpopular opinion: most teams should be using fine-tuned smaller models instead of GPT-4 for their specific tasks. We cut costs 8x with better accuracy on our domain.' },

  // g3 – Generative AI Builders
  { id: 'p7',  authorId: 'su9', groupId: 'g3', createdAt: ago(3*H),   likes: ['su1','su6','su4'],  commentsCount: 14, content: 'Built a full product design assistant using image generation + code execution. Launch is in 2 weeks. The hardest part was not the AI — it was the UX for handling failures gracefully.' },
  { id: 'p8',  authorId: 'su1', groupId: 'g3', createdAt: ago(1*D),   likes: ['su9'],              commentsCount: 6,  content: 'Anyone else finding that structured outputs with Pydantic + tool use is now the default way to build AI features? Feels like the pattern has fully matured.' },

  // g5 – Full-Stack Builders
  { id: 'p9',  authorId: 'su12', groupId: 'g5', createdAt: ago(4*H),  likes: ['su4','su8'],        commentsCount: 8,  content: 'React Server Components in production — 6 months in. Biggest win: 40% less JS sent to the client. Biggest headache: the mental model shift for the whole team. Worth it though.' },
  { id: 'p10', authorId: 'su8',  groupId: 'g5', createdAt: ago(18*H), likes: ['su12','su4','su1'], commentsCount: 12, content: 'Expo + Bun is an incredible DX combo for mobile. Build times dropped from 45s to 8s. If you are still on npm for a React Native project, try it this weekend.' },
  { id: 'p11', authorId: 'su4',  groupId: 'g5', createdAt: ago(2*D),  likes: ['su8','su12'],       commentsCount: 5,  content: 'Monorepo or multi-repo for a team of 12? We tried both. Monorepo won for us because shared types across backend and frontend eliminated an entire class of runtime bugs.' },

  // g9 – Remote Startup Founders
  { id: 'p12', authorId: 'su7',  groupId: 'g9', createdAt: ago(1*H),  likes: ['su3','su14','su4'], commentsCount: 18, content: '3 years fully remote, team across 12 countries. The thing that actually makes async culture work is not tools — it is documentation discipline. Write down every decision, no exceptions.' },
  { id: 'p13', authorId: 'su14', groupId: 'g9', createdAt: ago(8*H),  likes: ['su7','su3'],        commentsCount: 9,  content: 'Hiring remotely is now genuinely easier than local for us. The talent pool is incomparably deeper and people who choose remote work tend to be more self-directed.' },
  { id: 'p14', authorId: 'su3',  groupId: 'g9', createdAt: ago(3*D),  likes: ['su7','su4','su14'], commentsCount: 22, content: 'We ran the numbers on office vs fully remote for a 20-person company. Remote saves approximately $380k/year when you factor in real estate, commute benefits, and reduced attrition.' },

  // g11 – SaaS Founders
  { id: 'p15', authorId: 'su3',  groupId: 'g11', createdAt: ago(5*H),  likes: ['su6','su14','su7'], commentsCount: 15, content: 'Went from $0 to $10k MRR in 8 months with zero paid ads. Channel breakdown: 60% content/SEO, 25% community, 15% cold outbound. The SEO took 5 months to kick in but now compounds.' },
  { id: 'p16', authorId: 'su14', groupId: 'g11', createdAt: ago(1*D),  likes: ['su3','su6'],        commentsCount: 7,  content: 'Question for the room: when did you hire your first dedicated customer success person? We are at $25k MRR and churn just started becoming a real problem.' },
  { id: 'p17', authorId: 'su6',  groupId: 'g11', createdAt: ago(4*D),  likes: ['su3','su14','su7'], commentsCount: 19, content: 'The most underrated SaaS metric is time-to-value. We obsessed over it and got new users to their first "aha moment" in under 4 minutes. Churn dropped 40% in the next quarter.' },

  // g13 – UX/UI Designers
  { id: 'p18', authorId: 'su2',  groupId: 'g13', createdAt: ago(2*H),  likes: ['su10','su6'],       commentsCount: 6,  content: 'Design systems are only as good as your documentation. We open-sourced ours and the most valuable thing we added was not components — it was the "when NOT to use this" section for each pattern.' },
  { id: 'p19', authorId: 'su10', groupId: 'g13', createdAt: ago(12*H), likes: ['su2'],              commentsCount: 4,  content: 'Hot take: accessibility audits should happen before visual design, not after. Designing with constraints from the start produces better work, not worse.' },

  // g17 – Growth Hackers
  { id: 'p20', authorId: 'su11', groupId: 'g17', createdAt: ago(3*H),  likes: ['su3','su6','su10'], commentsCount: 11, content: 'LinkedIn organic reach is at an all-time high right now. We got 180k impressions on a post last week with zero paid boost. The algorithm is clearly rewarding text-first content.' },
  { id: 'p21', authorId: 'su3',  groupId: 'g17', createdAt: ago(2*D),  likes: ['su11'],             commentsCount: 8,  content: 'Email is still the highest ROI channel for B2B SaaS, full stop. We track every channel religiously and email beats paid by 4x on customer LTV. Do not neglect your list.' },

  // g24 – Digital Nomads
  { id: 'p22', authorId: 'su7',  groupId: 'g24', createdAt: ago(6*H),  likes: ['su13','su3'],       commentsCount: 13, content: 'Portugal Digital Nomad Visa process took us 3 months but was worth it. NHR tax status + amazing coworking scene in Lisbon. Happy to share the exact documents we used.' },
  { id: 'p23', authorId: 'su13', groupId: 'g24', createdAt: ago(1*D),  likes: ['su7','su3','su14'], commentsCount: 20, content: 'Best coworking spots in Southeast Asia in 2025: (1) Hubud, Bali — community is unreal, (2) The Work Loft, Bangkok — best internet I have ever had, (3) Common Ground, KL — perfect for heads-down weeks.' },

  // g26 – Career Changers
  { id: 'p24', authorId: 'su15', groupId: 'g26', createdAt: ago(4*H),  likes: ['su12','su13'],      commentsCount: 16, content: 'Left a 10-year career in finance to become a developer at 34. 18 months later I have a senior engineering role. The hardest part was not the technical skills — it was giving myself permission to be a beginner again.' },
  { id: 'p25', authorId: 'su12', groupId: 'g26', createdAt: ago(2*D),  likes: ['su15','su13','su2'],commentsCount: 9,  content: 'Bootcamp grad hiring thread — drop your portfolio below. I personally review every single one and forward the good ones to our hiring manager. We have 3 open roles right now.' },
];

// ─── Connections ──────────────────────────────────────────────────────────────
const connections = [
  { id: 'c1', fromId: 'u1', toId: 'su1', status: 'accepted', createdAt: ago(5*D) },
  { id: 'c2', fromId: 'u1', toId: 'su6', status: 'accepted', createdAt: ago(3*D) },
  { id: 'c3', fromId: 'su3', toId: 'u1', status: 'pending',  createdAt: ago(2*H) },
];

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
    connectedPlatforms: Object.keys(user.socialAccounts || {}),
  };
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
app.post('/auth/register', (req, res) => {
  const { name, email, password, title } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'Missing fields.' });
  if (users.find((u) => u.email === email)) return res.status(409).json({ message: 'Email already registered.' });
  const newUser = { id: `u${Date.now()}`, name, email, passwordHash: bcrypt.hashSync(password, 10), title, bio: '', skills: [], organization: '', joinedGroups: [], onboardingComplete: false, preferences: null };
  users.push(newUser);
  const token = jwt.sign({ id: newUser.id, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ token, profile: fullProfile(newUser) });
});

app.post('/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find((u) => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) return res.status(401).json({ message: 'Invalid email or password.' });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, profile: fullProfile(user) });
});

// ─── Profile ──────────────────────────────────────────────────────────────────
app.get('/profile', authenticate, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  res.json(fullProfile(user));
});

app.patch('/profile', authenticate, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  const { name, title, bio, skills, organization, links } = req.body;
  if (name) user.name = name;
  if (title !== undefined) user.title = title;
  if (bio !== undefined) user.bio = bio;
  if (skills) user.skills = skills;
  if (organization !== undefined) user.organization = organization;
  if (links !== undefined) user.links = links;
  res.json(fullProfile(user));
});

app.post('/profile/onboarding', authenticate, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  // Accept either { role, goals, interests, experience } or { preferences: {...} }
  const prefs = req.body.preferences || {
    role: req.body.role,
    goals: req.body.goals,
    interests: req.body.interests,
    experience: req.body.experience,
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
  const allMembers = [
    ...sampleUsers.filter((u) => u.joinedGroups.includes(groupId)),
    ...users.filter((u) => u.joinedGroups.includes(groupId) && u.id !== requesterId),
  ];

  const membersWithStatus = allMembers.map((u) => ({
    ...sanitizeUser(u),
    connectionStatus: getConnectionStatus(requesterId, u.id),
  }));

  res.json({ members: membersWithStatus, total: group.members });
});

app.post('/groups/:id/join', authenticate, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  const group = groups.find((g) => g.id === req.params.id);
  if (!user || !group) return res.status(404).json({ message: 'Not found.' });
  if (!user.joinedGroups.includes(group.id)) { user.joinedGroups.push(group.id); group.members += 1; }
  res.json({ joinedGroups: user.joinedGroups, recommended: recommendGroups(user.id, group.id, 3) });
});

app.delete('/groups/:id/join', authenticate, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  const group = groups.find((g) => g.id === req.params.id);
  if (!user || !group) return res.status(404).json({ message: 'Not found.' });
  const idx = user.joinedGroups.indexOf(group.id);
  if (idx > -1) { user.joinedGroups.splice(idx, 1); group.members = Math.max(0, group.members - 1); }
  res.json({ joinedGroups: user.joinedGroups });
});

// ─── Feed ─────────────────────────────────────────────────────────────────────
app.get('/feed', authenticate, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });

  const joined = new Set(user.joinedGroups);
  const feedPosts = posts
    .filter((p) => joined.has(p.groupId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((p) => {
      const author = sampleUsers.find((u) => u.id === p.authorId) || users.find((u) => u.id === p.authorId);
      const group = groups.find((g) => g.id === p.groupId);
      return {
        ...p,
        author: author ? sanitizeUser(author) : { id: p.authorId, name: 'Unknown', title: '', organization: '' },
        group: group ? { id: group.id, name: group.name, category: group.category } : null,
        likedByMe: p.likes.includes(req.user.id),
        likesCount: p.likes.length,
      };
    });

  res.json({ posts: feedPosts });
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
      const other = sampleUsers.find((u) => u.id === otherId) || users.find((u) => u.id === otherId);
      return other ? sanitizeUser(other) : null;
    })
    .filter(Boolean);
  res.json({ connections: myConnections });
});

// ─── Social accounts ─────────────────────────────────────────────────────────

// List platform configs + user's connection status
app.get('/social/platforms', authenticate, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
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
app.post('/social/connect', authenticate, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  const { platform, mockUsername } = req.body;
  if (!PLATFORMS[platform]) return res.status(400).json({ message: 'Unknown platform.' });
  if (!user.socialAccounts) user.socialAccounts = {};
  user.socialAccounts[platform] = {
    connected: true,
    username: mockUsername || `user_${Math.random().toString(36).slice(2, 8)}`,
    accessToken: `mock_token_${Date.now()}`,
    connectedAt: new Date().toISOString(),
  };
  res.json({ platform, connected: true, username: user.socialAccounts[platform].username });
});

// Disconnect a platform
app.delete('/social/connect/:platform', authenticate, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  if (user.socialAccounts) delete user.socialAccounts[req.params.platform];
  res.json({ platform: req.params.platform, connected: false });
});

// Aggregated social feed from all connected platforms
app.get('/social/feed', authenticate, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ message: 'Not found.' });
  const connected = Object.keys(user.socialAccounts || {});
  const posts = connected.flatMap((platform) => SOCIAL_POSTS[platform] || []);
  posts.sort((a, b) => new Date(b.time) - new Date(a.time));
  res.json({ posts, connectedPlatforms: connected });
});

// Indeed job listings (filtered by user profile)
app.get('/social/jobs', authenticate, (req, res) => {
  const user = users.find((u) => u.id === req.user.id);
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

app.get('/opportunities', authenticate, (req, res) => {
  const { type, remote, search } = req.query;
  const user = users.find((u) => u.id === req.user.id);
  const skills = new Set((user?.skills || []).map((s) => s.toLowerCase()));
  const interests = new Set((user?.preferences?.interests || []).map((s) => s.toLowerCase()));

  let results = OPPORTUNITIES;
  if (type && type !== 'all') results = results.filter((o) => o.type === type);
  if (remote === 'true') results = results.filter((o) => o.remote);
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
    o.tags.forEach((t) => {
      if (skills.has(t.toLowerCase())) score += 3;
    });
    const catMap = { job: 'engineering', gig: 'engineering', grant: 'startups', event: 'networking', hackathon: 'engineering', opensource: 'engineering', learning: 'education' };
    if (interests.has(catMap[o.type])) score += 1;
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
  return sampleUsers.find((u) => u.id === otherId) || users.find((u) => u.id === otherId);
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
db.initDB().then(() => {
  app.listen(PORT, () =>
    console.log(`UFIConnect backend listening on http://localhost:${PORT}`)
  );
});
