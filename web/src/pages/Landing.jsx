import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

const ROLE_PREFIXES = [
  'Senior', 'Lead', 'Head', 'Principal', 'Chief', 'Global', 'Regional', 'Director', 'Manager', 'Specialist', 'Coordinator',
  'Analyst', 'Advisor', 'Consultant', 'Strategist', 'Architect', 'Engineer', 'Developer', 'Scientist', 'Supervisor', 'Producer',
  'Officer', 'Editor', 'Writer', 'Researcher', 'Curator', 'Facilitator', 'Coach', 'Trainer', 'Associate', 'Executive', 'Partner'
];

const ROLE_FOCUS = [
  'Marketing', 'Growth', 'Operations', 'Finance', 'People Ops', 'Human Resources', 'Product', 'Community', 'Brand', 'Content',
  'Design', 'Creative', 'Strategy', 'Education', 'Learning', 'Health', 'Wellness', 'Legal', 'Compliance', 'Sustainability',
  'Customer Experience', 'Support', 'Success', 'Fulfillment', 'Supply Chain', 'Data', 'AI', 'Analytics', 'Security', 'Risk',
  'Quality', 'Engineering', 'Development', 'Software', 'Platform', 'Infrastructure', 'Cloud', 'DevOps', 'Systems', 'Mobile',
  'Frontend', 'Backend', 'Motion', 'Video', 'Social Media', 'Public Relations', 'Events', 'Corporate Communications',
  'Investor Relations', 'Partnerships', 'Business Development', 'Sales Enablement', 'E-commerce', 'Retail', 'Hospitality',
  'Real Estate', 'Manufacturing', 'Logistics', 'Media', 'Publishing', 'Writing', 'Podcasting', 'Healthcare', 'Biotech',
  'Food', 'AgTech', 'Energy', 'Climate', 'FinTech', 'Crypto', 'LegalTech', 'Sports', 'Entertainment', 'Gaming', 'Travel',
  'Tourism', 'Nonprofit', 'Philanthropy', 'Diversity & Inclusion', 'Equity', 'Government Affairs', 'Policy', 'Research',
  'Product Marketing', 'Audience Development', 'User Experience', 'Customer Success', 'Change Management', 'Performance',
  'Corporate Strategy', 'Investor Success', 'Brand Experience', 'Creative Operations', 'Employee Experience'
];

const roles = Array.from(new Set([
  'Engineer', 'Designer', 'Product Manager', 'Founder', 'Marketer', 'Sales Leader', 'Operations Lead', 'HR Leader',
  'Investor', 'Researcher', 'Educator', 'Consultant', 'Creative Director', 'Community Manager', 'Finance Lead', 'Legal Advisor',
  'Healthcare Leader', 'Small Business Owner',
  ...ROLE_PREFIXES.flatMap((prefix) => ROLE_FOCUS.map((focus) => `${prefix} ${focus}`)),
  ...['Senior', 'Lead', 'Head', 'Chief', 'Director', 'Principal', 'Global', 'Regional'].flatMap((prefix) => ['Program', 'Portfolio', 'Campaign', 'Product', 'Operations', 'Growth', 'Customer', 'Partnerships'].map((focus) => `${prefix} ${focus}`)),
])).sort((a, b) => a.localeCompare(b));

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
            Professional networking for all ambitious talent
          </h1>
          <p style={{ fontSize: '1.2rem', color: 'var(--muted)', marginBottom: '32px', lineHeight: '1.6', maxWidth: '700px', margin: '0 auto 32px' }}>
            A clean, focused platform to discover communities, projects, jobs, and learning paths — no ads, no noise, just the people and ideas that help your career thrive.
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
              <p style={{ fontSize: '.85rem', color: 'var(--muted)', lineHeight: '1.5' }}>Business, creative, education, and industry communities curated around your role and goals.</p>
            </div>
            <div style={{ background: '#fff', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '12px' }}>💼</div>
              <h3 style={{ fontSize: '.95rem', fontWeight: '700', marginBottom: '8px' }}>Real Opportunities</h3>
              <p style={{ fontSize: '.85rem', color: 'var(--muted)', lineHeight: '1.5' }}>Jobs, gigs, grants, events, and learning resources across creative, corporate, and startup paths.</p>
            </div>
            <div style={{ background: '#fff', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '12px' }}>⚡</div>
              <h3 style={{ fontSize: '.95rem', fontWeight: '700', marginBottom: '8px' }}>Quick profile macros</h3>
              <p style={{ fontSize: '.85rem', color: 'var(--muted)', lineHeight: '1.5' }}>Launch faster with pre-built role headlines and polished professional copy that fit your experience.</p>
            </div>
            <div style={{ background: '#fff', padding: '24px', borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '1.8rem', marginBottom: '12px' }}>✨</div>
              <h3 style={{ fontSize: '.95rem', fontWeight: '700', marginBottom: '8px' }}>Media review & previews</h3>
              <p style={{ fontSize: '.85rem', color: 'var(--muted)', lineHeight: '1.5' }}>See instant visual previews for articles, videos, and community posts so you can review what matters faster.</p>
            </div>
          </div>

          {/* YAML sample block */}
          <div style={{ marginBottom: '60px' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: '800', marginBottom: '18px' }}>Macro-ready profile templates</h2>
            <p style={{ fontSize: '.95rem', color: 'var(--muted)', marginBottom: '18px', maxWidth: '700px', margin: '0 auto 18px' }}>
              Build a polished profile in seconds with copy-ready YAML templates for roles, focus areas, and key strengths.
            </p>
            <pre style={{ margin: 0, padding: '24px', borderRadius: '18px', background: '#0F172A', color: '#E2E8F0', fontSize: '.9rem', lineHeight: '1.6', overflowX: 'auto', border: '1px solid rgba(226, 232, 240, 0.15)' }}>
{`profile:
  name: "Amina Davis"
  role: "Senior Community Growth Lead"
  focus: "Bridges brand, learning, and partner ecosystems"
  location: "Hybrid"

highlights:
  - "Ad-free professional network"
  - "Instant media review previews"
  - "500+ tailored role templates"

tags:
  - "Creative Operations"
  - "Education"
  - "Media & Publishing"`}
            </pre>
          </div>

          {/* Roles grid */}
          <div style={{ marginBottom: '60px' }}>
            <h2 style={{ fontSize: '1.3rem', fontWeight: '800', marginBottom: '24px' }}>Built for 500+ Professional Roles</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', maxHeight: '520px', overflow: 'auto', paddingRight: '6px' }}>
              {roles.map(role => (
                <div key={role} style={{ background: '#fff', padding: '12px 16px', borderRadius: 'var(--radius-sm)', fontSize: '.82rem', fontWeight: '500', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
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
