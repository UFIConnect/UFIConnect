import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

const FEATURES = [
  {
    icon: '🎯',
    title: 'Personalized from day one',
    desc: 'Pick your role and experience level during signup. Your feed, communities, and opportunities are tailored instantly — no setup required.',
  },
  {
    icon: '🌐',
    title: '80+ Live Communities',
    desc: 'Real professional communities across engineering, design, startups, finance, wellness, gaming, and more — curated around your role and interests.',
  },
  {
    icon: '💼',
    title: 'Real Opportunities',
    desc: 'Jobs, gigs, grants, events, and learning resources across creative, corporate, and startup paths. Filtered to match your goals.',
  },
  {
    icon: '🔍',
    title: 'Find your people',
    desc: 'Search professionals by name, role, skill, or interest. Follow the people who inspire you and build your professional circle.',
  },
  {
    icon: '📰',
    title: 'A feed that learns you',
    desc: 'Posts from Reddit, LinkedIn, GitHub, Twitter, Instagram, TikTok, and more — round-robin mixed so no single platform dominates.',
  },
  {
    icon: '✏️',
    title: 'Post to your community',
    desc: 'Share insights, ask questions, and build in public inside UFIConnect groups. Your community, your voice.',
  },
];

const ROLE_PREVIEWS = [
  { icon: '💻', label: 'Engineer', color: '#2563EB' },
  { icon: '🎨', label: 'Designer', color: '#7C3AED' },
  { icon: '🚀', label: 'Founder', color: '#D97706' },
  { icon: '📈', label: 'Marketer', color: '#059669' },
  { icon: '📋', label: 'Product', color: '#0284C7' },
  { icon: '💰', label: 'Investor', color: '#DB2777' },
  { icon: '🎬', label: 'Creator', color: '#EA580C' },
  { icon: '📊', label: 'Data', color: '#7C3AED' },
  { icon: '🎓', label: 'Student', color: '#6D28D9' },
  { icon: '⚙️', label: 'Ops', color: '#059669' },
  { icon: '🩺', label: 'Healthcare', color: '#DC2626' },
  { icon: '🏆', label: 'Athlete', color: '#B45309' },
  { icon: '🎵', label: 'Musician', color: '#0891B2' },
  { icon: '👨‍🍳', label: 'Chef', color: '#D97706' },
  { icon: '🏠', label: 'Real Estate', color: '#065F46' },
  { icon: '🌐', label: 'Community', color: '#0284C7' },
];

export default function Landing() {
  return (
    <>
      <Helmet>
        <title>UFIConnect — Professional Networking, No Ads</title>
        <meta name="description" content="UFIConnect is a clean, focused professional network for business, creative, educator, and operations talent. Discover communities, opportunities, and connections that move your career forward." />
        <meta name="keywords" content="professional network, career growth, creative community, business network, healthcare professionals, education, operations, jobs, gigs, opportunities" />
      </Helmet>

      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #EFF6FF 0%, #F3EEFF 100%)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <header style={{ padding: '20px 32px', borderBottom: '1px solid rgba(0,0,0,.05)', background: '#fff', boxShadow: 'var(--shadow)' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '40px', height: '40px', background: 'var(--primary)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: '900', fontSize: '1.1rem' }}>
                UF
              </div>
              <span style={{ fontWeight: '900', fontSize: '1.2rem' }}>UFIConnect</span>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <Link to="/login"
                style={{ padding: '8px 20px', borderRadius: 'var(--radius-sm)', fontSize: '.875rem', fontWeight: '600', color: 'var(--primary)', border: '1.5px solid var(--primary)', background: 'transparent', textDecoration: 'none' }}
                onMouseEnter={e => e.target.style.background = 'var(--primary-light)'}
                onMouseLeave={e => e.target.style.background = 'transparent'}
              >
                Sign In
              </Link>
              <Link to="/register"
                style={{ padding: '8px 20px', borderRadius: 'var(--radius-sm)', fontSize: '.875rem', fontWeight: '600', color: '#fff', background: 'var(--primary)', textDecoration: 'none' }}
                onMouseEnter={e => e.target.style.background = 'var(--primary-hover)'}
                onMouseLeave={e => e.target.style.background = 'var(--primary)'}
              >
                Get Started Free
              </Link>
            </div>
          </div>
        </header>

        <main style={{ flex: 1 }}>
          {/* Hero */}
          <section style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center', padding: '80px 32px 60px' }}>
            <div style={{ display: 'inline-block', padding: '6px 16px', borderRadius: 20, background: 'var(--primary-light)', color: 'var(--primary)', fontSize: '.82rem', fontWeight: 700, marginBottom: 20, border: '1px solid var(--primary)' }}>
              No ads. No noise. Just your career.
            </div>
            <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', fontWeight: '900', letterSpacing: '-.4px', marginBottom: '20px', lineHeight: '1.1' }}>
              Professional networking built for every kind of ambition
            </h1>
            <p style={{ fontSize: '1.1rem', color: 'var(--muted)', marginBottom: '36px', lineHeight: '1.7', maxWidth: '680px', margin: '0 auto 36px' }}>
              Pick your role during signup and get a personalized feed, curated communities, and relevant opportunities — instantly. No algorithm gaming, no corporate ads.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '60px' }}>
              <Link to="/register"
                style={{ padding: '13px 36px', borderRadius: 'var(--radius-sm)', fontSize: '1rem', fontWeight: '700', color: '#fff', background: 'var(--primary)', textDecoration: 'none', display: 'inline-block' }}
                onMouseEnter={e => e.target.style.background = 'var(--primary-hover)'}
                onMouseLeave={e => e.target.style.background = 'var(--primary)'}
              >
                Get Started Free →
              </Link>
              <a href="#features"
                style={{ padding: '13px 36px', borderRadius: 'var(--radius-sm)', fontSize: '1rem', fontWeight: '600', color: 'var(--primary)', background: 'transparent', border: '1.5px solid var(--primary)', textDecoration: 'none', display: 'inline-block' }}
                onMouseEnter={e => e.target.style.background = 'var(--primary-light)'}
                onMouseLeave={e => e.target.style.background = 'transparent'}
              >
                Learn More
              </a>
            </div>

            {/* Role pills preview */}
            <div style={{ marginBottom: 0 }}>
              <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: 14, fontWeight: 500 }}>
                Built for every professional — choose your role at signup
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {ROLE_PREVIEWS.map(({ icon, label, color }) => (
                  <span key={label} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 20, background: '#fff',
                    border: `1.5px solid ${color}40`, color, fontWeight: 600, fontSize: '.8rem',
                    boxShadow: 'var(--shadow)',
                  }}>
                    {icon} {label}
                  </span>
                ))}
                <span style={{ padding: '6px 14px', borderRadius: 20, background: 'var(--surface)', border: '1.5px solid var(--border)', color: 'var(--muted)', fontSize: '.8rem' }}>
                  + more
                </span>
              </div>
            </div>
          </section>

          {/* Features */}
          <section id="features" style={{ background: '#fff', padding: '70px 32px', borderTop: '1px solid var(--border)' }}>
            <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
              <h2 style={{ textAlign: 'center', fontSize: '1.5rem', fontWeight: '800', marginBottom: '10px' }}>
                Everything you need to grow professionally
              </h2>
              <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.95rem', marginBottom: '44px', maxWidth: 600, margin: '0 auto 44px' }}>
                One platform. Your feed, your network, your opportunities — personalized around who you are and where you're going.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                {FEATURES.map(({ icon, title, desc }) => (
                  <div key={title} style={{ padding: '24px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
                    <div style={{ fontSize: '1.8rem', marginBottom: '12px' }}>{icon}</div>
                    <h3 style={{ fontSize: '.95rem', fontWeight: '700', marginBottom: '8px' }}>{title}</h3>
                    <p style={{ fontSize: '.85rem', color: 'var(--muted)', lineHeight: '1.6', margin: 0 }}>{desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Social proof strip */}
          <section style={{ background: 'var(--primary)', padding: '40px 32px', color: '#fff', textAlign: 'center' }}>
            <div style={{ maxWidth: 800, margin: '0 auto' }}>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '48px', flexWrap: 'wrap' }}>
                {[
                  { stat: '80+', label: 'Live Communities' },
                  { stat: '500+', label: 'Professional Roles' },
                  { stat: '6+', label: 'Social Platforms' },
                  { stat: '100%', label: 'Ad-free' },
                ].map(({ stat, label }) => (
                  <div key={label}>
                    <div style={{ fontSize: '2rem', fontWeight: 900, marginBottom: 4 }}>{stat}</div>
                    <div style={{ fontSize: '.85rem', opacity: .85 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* How it works */}
          <section style={{ padding: '70px 32px', background: 'linear-gradient(135deg, #EFF6FF 0%, #F3EEFF 100%)' }}>
            <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: '800', marginBottom: '44px' }}>Up and running in 3 steps</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px', marginBottom: '44px' }}>
                {[
                  { step: '1', icon: '🎯', title: 'Pick your role', desc: 'Choose from 16+ professional roles. Get a bio template, title suggestions, and matching interests pre-loaded.' },
                  { step: '2', icon: '🎨', title: 'Tune your feed', desc: 'Select interests and goals in a 4-step onboarding that connects directly to your registration choices.' },
                  { step: '3', icon: '🚀', title: 'Start connecting', desc: 'Your personalized feed is live. Discover people to follow, communities to join, and opportunities to pursue.' },
                ].map(({ step, icon, title, desc }) => (
                  <div key={step} style={{ background: '#fff', padding: '28px 20px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)' }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--primary)', color: '#fff', fontWeight: 800, fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>{step}</div>
                    <div style={{ fontSize: '1.8rem', marginBottom: 10 }}>{icon}</div>
                    <div style={{ fontWeight: 700, fontSize: '.95rem', marginBottom: 8 }}>{title}</div>
                    <div style={{ fontSize: '.84rem', color: 'var(--muted)', lineHeight: 1.6 }}>{desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Bottom CTA */}
          <section style={{ background: '#fff', padding: '60px 32px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ maxWidth: '600px', margin: '0 auto' }}>
              <h3 style={{ fontSize: '1.5rem', fontWeight: '800', marginBottom: '14px' }}>Ready to join the network?</h3>
              <p style={{ fontSize: '.95rem', color: 'var(--muted)', marginBottom: '28px', lineHeight: 1.6 }}>
                Free forever. Pick your role, personalize your feed, and start connecting with ambitious professionals in minutes.
              </p>
              <Link to="/register"
                style={{ padding: '14px 40px', borderRadius: 'var(--radius-sm)', fontSize: '1rem', fontWeight: '700', color: '#fff', background: 'var(--primary)', textDecoration: 'none', display: 'inline-block' }}
                onMouseEnter={e => e.target.style.background = 'var(--primary-hover)'}
                onMouseLeave={e => e.target.style.background = 'var(--primary)'}
              >
                Get Started Free →
              </Link>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer style={{ padding: '28px 32px', borderTop: '1px solid rgba(0,0,0,.05)', background: '#fff', textAlign: 'center', fontSize: '.8rem', color: 'var(--muted)' }}>
          <p>© 2025 UFIConnect. A cleaner way to network and grow.</p>
        </footer>
      </div>
    </>
  );
}
