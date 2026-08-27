import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

const FEATURES = [
  {
    icon: '🎯',
    title: 'Personalized from day one',
    desc: 'Select what you do and your experience level during signup. Your feed, communities, and opportunities are customized automatically — no extra setup required.',
  },
  {
    icon: '🌐',
    title: '80+ Communities for Every Path',
    desc: 'Communities spanning engineering, design, music, sports, food, startups, healthcare, and more — organized around whatever you\'re actually into.',
  },
  {
    icon: '💼',
    title: 'Curated Opportunities',
    desc: 'Discover jobs, gigs, grants, events, hackathons, and learning resources across corporate, independent, and creative paths — all filtered to match what you\'re looking for.',
  },
  {
    icon: '🔍',
    title: 'Find Your People',
    desc: 'Search and connect with people by name, role, skill, or interest. Follow the people doing work you actually care about, no matter the field.',
  },
  {
    icon: '📰',
    title: 'Content Feed',
    desc: 'Aggregates posts from LinkedIn, GitHub, Reddit, Twitter, and other platforms — with balanced distribution across sources.',
  },
  {
    icon: '✏️',
    title: 'Community Publishing',
    desc: 'Share what you know, ask questions, and showcase your work within UFIconnect communities. Engage directly with people who get it.',
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

// Same labels/colors/icons used for source badges in the live feed (Feed.jsx SOURCE_META) —
// a curated, recognizable subset of the 30+ sources actually aggregated, kept consistent
// with the "14+ Content Sources Aggregated" stat below.
const CONTENT_PLATFORMS = [
  { icon: '🔵', label: 'Facebook',        color: '#1877F2' },
  { icon: '🏛️', label: 'USAJobs',         color: '#005EA8' },
  { icon: '𝕏',  label: 'X (Twitter)',     color: '#000000' },
  { icon: '💼', label: 'Indeed',          color: '#2557A7' },
  { icon: '🟠', label: 'Reddit',          color: '#FF4500' },
  { icon: '▶️', label: 'YouTube',         color: '#FF0000' },
  { icon: '🐙', label: 'GitHub',          color: '#24292F' },
  { icon: '🗞', label: 'Hacker News',     color: '#FF6600' },
  { icon: '📚', label: 'Stack Overflow',  color: '#F48024' },
  { icon: 'GL', label: 'GitLab',          color: '#FC6D26' },
  { icon: '👩‍💻', label: 'DEV Community', color: '#3B49DF' },
  { icon: '📝', label: 'Medium',          color: '#1A8917' },
  { icon: '🚀', label: 'Product Hunt',    color: '#DA552F' },
  { icon: '📰', label: 'TechCrunch',      color: '#0D9F3F' },
  { icon: '⬛', label: 'The Verge',       color: '#FF3333' },
  { icon: 'YC', label: 'Y Combinator',    color: '#FF6600' },
];

const SHARE_URL = 'https://uficonnect.org';
const SHARE_TEXT = 'UFIconnect is a personalized network featuring content feeds, communities, secure messaging, and curated opportunities built around whatever you do.';
const SHARE_LINKS = [
  {
    label: 'Share on X',
    href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(SHARE_TEXT)}&url=${encodeURIComponent(SHARE_URL)}`,
  },
  {
    label: 'Share on LinkedIn',
    href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SHARE_URL)}`,
  },
  {
    label: 'Email',
    href: `mailto:?subject=${encodeURIComponent('Join me on UFIconnect')}&body=${encodeURIComponent(`${SHARE_TEXT}\n\n${SHARE_URL}`)}`,
  },
];

export default function Landing() {
  const [shareCopied, setShareCopied] = useState(false);

  function continueAsGuest() {
    window.location.href = '/global';
  }

  async function handleShare() {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'UFIconnect', text: SHARE_TEXT, url: SHARE_URL });
        return;
      }
      await navigator.clipboard.writeText(SHARE_URL);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1800);
    } catch {
      setShareCopied(false);
    }
  }

  return (
    <>
      <Helmet>
        <title>UFIconnect - Official Home</title>
        <meta name="description" content="UFIconnect is a personalized network offering feeds, communities, messaging, and opportunities tailored to whatever you do — tech, creative, business, or anything else." />
        <meta name="keywords" content="professional network, connect with professionals, networking platform, news feed, career networking, tech community, engineers, designers, founders, creatives, job listings, remote jobs, professional communities, networking app, LinkedIn alternative, Facebook Groups alternative, Twitter communities, career opportunities, tech careers, startup community, developer network, UX design community, product managers, marketing professionals, business networking, online communities, professional connections, industry news, career development, business connections, professional growth, networking solutions, community platform, tech professionals, talent network, ufi connect, connect professionals, networking news, professional news, interest based communities, hobby communities, creator community, social network for everyone, community app for any interest, personalized social feed" />
        <meta name="author" content="UFIconnect" />
        <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
        <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
        <meta name="bingbot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
        <link rel="canonical" href="https://uficonnect.org" />
      </Helmet>

      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #EFF6FF 0%, #F3EEFF 100%)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <header className="landing-header" style={{ padding: '20px 32px', borderBottom: '1px solid rgba(0,0,0,.05)', background: '#fff', boxShadow: 'var(--shadow)' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '40px', height: '40px', background: 'var(--primary)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: '900', fontSize: '1.1rem' }}>
                UF
              </div>
              <span className="landing-logo-text" style={{ fontWeight: '900', fontSize: '1.2rem' }}>UFIconnect</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Link to="/login" className="btn btn-outline">
                Sign In
              </Link>
              <Link to="/register" className="btn btn-primary landing-nav-join">
                Get Started
              </Link>
            </div>
          </div>
        </header>

        <main style={{ flex: 1 }}>
          {/* Hero */}
          <section style={{ maxWidth: '1180px', margin: '0 auto', padding: '72px 32px 60px' }}>
            <div className="landing-hero-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 460px', gap: 48, alignItems: 'center' }}>
              <div style={{ textAlign: 'left' }}>
                <div style={{ display: 'inline-block', padding: '6px 16px', borderRadius: 20, background: 'var(--primary-light)', color: 'var(--primary)', fontSize: '.82rem', fontWeight: 700, marginBottom: 20, border: '1px solid var(--primary)' }}>
                  Official UFIconnect home
                </div>
                <h1 style={{ fontSize: 'clamp(2rem, 4.4vw, 3rem)', fontWeight: '900', letterSpacing: '-.4px', marginBottom: '20px', lineHeight: '1.1' }}>
                  UFIconnect
                </h1>
                <p style={{ fontSize: '1.1rem', color: 'var(--muted)', marginBottom: '36px', lineHeight: '1.7', maxWidth: '520px' }}>
                  A personalized feed, communities, messaging, and real opportunities — tailored to your role, whatever that is.
                </p>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
                  <Link to="/register" className="btn btn-primary btn-lg" style={{ padding: '13px 36px', fontWeight: 700 }}>
                    Get Started Free →
                  </Link>
                  <Link to="/global" className="btn btn-outline btn-lg" style={{ padding: '13px 36px' }}>
                    Skip sign up - Global Feed →
                  </Link>
                </div>
                <button
                  type="button"
                  onClick={continueAsGuest}
                  style={{
                    all: 'unset', cursor: 'pointer', fontSize: '.85rem', fontWeight: 600,
                    color: 'var(--muted)', textDecoration: 'underline', marginBottom: '44px', display: 'inline-block',
                  }}
                >
                  Skip sign up and open Global Feed →
                </button>

                {/* Role pills preview — a deliberately mixed slice (not just
                    the first 8 in ROLE_PREVIEWS, which skews tech/business)
                    so the hero itself proves "whatever you do" instead of
                    just claiming it. */}
                <div style={{ marginBottom: 0 }}>
                  <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: 14, fontWeight: 500 }}>
                    Built for every background — not just the office
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {['Engineer', 'Designer', 'Musician', 'Healthcare', 'Founder', 'Chef', 'Creator', 'Athlete']
                      .map(label => ROLE_PREVIEWS.find(r => r.label === label))
                      .map(({ icon, label, color }) => (
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
              </div>

              {/* Real product screenshots — a groups-page shot peeking behind the
                  primary feed shot, both in a plain phone-frame treatment. This
                  used to be the one thing the whole page never actually did:
                  every section described the product in words (feature cards,
                  role pills, platform badges) without ever showing what it
                  looks like, so there was nothing here to visually back up
                  what the copy — or the Play Store listing, built from these
                  same screenshots — promises. */}
              <div className="landing-hero-art" style={{ position: 'relative', height: 460, justifySelf: 'center' }}>
                {/* Was a plain rounded-rect border — reads as a generic
                    rounded card, not specifically a phone. A notch/dynamic-
                    island cutout at the top and a home-indicator bar at the
                    bottom are the two details that actually read as "this is
                    a phone" at a glance, without needing new screenshots —
                    same trick real device-mockup generators use. */}
                <div className="landing-hero-shot landing-hero-shot-back" style={{
                  position: 'absolute', top: 30, left: -10, width: 240,
                  transform: 'rotate(-9deg)', borderRadius: 30, overflow: 'hidden',
                  border: '7px solid #0F172A', boxShadow: '0 30px 60px -20px rgba(15,23,42,.35)',
                  background: '#0F172A',
                }}>
                  <img src="/hero-groups-screenshot.png" alt="" aria-hidden="true" style={{ display: 'block', width: '100%' }} />
                  <div style={{
                    position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                    width: '34%', height: 16, background: '#0F172A', borderRadius: '0 0 12px 12px',
                  }} />
                  <div style={{
                    position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)',
                    width: '32%', height: 4, borderRadius: 3, background: 'rgba(255,255,255,.55)',
                  }} />
                </div>
                <div className="landing-hero-shot landing-hero-shot-front" style={{
                  position: 'absolute', top: 0, right: 0, width: 260,
                  transform: 'rotate(6deg)', borderRadius: 32, overflow: 'hidden',
                  border: '8px solid #0F172A', boxShadow: '0 34px 70px -16px rgba(15,23,42,.4)',
                  background: '#0F172A',
                }}>
                  <img src="/hero-feed-screenshot.png" alt="UFIconnect's personalized feed, showing real posts pulled from GitHub" style={{ display: 'block', width: '100%' }} />
                  <div style={{
                    position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
                    width: '36%', height: 18, background: '#0F172A', borderRadius: '0 0 14px 14px',
                  }} />
                  <div style={{
                    position: 'absolute', bottom: 7, left: '50%', transform: 'translateX(-50%)',
                    width: '34%', height: 4, borderRadius: 3, background: 'rgba(255,255,255,.55)',
                  }} />
                </div>
              </div>
            </div>

            {/* Content platforms preview */}
            <div style={{ marginTop: 56, textAlign: 'center' }}>
              <div style={{ fontSize: '.8rem', color: 'var(--muted)', marginBottom: 14, fontWeight: 500 }}>
                Content aggregated from the platforms you already use
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {CONTENT_PLATFORMS.map(({ icon, label, color }) => (
                  <span key={label} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 14px', borderRadius: 20, background: '#fff',
                    border: `1.5px solid ${color}40`, color, fontWeight: 600, fontSize: '.8rem',
                    boxShadow: 'var(--shadow)',
                  }}>
                    <span aria-hidden="true">{icon}</span> {label}
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
                Key features
              </h2>
              <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: '.95rem', marginBottom: '44px', maxWidth: 600, margin: '0 auto 44px' }}>
                UFIconnect combines your feed, network, and opportunities in one platform — tailored to your role and interests, whatever they are.
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
                  { stat: '80+', label: 'Communities' },
                  { stat: '500+', label: 'Roles Supported' },
                  { stat: '14+', label: 'Content Sources Aggregated' },
                  { stat: '100%', label: 'Advertisement-Free' },
                ].map(({ stat, label }) => (
                  <div key={label}>
                    <div style={{ fontSize: '2rem', fontWeight: 900, marginBottom: 4 }}>{stat}</div>
                    <div style={{ fontSize: '.85rem', opacity: .85 }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Share strip */}
          <section style={{ background: '#0F172A', color: '#fff', padding: '48px 32px', borderTop: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 28, alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '.78rem', fontWeight: 800, letterSpacing: 0, textTransform: 'uppercase', color: '#93C5FD', marginBottom: 10 }}>
                  Share UFIconnect
                </div>
                <h2 style={{ fontSize: '1.55rem', fontWeight: 900, marginBottom: 10, lineHeight: 1.2 }}>
                  Invite people to join the platform.
                </h2>
                <p style={{ color: '#CBD5E1', fontSize: '.95rem', lineHeight: 1.65, margin: 0, maxWidth: 650 }}>
                  Share UFIconnect with people in your life who'd get value from a feed and community built around what they actually do.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-start' }}>
                <button
                  type="button"
                  onClick={handleShare}
                  style={{ padding: '11px 18px', borderRadius: 'var(--radius-sm)', border: '1px solid #93C5FD', background: '#2563EB', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
                >
                  {shareCopied ? 'Link copied' : 'Copy share link'}
                </button>
                {SHARE_LINKS.map(({ label, href }) => (
                  <a
                    key={label}
                    href={href}
                    target={label === 'Email' ? undefined : '_blank'}
                    rel={label === 'Email' ? undefined : 'noreferrer'}
                    style={{ padding: '11px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,.22)', color: '#fff', textDecoration: 'none', fontSize: '.9rem', fontWeight: 700, background: 'rgba(255,255,255,.08)' }}
                  >
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </section>

          {/* How it works */}
          <section style={{ padding: '70px 32px', background: 'linear-gradient(135deg, #EFF6FF 0%, #F3EEFF 100%)' }}>
            <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
              <h2 style={{ fontSize: '1.5rem', fontWeight: '800', marginBottom: '44px' }}>Get started in three steps</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '24px', marginBottom: '44px' }}>
                {[
                  { step: '1', icon: '🎯', title: 'Select what you do', desc: 'Choose from 16+ paths — tech, creative, business, and beyond. Get a bio template and interests matched to it instantly.' },
                  { step: '2', icon: '🎨', title: 'Customize your feed preferences', desc: 'Define your interests and goals through our guided setup experience, tailored to whatever you picked.' },
                  { step: '3', icon: '🚀', title: 'Start connecting', desc: 'Your personalized feed is ready immediately. Connect with the right people, explore communities, and discover opportunities.' },
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
              <h3 style={{ fontSize: '1.5rem', fontWeight: '800', marginBottom: '14px' }}>Get started</h3>
              <p style={{ fontSize: '.95rem', color: 'var(--muted)', marginBottom: '28px', lineHeight: 1.6 }}>
                Sign up free. Pick what you do, set your preferences, and start connecting with people who get it.
              </p>
              <Link to="/register" className="btn btn-primary btn-lg" style={{ padding: '14px 40px', fontWeight: 700 }}>
                Get Started Free →
              </Link>
            </div>
          </section>
        </main>

        {/* Footer */}
        <footer style={{ padding: '28px 32px', borderTop: '1px solid rgba(0,0,0,.05)', background: '#fff', textAlign: 'center', fontSize: '.8rem', color: 'var(--muted)' }}>
          <p style={{ marginBottom: 8 }}>© {new Date().getFullYear()} UFIconnect</p>
          <p>
            <Link to="/privacy" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>Privacy Policy</Link>
            {' · '}
            <Link to="/child-safety" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>Child Safety Standards</Link>
            {' · '}
            <a href="mailto:support@uficonnect.org" style={{ color: 'var(--muted)', textDecoration: 'underline' }}>support@uficonnect.org</a>
          </p>
        </footer>
      </div>
    </>
  );
}
