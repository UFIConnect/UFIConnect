// New topics to merge into ALL_INTERESTS (not already present)
export const EXTRA_INTERESTS = [
  'Startups',
  'Machine Learning',
  'MLOps',
  'API Design',
  'Privacy',
  'AI Ethics',
  'Digital Nomad',
  'Networking',
  'CRM',
  'Marketing',
  'Medicine & Clinical Practice',
  'Law & Legal Practice',
  'Architecture & Urban Design',
  'Mechanical Engineering',
  'Civil Engineering',
  'Electrical Engineering',
  'Aviation & Aerospace',
  'Military & Defense',
  'Policy & Government',
  'Accounting & Tax',
  'Insurance & Risk',
  'Agriculture & Farming',
  'Pharmaceutical & Drug Development',
  'Public Health',
  'Psychology & Behavioral Science',
  'Construction & Skilled Trades',
  'Manufacturing & Industry',
  'Energy & Utilities',
  'Logistics & Supply Chain',
  'Veterinary Science',
  'Environmental Science',
  'Ocean & Marine Sciences',
  'Materials Science',
  'Nonprofit Management',
  'Journalism & Media',
  'Screenwriting & Film',
  'Music Industry',
  'Sports Analytics',
  'Culinary Arts',
  'Hospitality & Tourism',
  'Chemical Engineering',
  'Biomedical Engineering',
  'International Relations',
];

// Interests shown to everyone (canonical list) — exported so the topic
// selectors on Feed/Videos (see FilterPanel in Feed.jsx and the Filters
// sheet in VideoFeedView.jsx) reuse the exact same vocabulary onboarding
// already offers, instead of a second, separately-maintained list that
// could drift out of sync with it (or with backend/index.js's own
// FEED_TOPICS, which a comment there notes was deliberately kept a
// superset of this list for exactly that reason).
export const ALL_INTERESTS = [
  // ── Tech & Engineering ───────────────────────────────────────────────────────
  'AI & Machine Learning', 'Generative AI', 'LLMs & Chatbots', 'Computer Vision',
  'Data Science', 'Developer Tools', 'Open Source', 'Cybersecurity',
  'Cloud & DevOps', 'Frontend Dev', 'Backend Dev', 'Mobile Dev',
  'Web3 / Crypto', 'Blockchain', 'Hardware / IoT', 'Robotics',
  'AR / VR', 'Quantum Computing', 'Game Dev', 'No-Code / Low-Code',
  // ── Business & Startups ──────────────────────────────────────────────────────
  'SaaS', 'B2B / Enterprise', 'Marketplaces', 'D2C / Consumer Apps',
  'Bootstrapping', 'Venture Capital', 'Angel Investing', 'Fundraising',
  'Growth Marketing', 'Product-Led Growth', 'Sales & Revenue', 'Partnerships',
  // ── Design & Creative ────────────────────────────────────────────────────────
  'UI/UX Design', 'Design Systems', 'Brand Identity', 'Motion Design',
  '3D & CGI', 'Photography', 'Film & Video', 'Music Production',
  'Visual Storytelling', 'Brand Strategy',
  // ── Finance & Industries ─────────────────────────────────────────────────────
  'FinTech', 'Corporate Finance', 'Personal Finance', 'Real Estate',
  'Supply Chain', 'Customer Experience', 'Operations Excellence', 'Business Strategy',
  'Health Tech', 'BioTech', 'Climate Tech', 'EdTech',
  'LegalTech', 'GovTech', 'AgriTech', 'SpaceTech',
  'PropTech', 'RetailTech', 'FoodTech', 'SportsTech',
  // ── People & Work ────────────────────────────────────────────────────────────
  'Nonprofit Impact', 'Sustainability', 'Wellness', 'Hospitality',
  'Remote Work', 'Future of Work', 'Recruiting & Hiring', 'Leadership',
  'Diversity & Inclusion', 'Mental Health & Wellness', 'People Ops',
  // ── Content & Media ──────────────────────────────────────────────────────────
  'Creator Economy', 'Podcasting', 'Newsletter & Writing',
  'YouTube & Video', 'Social Media', 'SEO & Content',
  // ── E-commerce & Career ──────────────────────────────────────────────────────
  'E-commerce', 'Dropshipping', 'Amazon FBA', 'Subscription Businesses',
  'Career Growth', 'Productivity', 'Public Speaking', 'Side Projects',
  'Freelancing', 'Social Impact',
  // ── Health & Fitness ─────────────────────────────────────────────────────────
  'Fitness & Gym', 'Yoga & Meditation', 'Running & Cycling',
  'Nutrition & Diet', 'Sports & Athletics',
  // ── Music & Audio ────────────────────────────────────────────────────────────
  'Music Discovery', 'Live Events & Concerts', 'Songwriting', 'DJing & Remixing',
  // ── Sports ───────────────────────────────────────────────────────────────────
  'Football & Soccer', 'Basketball', 'Tennis & Golf', 'Combat Sports',
  'Esports & Competitive Gaming',
  // ── Arts & Culture ───────────────────────────────────────────────────────────
  'Art & Painting', 'Theatre & Performing Arts', 'Museums & Galleries', 'Cultural Events',
  // ── Food & Cooking ───────────────────────────────────────────────────────────
  'Cooking & Recipes', 'Restaurant Culture', 'Wine & Spirits',
  'Coffee Culture', 'Baking & Pastry',
  // ── Travel ───────────────────────────────────────────────────────────────────
  'Travel & Adventure', 'Solo Travel', 'Cultural Tourism', 'Budget Travel',
  // ── Fashion & Style ──────────────────────────────────────────────────────────
  'Fashion & Style', 'Streetwear', 'Sustainable Fashion', 'Beauty & Skincare',
  // ── Books & Literature ───────────────────────────────────────────────────────
  'Reading & Book Clubs', 'Fiction & Storytelling', 'Non-Fiction & Learning',
  'Poetry & Creative Writing',
  // ── Gaming ───────────────────────────────────────────────────────────────────
  'Video Games', 'Mobile Gaming', 'Game Streaming & Content', 'Tabletop & Board Games',
  // ── Home & Lifestyle ─────────────────────────────────────────────────────────
  'Interior Design & Decor', 'Home Improvement', 'Gardening & Plants', 'Pet Ownership',
  'Humor & Memes', 'Everyday Tips', 'Facts & Explainers',
  // ── Mindfulness & Philosophy ─────────────────────────────────────────────────
  'Mindfulness & Meditation', 'Philosophy & Ethics', 'Spirituality',
  // ── Family & Community ───────────────────────────────────────────────────────
  'Parenting & Family', 'Environmental Activism', 'Zero Waste Living',
  // ── Extended (from 450+ role expansion) ──────────────────────────────────────
  ...EXTRA_INTERESTS,
];
