import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';

const ROLES = [
  { value: 'Engineer / Developer',   label: '💻 Engineer / Developer',    desc: 'Software, ML, DevOps' },
  { value: 'Designer / Creative',    label: '🎨 Designer / Creative',      desc: 'UI/UX, Brand, Motion' },
  { value: 'Product Manager',        label: '📋 Product Manager',          desc: 'Strategy & execution' },
  { value: 'Marketer / Growth',      label: '📈 Marketer / Growth',        desc: 'SEO, Content, Ads' },
  { value: 'Founder / Entrepreneur', label: '🚀 Founder / Entrepreneur',   desc: 'Building something new' },
  { value: 'Investor / VC',          label: '💰 Investor / VC',            desc: 'VC, Angel, LP' },
  { value: 'Data / Analytics',       label: '📊 Data / Analytics',         desc: 'Data Sci, BI, MLOps' },
  { value: 'Student / Learner',      label: '🎓 Student / Learner',        desc: 'Growing & exploring' },
  { value: 'Sales / Business Dev',   label: '🤝 Sales / Business Dev',     desc: 'Revenue, partnerships' },
  { value: 'Operations / Finance',   label: '⚙️ Operations / Finance',     desc: 'Ops, accounting, strategy' },
  { value: 'Content Creator',        label: '🎬 Content Creator',          desc: 'Video, writing, podcasts' },
  { value: 'Community Manager',      label: '🌐 Community Manager',        desc: 'Grow & engage communities' },
  { value: 'Researcher / Academic',  label: '🔬 Researcher / Academic',    desc: 'R&D, academia, science' },
  { value: 'HR / People Ops',        label: '👥 HR / People Ops',          desc: 'Recruiting, culture, L&D' },
];

const GOALS = [
  { value: 'networking',    label: '🤝 Grow my network',          desc: 'Meet peers & collaborators' },
  { value: 'jobs',          label: '💼 Find a new role',           desc: 'Jobs, gigs & contracts' },
  { value: 'learning',      label: '📚 Learn new skills',          desc: 'Courses, tutorials, guides' },
  { value: 'build',         label: '🛠 Build in public',           desc: 'Share work & get feedback' },
  { value: 'hiring',        label: '🔍 Hire talent',               desc: 'Find great people to hire' },
  { value: 'funding',       label: '🏦 Raise funding',             desc: 'Grants, investors, VCs' },
  { value: 'mentorship',    label: '🧑‍🏫 Find a mentor',             desc: 'Learn from experienced pros' },
  { value: 'events',        label: '📅 Attend events & meetups',   desc: 'Conferences, IRL & online' },
  { value: 'expertise',     label: '💡 Share my expertise',        desc: 'Teach, write, speak' },
  { value: 'sideproject',   label: '🔨 Build a side project',      desc: 'Hack on something new' },
];

const INTERESTS = [
  'AI & Machine Learning', 'Web3 / Crypto', 'SaaS', 'Developer Tools',
  'Climate Tech', 'Health Tech', 'FinTech', 'EdTech', 'Design Systems',
  'Open Source', 'Remote Work', 'No-Code / Low-Code',
  'Cybersecurity', 'Mobile Dev', 'Game Dev', 'Hardware / IoT',
  'AR / VR', 'Social Impact', 'E-commerce', 'Creator Economy',
];

const EXPERIENCE = [
  { value: 'student',   label: 'Student / Entry-level',   desc: '0–1 year' },
  { value: 'junior',    label: 'Junior',                   desc: '1–3 years' },
  { value: 'mid',       label: 'Mid-level',                desc: '3–6 years' },
  { value: 'senior',    label: 'Senior',                   desc: '6–10 years' },
  { value: 'principal', label: 'Principal / Staff',        desc: '10+ years' },
  { value: 'exec',      label: 'Executive / Founder',      desc: 'C-suite, Founder' },
];

const STEPS = ['Role', 'Goals', 'Interests', 'Experience'];

export default function Onboarding() {
  const { updateProfileLocally } = useAuth();
  const navigate = useNavigate();

  const [step, setStep]   = useState(0);
  const [role, setRole]   = useState('');
  const [goals, setGoals] = useState([]);
  const [interests, setInterests] = useState([]);
  const [experience, setExperience] = useState('');
  const [loading, setLoading] = useState(false);

  function toggleMulti(arr, setArr, val) {
    setArr((prev) => prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]);
  }

  function canNext() {
    if (step === 0) return !!role;
    if (step === 1) return goals.length > 0;
    if (step === 2) return interests.length > 0;
    if (step === 3) return !!experience;
    return false;
  }

  async function handleFinish() {
    setLoading(true);
    try {
      await client.post('/profile/onboarding', {
        role, goals, interests, experience,
      });
      updateProfileLocally({ onboardingComplete: true });
      navigate('/', { replace: true });
    } catch {
      // proceed anyway
      updateProfileLocally({ onboardingComplete: true });
      navigate('/', { replace: true });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        {/* Progress */}
        <div className="step-progress">
          {STEPS.map((_, i) => (
            <div key={i} className={`step-dot${i <= step ? ' done' : ''}`} />
          ))}
        </div>

        <div className="onboarding-step">Step {step + 1} of {STEPS.length}</div>

        {/* Step 0 — Role */}
        {step === 0 && (<>
          <h1 className="onboarding-title">What's your role?</h1>
          <p className="onboarding-sub">We'll tailor your feed, groups, and opportunities around it.</p>
          <div className="option-grid">
            {ROLES.map(({ value, label, desc }) => (
              <button key={value}
                className={`option-btn${role === value ? ' selected' : ''}`}
                onClick={() => setRole(value)}
              >
                <div className="option-label">{label}</div>
                <div className="option-desc">{desc}</div>
              </button>
            ))}
          </div>
        </>)}

        {/* Step 1 — Goals */}
        {step === 1 && (<>
          <h1 className="onboarding-title">What are you here for?</h1>
          <p className="onboarding-sub">Pick everything that applies — no wrong answers.</p>
          <div className="option-grid">
            {GOALS.map(({ value, label, desc }) => (
              <button key={value}
                className={`option-btn multi${goals.includes(value) ? ' selected' : ''}`}
                onClick={() => toggleMulti(goals, setGoals, value)}
              >
                <div className="option-label">{label}</div>
                <div className="option-desc">{desc}</div>
              </button>
            ))}
          </div>
        </>)}

        {/* Step 2 — Interests */}
        {step === 2 && (<>
          <h1 className="onboarding-title">What topics light you up?</h1>
          <p className="onboarding-sub">We surface groups and opportunities in these areas.</p>
          <div className="tags" style={{ marginBottom: 24 }}>
            {INTERESTS.map((topic) => (
              <button key={topic}
                className={`filter-btn${interests.includes(topic) ? ' active' : ''}`}
                onClick={() => toggleMulti(interests, setInterests, topic)}
              >
                {topic}
              </button>
            ))}
          </div>
        </>)}

        {/* Step 3 — Experience */}
        {step === 3 && (<>
          <h1 className="onboarding-title">How much experience do you have?</h1>
          <p className="onboarding-sub">This helps us calibrate content difficulty and connection suggestions.</p>
          <div className="option-grid">
            {EXPERIENCE.map(({ value, label, desc }) => (
              <button key={value}
                className={`option-btn${experience === value ? ' selected' : ''}`}
                onClick={() => setExperience(value)}
              >
                <div className="option-label">{label}</div>
                <div className="option-desc">{desc}</div>
              </button>
            ))}
          </div>
        </>)}

        {/* Footer nav */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {step > 0 && (
            <button className="btn btn-ghost" onClick={() => setStep((s) => s - 1)}>
              ← Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary" disabled={!canNext()} onClick={() => setStep((s) => s + 1)}>
              Continue →
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!canNext() || loading} onClick={handleFinish}>
              {loading ? <span className="spinner" /> : 'Finish setup 🎉'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
