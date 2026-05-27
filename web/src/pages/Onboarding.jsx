import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';

/* ─── Data ─────────────────────────────────────────────────────────────────── */

const ROLES = [
  // Professional / Business
  { value: 'Engineer / Developer',     icon: '💻', label: 'Engineer / Developer',     desc: 'Software, ML, DevOps, Infrastructure' },
  { value: 'Designer / Creative',      icon: '🎨', label: 'Designer / Creative',       desc: 'UI/UX, Brand, Motion, Visual Storytelling' },
  { value: 'Product Manager',          icon: '📋', label: 'Product Manager',           desc: 'Strategy, roadmaps, and user outcomes' },
  { value: 'Marketer / Growth',        icon: '📈', label: 'Marketer / Growth',         desc: 'SEO, content, acquisition, and analytics' },
  { value: 'Founder / Entrepreneur',   icon: '🚀', label: 'Founder / Entrepreneur',    desc: 'Building a company from the ground up' },
  { value: 'Investor / VC',            icon: '💰', label: 'Investor / VC',             desc: 'Venture capital, angel investing, and LPs' },
  { value: 'Data / Analytics',         icon: '📊', label: 'Data / Analytics',          desc: 'Data science, BI, and ML engineering' },
  { value: 'Student / Learner',        icon: '🎓', label: 'Student / Learner',         desc: 'Growing skills and exploring new fields' },
  { value: 'Sales / Business Dev',     icon: '🤝', label: 'Sales / Business Dev',      desc: 'Revenue, partnerships, and client growth' },
  { value: 'Operations / Finance',     icon: '⚙️', label: 'Operations / Finance',      desc: 'Ops, accounting, strategy, and compliance' },
  { value: 'Content Creator',          icon: '🎬', label: 'Content Creator',           desc: 'Video, writing, podcasting, and newsletters' },
  { value: 'Community Manager',        icon: '🌐', label: 'Community Manager',         desc: 'Growing and engaging professional communities' },
  { value: 'Educator / Trainer',       icon: '📚', label: 'Educator / Trainer',        desc: 'Teaching, coaching, and curriculum design' },
  { value: 'Healthcare Professional',  icon: '🩺', label: 'Healthcare Professional',   desc: 'Wellness, care delivery, and patient experience' },
  { value: 'Legal / Compliance',       icon: '⚖️', label: 'Legal / Compliance',        desc: 'Policy, contracts, and regulatory affairs' },
  { value: 'Executive / Leader',       icon: '👔', label: 'Executive / Leader',        desc: 'C-suite leadership, strategy, and company vision' },
  { value: 'Small Business Owner',     icon: '🏪', label: 'Small Business Owner',      desc: 'Running and growing an independent business' },
  { value: 'Creative Director',        icon: '🎭', label: 'Creative Director',         desc: 'Directing brand stories, campaigns, and media' },
  { value: 'HR / People Ops',          icon: '👥', label: 'HR / People Ops',           desc: 'Recruiting, culture, learning and development' },
  // Lifestyle & General
  { value: 'Athlete / Coach',          icon: '🏆', label: 'Athlete / Coach',           desc: 'Sports, performance training, and coaching' },
  { value: 'Musician / Artist',        icon: '🎵', label: 'Musician / Artist',         desc: 'Music, performance, and creative arts' },
  { value: 'Journalist / Writer',      icon: '✍️', label: 'Journalist / Writer',       desc: 'Reporting, writing, and media storytelling' },
  { value: 'Chef / Food Creator',      icon: '👨‍🍳', label: 'Chef / Food Creator',      desc: 'Cooking, culinary arts, and food content' },
  { value: 'Fitness Trainer',          icon: '💪', label: 'Fitness Trainer',           desc: 'Personal training, wellness, and movement' },
  { value: 'Gamer / Streamer',         icon: '🎮', label: 'Gamer / Streamer',          desc: 'Gaming, streaming, and esports content' },
  { value: 'Real Estate Pro',          icon: '🏠', label: 'Real Estate Pro',           desc: 'Property sales, investment, and development' },
  { value: 'Event Planner',            icon: '🎉', label: 'Event Planner',             desc: 'Events, hospitality, and memorable experiences' },
  { value: 'Social Worker / Advocate', icon: '🤲', label: 'Social Worker / Advocate',  desc: 'Community service, activism, and social impact' },
  { value: 'Parent / Caregiver',       icon: '👨‍👩‍👧', label: 'Parent / Caregiver',       desc: 'Family life, childcare, and parenting community' },
];

const GOALS = [
  { value: 'networking',   icon: '🤝', label: 'Grow my network',        desc: 'Meet peers, collaborators, and mentors' },
  { value: 'jobs',         icon: '💼', label: 'Find a new role',         desc: 'Discover jobs, gigs, and contracts' },
  { value: 'learning',     icon: '📚', label: 'Learn new skills',        desc: 'Courses, tutorials, and expert guides' },
  { value: 'build',        icon: '🛠', label:  'Build in public',         desc: 'Share work, get feedback, and find collaborators' },
  { value: 'hiring',       icon: '🔍', label: 'Hire great talent',       desc: 'Find exceptional people for your team' },
  { value: 'funding',      icon: '🏦', label: 'Raise funding',           desc: 'Connect with investors, grants, and VCs' },
  { value: 'mentorship',   icon: '🧑‍🏫', label: 'Find a mentor',          desc: 'Learn from experienced professionals' },
  { value: 'events',       icon: '📅', label: 'Attend events',           desc: 'Conferences, meetups, and virtual summits' },
  { value: 'expertise',    icon: '💡', label: 'Share my expertise',      desc: 'Teach, write, and speak to others' },
  { value: 'sideproject',  icon: '🔨', label: 'Launch a side project',   desc: 'Build something new and find early users' },
];

// Interests shown to everyone (canonical list)
const ALL_INTERESTS = [
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
  // ── Mindfulness & Philosophy ─────────────────────────────────────────────────
  'Mindfulness & Meditation', 'Philosophy & Ethics', 'Spirituality',
  // ── Family & Community ───────────────────────────────────────────────────────
  'Parenting & Family', 'Environmental Activism', 'Zero Waste Living',
];

// Role → top suggested interests (shown first and pre-highlighted)
const ROLE_SUGGESTED = {
  'Engineer / Developer':    ['AI & Machine Learning', 'Open Source', 'Cloud & DevOps', 'Backend Dev', 'Frontend Dev', 'Developer Tools', 'Cybersecurity', 'Side Projects', 'Career Growth', 'Data Science'],
  'Designer / Creative':     ['UI/UX Design', 'Design Systems', 'Brand Identity', 'Motion Design', 'Photography', 'Film & Video', 'Creator Economy', 'Career Growth', '3D & CGI', 'Visual Storytelling'],
  'Product Manager':         ['SaaS', 'AI & Machine Learning', 'Growth Marketing', 'B2B / Enterprise', 'Product-Led Growth', 'Career Growth', 'UI/UX Design', 'Data Science', 'Startups', 'Customer Experience'],
  'Marketer / Growth':       ['Growth Marketing', 'SEO & Content', 'Creator Economy', 'Social Media', 'Brand Identity', 'Newsletter & Writing', 'SaaS', 'E-commerce', 'Data Science', 'Career Growth'],
  'Founder / Entrepreneur':  ['SaaS', 'Bootstrapping', 'Fundraising', 'Venture Capital', 'Growth Marketing', 'AI & Machine Learning', 'B2B / Enterprise', 'Leadership', 'Side Projects', 'Productivity'],
  'Investor / VC':           ['Venture Capital', 'Angel Investing', 'SaaS', 'AI & Machine Learning', 'FinTech', 'Health Tech', 'Climate Tech', 'Fundraising', 'Startups', 'Business Strategy'],
  'Data / Analytics':        ['Data Science', 'AI & Machine Learning', 'Cloud & DevOps', 'Business Strategy', 'Machine Learning', 'FinTech', 'Career Growth', 'Productivity', 'Open Source', 'Cybersecurity'],
  'Student / Learner':       ['Career Growth', 'AI & Machine Learning', 'Open Source', 'Frontend Dev', 'Data Science', 'Side Projects', 'Freelancing', 'Productivity', 'Networking', 'Developer Tools'],
  'Sales / Business Dev':    ['B2B / Enterprise', 'SaaS', 'Growth Marketing', 'Partnerships', 'Sales & Revenue', 'CRM', 'Career Growth', 'Leadership', 'FinTech', 'Customer Experience'],
  'Operations / Finance':    ['Business Strategy', 'FinTech', 'Operations Excellence', 'Supply Chain', 'Corporate Finance', 'Leadership', 'Career Growth', 'Productivity', 'Remote Work', 'SaaS'],
  'Content Creator':         ['Creator Economy', 'YouTube & Video', 'Podcasting', 'Newsletter & Writing', 'Social Media', 'Brand Identity', 'SEO & Content', 'Career Growth', 'Personal Finance', 'Side Projects'],
  'Community Manager':       ['Creator Economy', 'Social Media', 'Recruiting & Hiring', 'Diversity & Inclusion', 'Leadership', 'Career Growth', 'Remote Work', 'EdTech', 'Productivity', 'Marketing'],
  'Educator / Trainer':      ['EdTech', 'Career Growth', 'Productivity', 'Leadership', 'Diversity & Inclusion', 'Mental Health & Wellness', 'Public Speaking', 'Newsletter & Writing', 'Social Impact', 'AI & Machine Learning'],
  'Healthcare Professional': ['Health Tech', 'BioTech', 'Mental Health & Wellness', 'AI & Machine Learning', 'Data Science', 'Wellness', 'Social Impact', 'Productivity', 'Career Growth', 'Leadership'],
  'Legal / Compliance':      ['LegalTech', 'Corporate Finance', 'FinTech', 'Business Strategy', 'Leadership', 'Career Growth', 'Privacy', 'AI Ethics', 'Data Science', 'GovTech'],
  'Executive / Leader':      ['Leadership', 'Business Strategy', 'SaaS', 'Fundraising', 'AI & Machine Learning', 'Productivity', 'Venture Capital', 'Growth Marketing', 'People Ops', 'Career Growth'],
  'Small Business Owner':    ['E-commerce', 'Growth Marketing', 'Personal Finance', 'Social Media', 'Operations Excellence', 'Hospitality', 'FoodTech', 'RetailTech', 'Freelancing', 'Side Projects'],
  'Creative Director':       ['Brand Identity', 'Visual Storytelling', 'Motion Design', 'Film & Video', 'UI/UX Design', 'Creator Economy', 'Brand Strategy', '3D & CGI', 'Photography', 'Music Production'],
  'HR / People Ops':         ['Recruiting & Hiring', 'Diversity & Inclusion', 'People Ops', 'Leadership', 'Mental Health & Wellness', 'EdTech', 'Career Growth', 'Remote Work', 'Future of Work', 'Productivity'],
  // New general / lifestyle roles
  'Athlete / Coach':          ['Sports & Athletics', 'Fitness & Gym', 'Running & Cycling', 'Nutrition & Diet', 'Mental Health & Wellness', 'Leadership', 'Career Growth', 'Productivity', 'Social Impact', 'Side Projects'],
  'Musician / Artist':        ['Music Discovery', 'Live Events & Concerts', 'Creator Economy', 'Music Production', 'Songwriting', 'YouTube & Video', 'Social Media', 'Brand Identity', 'Side Projects', 'Career Growth'],
  'Journalist / Writer':      ['Newsletter & Writing', 'SEO & Content', 'Social Media', 'Fiction & Storytelling', 'Non-Fiction & Learning', 'Reading & Book Clubs', 'Career Growth', 'Creator Economy', 'Podcasting', 'Public Speaking'],
  'Chef / Food Creator':      ['Cooking & Recipes', 'Restaurant Culture', 'Baking & Pastry', 'Wine & Spirits', 'Coffee Culture', 'FoodTech', 'Creator Economy', 'YouTube & Video', 'Social Media', 'Brand Identity'],
  'Fitness Trainer':          ['Fitness & Gym', 'Yoga & Meditation', 'Running & Cycling', 'Nutrition & Diet', 'Sports & Athletics', 'Mental Health & Wellness', 'Creator Economy', 'Social Media', 'Career Growth', 'Health Tech'],
  'Gamer / Streamer':         ['Video Games', 'Game Streaming & Content', 'Mobile Gaming', 'Esports & Competitive Gaming', 'YouTube & Video', 'Creator Economy', 'Social Media', 'Side Projects', 'Career Growth', 'Game Dev'],
  'Real Estate Pro':          ['Real Estate', 'PropTech', 'Personal Finance', 'Business Strategy', 'FinTech', 'Leadership', 'Interior Design & Decor', 'Home Improvement', 'Career Growth', 'Productivity'],
  'Event Planner':            ['Cultural Events', 'Hospitality', 'Leadership', 'Social Media', 'Brand Identity', 'Career Growth', 'Productivity', 'Travel & Adventure', 'Diversity & Inclusion', 'Creator Economy'],
  'Social Worker / Advocate': ['Social Impact', 'Diversity & Inclusion', 'Mental Health & Wellness', 'Leadership', 'Nonprofit Impact', 'Environmental Activism', 'Parenting & Family', 'Career Growth', 'Public Speaking', 'EdTech'],
  'Parent / Caregiver':       ['Parenting & Family', 'Mental Health & Wellness', 'Wellness', 'Nutrition & Diet', 'EdTech', 'Career Growth', 'Productivity', 'Reading & Book Clubs', 'Mindfulness & Meditation', 'Personal Finance'],
};

// Interest → unlocks these related interests
const INTEREST_CONNECTIONS = {
  'AI & Machine Learning':   ['Generative AI', 'LLMs & Chatbots', 'Computer Vision', 'Data Science', 'MLOps'],
  'Generative AI':           ['LLMs & Chatbots', 'AI & Machine Learning', 'Creator Economy', 'No-Code / Low-Code'],
  'Frontend Dev':            ['Backend Dev', 'Mobile Dev', 'No-Code / Low-Code', 'Open Source', 'UI/UX Design'],
  'Backend Dev':             ['Frontend Dev', 'Cloud & DevOps', 'Cybersecurity', 'Open Source', 'API Design'],
  'UI/UX Design':            ['Design Systems', 'Brand Identity', 'Motion Design', 'Product-Led Growth'],
  'Design Systems':          ['UI/UX Design', 'Brand Identity', '3D & CGI', 'Motion Design'],
  'Bootstrapping':           ['SaaS', 'Side Projects', 'Freelancing', 'E-commerce', 'Product-Led Growth'],
  'Venture Capital':         ['Angel Investing', 'Fundraising', 'SaaS', 'FinTech', 'B2B / Enterprise'],
  'Growth Marketing':        ['SEO & Content', 'Social Media', 'Newsletter & Writing', 'Product-Led Growth', 'E-commerce'],
  'Creator Economy':         ['YouTube & Video', 'Podcasting', 'Newsletter & Writing', 'Social Media', 'Photography'],
  'Data Science':            ['AI & Machine Learning', 'Cloud & DevOps', 'Open Source', 'Business Strategy'],
  'Cybersecurity':           ['Cloud & DevOps', 'Open Source', 'Backend Dev', 'Privacy'],
  'Health Tech':             ['BioTech', 'Wellness', 'AI & Machine Learning', 'Data Science', 'Mental Health & Wellness'],
  'Climate Tech':            ['Sustainability', 'AgriTech', 'Social Impact', 'BioTech'],
  'FinTech':                 ['Venture Capital', 'Corporate Finance', 'Blockchain', 'SaaS', 'Personal Finance'],
  'EdTech':                  ['Career Growth', 'Productivity', 'Social Impact', 'Creator Economy'],
  'Remote Work':             ['Future of Work', 'Productivity', 'Freelancing', 'Digital Nomad'],
  'Leadership':              ['People Ops', 'Diversity & Inclusion', 'Business Strategy', 'Career Growth'],
  'Side Projects':           ['Open Source', 'Bootstrapping', 'Freelancing', 'SaaS', 'Creator Economy'],
  // Lifestyle interest connections
  'Fitness & Gym':           ['Running & Cycling', 'Nutrition & Diet', 'Sports & Athletics', 'Yoga & Meditation', 'Mental Health & Wellness'],
  'Yoga & Meditation':       ['Mindfulness & Meditation', 'Mental Health & Wellness', 'Spirituality', 'Fitness & Gym', 'Philosophy & Ethics'],
  'Running & Cycling':       ['Fitness & Gym', 'Sports & Athletics', 'Nutrition & Diet'],
  'Sports & Athletics':      ['Fitness & Gym', 'Running & Cycling', 'Combat Sports', 'Esports & Competitive Gaming', 'SportsTech'],
  'Music Discovery':         ['Live Events & Concerts', 'Music Production', 'Creator Economy', 'Songwriting', 'DJing & Remixing'],
  'Live Events & Concerts':  ['Music Discovery', 'Cultural Events', 'Travel & Adventure', 'Creator Economy'],
  'Video Games':             ['Game Streaming & Content', 'Esports & Competitive Gaming', 'Mobile Gaming', 'Game Dev', 'Tabletop & Board Games'],
  'Game Streaming & Content': ['Video Games', 'YouTube & Video', 'Creator Economy', 'Social Media'],
  'Cooking & Recipes':       ['Baking & Pastry', 'Restaurant Culture', 'Wine & Spirits', 'Coffee Culture', 'FoodTech'],
  'Travel & Adventure':      ['Solo Travel', 'Cultural Tourism', 'Budget Travel', 'Cultural Events', 'Photography'],
  'Fashion & Style':         ['Streetwear', 'Sustainable Fashion', 'Beauty & Skincare', 'Photography', 'Brand Identity'],
  'Sustainable Fashion':     ['Fashion & Style', 'Sustainability', 'Environmental Activism', 'Zero Waste Living'],
  'Reading & Book Clubs':    ['Fiction & Storytelling', 'Non-Fiction & Learning', 'Poetry & Creative Writing', 'Newsletter & Writing'],
  'Art & Painting':          ['Photography', 'Theatre & Performing Arts', 'Museums & Galleries', '3D & CGI', 'Motion Design'],
  'Mindfulness & Meditation': ['Yoga & Meditation', 'Mental Health & Wellness', 'Philosophy & Ethics', 'Spirituality', 'Productivity'],
  'Parenting & Family':      ['Mental Health & Wellness', 'Wellness', 'EdTech', 'Productivity', 'Personal Finance'],
  'Environmental Activism':  ['Sustainability', 'Zero Waste Living', 'Climate Tech', 'Social Impact', 'Nonprofit Impact'],
};

const EXPERIENCE = [
  { value: 'student',   icon: '🌱', label: 'Early-stage',    desc: 'Student or entry-level, 0–1 year' },
  { value: 'junior',    icon: '📗', label: 'Junior',          desc: '1–3 years of experience' },
  { value: 'mid',       icon: '📘', label: 'Mid-level',       desc: '3–6 years of experience' },
  { value: 'senior',    icon: '📙', label: 'Senior',          desc: '6–10 years of experience' },
  { value: 'principal', icon: '🏅', label: 'Principal / Staff', desc: '10+ years, deep expertise' },
  { value: 'exec',      icon: '🏆', label: 'Executive',       desc: 'C-suite, VP, or Founder' },
];

const STEPS = ['Your Role', 'Topics', 'Goals', 'Experience'];

/* ─── Component ─────────────────────────────────────────────────────────────── */

function loadSignupCtx() {
  try { return JSON.parse(localStorage.getItem('ufi_signup_ctx') || 'null'); } catch { return null; }
}

export default function Onboarding() {
  const { updateProfileLocally } = useAuth();
  const navigate = useNavigate();

  // Read registration context once on mount
  const signupCtx = loadSignupCtx();
  const ctxRole        = signupCtx?.role        || '';
  const ctxExperience  = signupCtx?.experience  || '';
  const ctxPreInterests = signupCtx?.preInterests || [];

  const [step,       setStep]       = useState(ctxRole ? 1 : 0);
  const [role,       setRole]       = useState(ctxRole);
  const [interests,  setInterests]  = useState(
    ctxRole && ctxPreInterests.length > 0 ? ctxPreInterests.slice(0, 5) : []
  );
  const [goals,      setGoals]      = useState([]);
  const [experience, setExperience] = useState(ctxExperience);
  const [loading,    setLoading]    = useState(false);
  const [lastPicked, setLastPicked] = useState('');

  // Interests visible for this step: suggested first, then rest
  const suggested = ROLE_SUGGESTED[role] || [];
  const related   = interests.flatMap(i => INTEREST_CONNECTIONS[i] || []);
  const unlocked  = [...new Set([...suggested, ...related])];
  const remaining = ALL_INTERESTS.filter(i => !unlocked.includes(i));
  // Dedup and order: unlocked first, then remaining
  const interestList = [...new Set([...unlocked, ...remaining])];

  function toggleInterest(val) {
    setLastPicked(val);
    setInterests(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );
  }

  function toggleGoal(val) {
    setGoals(prev =>
      prev.includes(val) ? prev.filter(v => v !== val) : [...prev, val]
    );
  }

  function canNext() {
    if (step === 0) return !!role;
    if (step === 1) return interests.length > 0;
    if (step === 2) return goals.length > 0;
    if (step === 3) return !!experience;
    return false;
  }

  async function handleFinish() {
    setLoading(true);
    try {
      const payload = { role, goals, interests, experience };
      const ctx = loadSignupCtx();
      if (ctx?.bio)   payload.bio   = ctx.bio;
      if (ctx?.title) payload.title = ctx.title;
      await client.post('/profile/onboarding', payload);
      localStorage.removeItem('ufi_signup_ctx');
      updateProfileLocally({ onboardingComplete: true });
      navigate('/', { replace: true });
    } catch {
      localStorage.removeItem('ufi_signup_ctx');
      updateProfileLocally({ onboardingComplete: true });
      navigate('/', { replace: true });
    } finally {
      setLoading(false);
    }
  }

  const progress = ((step) / STEPS.length) * 100;

  return (
    <div className="onboarding-page">
      <div className="onboarding-card" style={{ maxWidth: 680 }}>

        {/* Progress bar */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            {STEPS.map((s, i) => (
              <span key={i} style={{ fontSize: '.72rem', fontWeight: i === step ? 700 : 400,
                color: i <= step ? 'var(--primary)' : 'var(--muted)', transition: 'color .3s' }}>
                {s}
              </span>
            ))}
          </div>
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${((step + 1) / STEPS.length) * 100}%`,
              background: 'var(--primary)', borderRadius: 4, transition: 'width .4s ease' }} />
          </div>
        </div>

        {/* ── Step 0 — Role ── */}
        {step === 0 && (
          <>
            <h1 className="onboarding-title">What best describes you?</h1>
            <p className="onboarding-sub">We'll tailor your feed, communities, and opportunities around your role.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 24 }}>
              {ROLES.map(({ value, icon, label, desc }) => (
                <button
                  key={value}
                  onClick={() => setRole(value)}
                  style={{
                    padding: '14px 16px', borderRadius: 14, border: `2px solid ${role === value ? 'var(--primary)' : 'var(--border)'}`,
                    background: role === value ? 'var(--primary-light)' : 'var(--surface)',
                    cursor: 'pointer', textAlign: 'left', transition: 'all .2s',
                    transform: role === value ? 'scale(1.02)' : 'scale(1)',
                    boxShadow: role === value ? '0 4px 16px rgba(0,98,255,.15)' : 'none',
                  }}
                >
                  <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>{icon}</div>
                  <div style={{ fontWeight: 700, fontSize: '.88rem', color: role === value ? 'var(--primary)' : 'var(--text)', marginBottom: 3 }}>
                    {label.replace(icon, '').trim()}
                  </div>
                  <div style={{ fontSize: '.74rem', color: 'var(--muted)', lineHeight: 1.4 }}>{desc}</div>
                  {role === value && (
                    <div style={{ marginTop: 8, fontSize: '.7rem', fontWeight: 700, color: 'var(--primary)' }}>✓ Selected</div>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── Step 1 — Interests / Topics ── */}
        {step === 1 && (
          <>
            {/* Personalisation banner when role came from registration */}
            {ctxRole && (
              <div style={{
                marginBottom: 16, padding: '10px 14px', borderRadius: 10,
                background: 'var(--primary-light)', border: '1.5px solid var(--primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}>
                <span style={{ fontSize: '.83rem', color: 'var(--primary)', fontWeight: 600 }}>
                  ✦ Personalised for <strong>{ctxRole}</strong> — topics and interests pre-loaded
                </span>
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  style={{ fontSize: '.72rem', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', whiteSpace: 'nowrap' }}
                >
                  Change role
                </button>
              </div>
            )}
            <h1 className="onboarding-title">What topics interest you?</h1>
            <p className="onboarding-sub">
              {role ? `Recommended topics for a ${role} are highlighted first.` : 'Pick as many as you like — your feed will reflect these.'}
              {' '}Selecting a topic unlocks related ones below.
            </p>

            {/* Suggested / unlocked section */}
            {unlocked.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--primary)', marginBottom: 10, letterSpacing: '.3px', textTransform: 'uppercase' }}>
                  ✦ Recommended for you
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {unlocked.map(topic => {
                    const isSelected = interests.includes(topic);
                    const isSuggested = suggested.includes(topic);
                    const isNew = related.includes(topic) && !suggested.includes(topic) && topic === lastPicked;
                    return (
                      <button
                        key={topic}
                        onClick={() => toggleInterest(topic)}
                        style={{
                          padding: '8px 14px', borderRadius: 22,
                          border: `2px solid ${isSelected ? 'var(--primary)' : isSuggested ? '#93C5FD' : 'var(--border)'}`,
                          background: isSelected ? 'var(--primary)' : isSuggested ? '#EFF6FF' : 'var(--surface)',
                          color: isSelected ? '#fff' : 'var(--text)',
                          fontWeight: isSelected ? 700 : 500, fontSize: '.83rem',
                          cursor: 'pointer', transition: 'all .2s',
                          boxShadow: isSelected ? '0 2px 8px rgba(0,98,255,.25)' : 'none',
                        }}
                      >
                        {isSelected ? '✓ ' : ''}{topic}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* More topics */}
            {remaining.length > 0 && (
              <div>
                <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--muted)', marginBottom: 10, letterSpacing: '.3px', textTransform: 'uppercase' }}>
                  More topics
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {remaining.map(topic => {
                    const isSelected = interests.includes(topic);
                    return (
                      <button
                        key={topic}
                        onClick={() => toggleInterest(topic)}
                        style={{
                          padding: '7px 13px', borderRadius: 22,
                          border: `2px solid ${isSelected ? 'var(--primary)' : 'var(--border)'}`,
                          background: isSelected ? 'var(--primary)' : 'var(--surface)',
                          color: isSelected ? '#fff' : 'var(--text)',
                          fontWeight: isSelected ? 700 : 400, fontSize: '.8rem',
                          cursor: 'pointer', transition: 'all .2s',
                        }}
                      >
                        {isSelected ? '✓ ' : ''}{topic}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {interests.length > 0 && (
              <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--primary-light)', borderRadius: 10, fontSize: '.8rem', color: 'var(--primary)', fontWeight: 600 }}>
                ✓ {interests.length} topic{interests.length !== 1 ? 's' : ''} selected — your feed is already taking shape.
              </div>
            )}
          </>
        )}

        {/* ── Step 2 — Goals ── */}
        {step === 2 && (
          <>
            <h1 className="onboarding-title">What brings you here?</h1>
            <p className="onboarding-sub">Select everything that applies. Your feed, opportunities, and connections will reflect your goals.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 24 }}>
              {GOALS.map(({ value, icon, label, desc }) => {
                const sel = goals.includes(value);
                return (
                  <button
                    key={value}
                    onClick={() => toggleGoal(value)}
                    style={{
                      padding: '14px 16px', borderRadius: 14,
                      border: `2px solid ${sel ? 'var(--primary)' : 'var(--border)'}`,
                      background: sel ? 'var(--primary-light)' : 'var(--surface)',
                      cursor: 'pointer', textAlign: 'left', transition: 'all .2s',
                      transform: sel ? 'scale(1.02)' : 'scale(1)',
                      boxShadow: sel ? '0 4px 16px rgba(0,98,255,.15)' : 'none',
                    }}
                  >
                    <div style={{ fontSize: '1.4rem', marginBottom: 6 }}>{icon}</div>
                    <div style={{ fontWeight: 700, fontSize: '.88rem', color: sel ? 'var(--primary)' : 'var(--text)', marginBottom: 3 }}>
                      {label}
                    </div>
                    <div style={{ fontSize: '.74rem', color: 'var(--muted)', lineHeight: 1.4 }}>{desc}</div>
                    {sel && <div style={{ marginTop: 8, fontSize: '.7rem', fontWeight: 700, color: 'var(--primary)' }}>✓ Selected</div>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ── Step 3 — Experience ── */}
        {step === 3 && (
          <>
            <h1 className="onboarding-title">What's your experience level?</h1>
            <p className="onboarding-sub">This helps us calibrate content difficulty and tailor connection suggestions to your career stage.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 24 }}>
              {EXPERIENCE.map(({ value, icon, label, desc }) => (
                <button
                  key={value}
                  onClick={() => setExperience(value)}
                  style={{
                    padding: '18px 16px', borderRadius: 14,
                    border: `2px solid ${experience === value ? 'var(--primary)' : 'var(--border)'}`,
                    background: experience === value ? 'var(--primary-light)' : 'var(--surface)',
                    cursor: 'pointer', textAlign: 'left', transition: 'all .2s',
                    transform: experience === value ? 'scale(1.03)' : 'scale(1)',
                    boxShadow: experience === value ? '0 4px 16px rgba(0,98,255,.15)' : 'none',
                  }}
                >
                  <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>{icon}</div>
                  <div style={{ fontWeight: 700, fontSize: '.9rem', color: experience === value ? 'var(--primary)' : 'var(--text)', marginBottom: 3 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: '.74rem', color: 'var(--muted)' }}>{desc}</div>
                  {experience === value && <div style={{ marginTop: 8, fontSize: '.7rem', fontWeight: 700, color: 'var(--primary)' }}>✓ Selected</div>}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 20 }}>
          <div>
            {step > 0 && (
              <button className="btn btn-ghost" onClick={() => setStep(s => s - 1)}>
                ← Back
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {step === 1 && interests.length === 0 && (
              <button className="btn btn-ghost" onClick={() => setStep(s => s + 1)}>
                Skip for now
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                className="btn btn-primary"
                disabled={!canNext()}
                onClick={() => setStep(s => s + 1)}
                style={{ minWidth: 120 }}
              >
                Continue →
              </button>
            ) : (
              <button
                className="btn btn-primary"
                disabled={!canNext() || loading}
                onClick={handleFinish}
                style={{ minWidth: 140 }}
              >
                {loading ? <span className="spinner" /> : '🎉 Finish setup'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
