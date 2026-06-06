import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

const roles = [
  'Engineer', 'Designer', 'Product Manager', 'Founder',
  'Marketer', 'Data Scientist', 'Growth', 'Sales',
  'HR', 'Recruiter', 'Investor', 'Researcher',
  'Content Creator', 'Consultant'
];

export default function Landing() {
  return (
    <>
      <Helmet>
        <title>UFIConnect — Professional Networking, Connect & News (LinkedIn Alternative)</title>
        <meta name="description" content="UFIConnect is a clean, ad-free professional network to connect with engineers, designers, founders, and creatives. News feed, communities, job listings, and networking — all tailored to you. Better than LinkedIn, Facebook Groups, and Twitter for professional connections." />
        <meta name="keywords" content="professional network, connect with professionals, networking platform, news feed, career networking, tech community, engineers, designers, founders, creatives, job listings, remote jobs, professional communities, networking app, LinkedIn alternative, Facebook Groups alternative, Twitter communities, career opportunities, tech careers, startup community, developer network, UX design community, product managers, marketing professionals, business networking, online communities, professional connections, industry news, career development, business connections, professional growth, networking solutions, community platform, tech professionals, talent network, ufi connect, connect professionals, networking news, professional news" />
        <meta name="author" content="UFIConnect" />
        <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
        <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
        <meta name="bingbot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
        <link rel="canonical" href="https://uficonnect.org" />
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
            <Link to="/login" style={{ padding: '8px 20px', borderRadius: 'var(--radius-sm)', fontSize: '.875rem', fontWeight: '600', color: 'var(--primary)', border: '1.5px solid var(--primary)', background: 'transparent', transition: 'all .15s', textDecoration: 'none' }} onMouseEnter={(e) => e.target.style.background = 'var(--primary-light)'} onMouseLeave={(e) => e.target.style.background = 'transparent'}>
              Sign In
            </Link>
            <Link to="/register" style={{ padding: '8px 20px', borderRadius: 'var(--radius-sm)', fontSize: '.875rem', fontWeight: '600', color: '#fff', background: 'var(--primary)', border: 'none', transition: 'all .15s', textDecoration: 'none' }} onMouseEnter={(e) => e.target.style.background = 'var(--primary-hover)'} onMouseLeave={(e) => e.target.style.background = 'var(--primary)'}>
              Get Started Free
            </Link>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 32px' }}>
        <div style={{ maxWidth: '900px', textAlign: 'center', width: '100%' }}>
          {/* Hero */}
          <h1 style={{ fontSize: '3rem', fontWeight: '900', letterSpacing: '-.4px', marginBottom: '16px', lineHeight: '1.1' }}>
            Professional Networking for Creatives & Tech
          </h1>
          <p style={{ fontSize: '1.2rem', color: 'var(--muted)', marginBottom: '32px', lineHeight: '1.6', maxWidth: '700px', margin: '0 auto 32px' }}>
            A clean, focused platform to discover communities, find opportunities, and grow your network — no ads, no noise, just the people and resources that matter.
          </p>

          {/* CTA buttons */}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginBottom: '60px' }}>
            <Link to="/register" style={{ padding: '12px 32px', borderRadius: 'var(--radius-sm)', fontSize: '1rem', fontWeight: '600', color: '#fff', background: 'var(--primary)', border: 'none', transition: 'all .15s', textDecoration: 'none' }} onMouseEnter={(e) => e.target.style.background = 'var(--primary-hover)'} onMouseLeave={(e) => e.target.style.background = 'var(--primary)'}>
              Get Started Free
            </Link>
            <a href="#features" style={{ padding: '12px 32px', borderRadius: 'var(--radius-sm)', fontSize: '1rem', fontWeight: '600', color: 'var(--primary)', background: 'transparent', border: '1.5px solid var(--primary)', transition: 'all .15s', textDecoration: 'none' }} onMouseEnter={(e) => e.target.style.background = 'var(--primary-light)'} onMouseLeave={(e) => e.target.style.background = 'transparent'}>
              Learn More
            </a>
          </div>

          {/* Features */}
          <div id="features" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '60px' }}>
            <div style={{ background: '#fff', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '12px' }}>🌐</div>
              <h3 style={{ fontSize: '.95rem', fontWeight: '700', marginBottom: '8px' }}>50+ Live Communities</h3>
              <p style={{ fontSize: '.85rem', color: 'var(--muted)', lineHeight: '1.5' }}>Reddit, Discord, LinkedIn, and more — all curated by role and interests.</p>
            </div>
            <div style={{ background: '#fff', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '12px' }}>💼</div>
              <h3 style={{ fontSize: '.95rem', fontWeight: '700', marginBottom: '8px' }}>Real Job Listings</h3>
              <p style={{ fontSize: '.85rem', color: 'var(--muted)', lineHeight: '1.5' }}>Remote jobs, gigs, grants, events, and learning resources tailored to you.</p>
            </div>
            <div style={{ background: '#fff', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '12px' }}>✨</div>
              <h3 style={{ fontSize: '.95rem', fontWeight: '700', marginBottom: '8px' }}>Personalized Feed</h3>
              <p style={{ fontSize: '.85rem', color: 'var(--muted)', lineHeight: '1.5' }}>Posts from Reddit, Hacker News, DEV.to ranked by your interests.</p>
            </div>
          </div>

          {/* Roles grid */}
          <div style={{ marginBottom: '60px' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: '800', marginBottom: '24px' }}>Built for 14+ Professional Roles</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
              {roles.map(role => (
                <div key={role} style={{ background: '#fff', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '.85rem', fontWeight: '500', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
                  {role}
                </div>
              ))}
            </div>
          </div>

          {/* Bottom CTA */}
          <div style={{ background: '#fff', padding: '40px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', border: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '1.3rem', fontWeight: '800', marginBottom: '12px' }}>Ready to join the network?</h3>
            <p style={{ fontSize: '.95rem', color: 'var(--muted)', marginBottom: '24px' }}>Sign up for free in under 2 minutes. No credit card required.</p>
            <Link to="/register" style={{ padding: '12px 32px', borderRadius: 'var(--radius-sm)', fontSize: '1rem', fontWeight: '600', color: '#fff', background: 'var(--primary)', border: 'none', transition: 'all .15s', textDecoration: 'none', display: 'inline-block' }} onMouseEnter={(e) => e.target.style.background = 'var(--primary-hover)'} onMouseLeave={(e) => e.target.style.background = 'var(--primary)'}>
              Get Started Free
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ padding: '32px 32px', borderTop: '1px solid rgba(0,0,0,.05)', background: '#fff', textAlign: 'center', fontSize: '.8rem', color: 'var(--muted)' }}>
        <p>© 2025 UFIConnect. A cleaner way to network and grow.</p>
      </footer>
      </div>
    </>
  );
}
