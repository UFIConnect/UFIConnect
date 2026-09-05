import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { TIERS } from '../components/PricingModal';
import { SOURCE_META } from '../components/sourceMeta';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';

const SOURCES = [
  'reddit', 'youtube', 'github', 'hackernews', 'linkedin', 'instagram', 'facebook',
  'indeed', 'remoteok', 'remotive', 'muse', 'usajobs', 'stackoverflow',
  'devto', 'medium', 'producthunt',
];

const FEATURES = [
  {
    label: 'Feed',
    title: 'A live feed with range',
    desc: 'Follow real conversations, videos, member posts, jobs, and source updates without one platform crowding out the rest.',
  },
  {
    label: 'People',
    title: 'Find people by what they do',
    desc: 'Search by role, interests, skills, and communities so the network feels useful from the first session.',
  },
  {
    label: 'Work',
    title: 'Opportunities beside the feed',
    desc: 'Browse jobs, gigs, grants, events, and learning resources without leaving the scroll.',
  },
  {
    label: 'Center',
    title: 'Command Center for your tools',
    desc: 'Keep connected accounts, AI drafts, cross-post history, tracked jobs, and your live You Feed in one place.',
  },
];

const STEPS = [
  ['Join or browse', 'Create a free account for personalization, or use Global Feed to look around first.'],
  ['Pick your direction', 'Choose the role and interests that shape your feed, communities, and opportunities.'],
  ['Start from the feed', 'Read, follow, post, save jobs, and return to a network that keeps updating.'],
];

const FAQS = [
  {
    q: 'Is UFIconnect free?',
    a: 'Yes. The core feed, profile, communities, messaging, and opportunities are free to start.',
  },
  {
    q: 'Can I browse without creating an account?',
    a: 'Yes. Global Feed is available from the homepage with the skip sign-up button.',
  },
  {
    q: 'Where does the feed content come from?',
    a: 'UFIconnect combines member posts with live posts from public sources and connected accounts, then balances the mix by source.',
  },
  {
    q: 'Is Resume Builder available?',
    a: 'Yes. Resume Builder is available as a paid add-on for $149.94 every six months.',
  },
];

const SHARE_URL = 'https://uficonnect.org';
const SHARE_TEXT = 'UFIconnect brings people, posts, communities, messaging, videos, and job discovery into one social network.';
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

function SectionHeading({ eyebrow, title, children }) {
  return (
    <div className="landing-section-heading">
      <div className="landing-eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

function PlanCard({ title, price, tagline, locked }) {
  return (
    <div className={`landing-plan-card${locked ? ' is-muted' : ''}`}>
      <div className="landing-plan-top">
        <h3>{title}</h3>
        {locked && <span>Coming soon</span>}
      </div>
      <div className="landing-plan-price">
        ${price}<small>/mo</small>
      </div>
      <p>{tagline}</p>
    </div>
  );
}

function SourceChip({ source }) {
  const meta = SOURCE_META[source] || { label: source, color: 'var(--primary)', icon: source };
  return (
    <span>
      {hasBrandIcon(source) ? (
        <span className="landing-source-mark">
          <BrandIcon platform={source} size={14} />
        </span>
      ) : (
        <span className="landing-source-fallback" style={{ color: meta.color }}>
          {String(meta.icon || source).slice(0, 3).toUpperCase()}
        </span>
      )}
      {meta.label}
    </span>
  );
}

export default function Landing() {
  const [shareCopied, setShareCopied] = useState(false);

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
        <title>UFIconnect | Social Network &amp; Job Discovery</title>
        <meta name="description" content="UFIconnect is a social network for connecting, posting, messaging, joining communities, watching videos, and finding jobs in one personalized experience." />
        <meta name="keywords" content="social network, personalized feed, communities, messaging, job search, opportunities, videos, UFIconnect" />
        <meta name="author" content="UFIconnect" />
        <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
        <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
        <meta name="bingbot" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
        <link rel="canonical" href="https://uficonnect.org" />
      </Helmet>

      <div className="landing-shell">
        <header className="landing-header landing-header-refined">
          <div className="landing-header-inner">
            <Link to="/" className="landing-brand" aria-label="UFIconnect home">
              <span className="landing-brand-mark">UFI</span>
              <span className="landing-logo-text">UFIconnect</span>
            </Link>
            <nav className="landing-nav-actions" aria-label="Homepage">
              <Link to="/global">Global Feed</Link>
              <Link to="/login">Sign in</Link>
              <Link to="/register" className="landing-nav-primary">Join free</Link>
            </nav>
          </div>
        </header>

        <main>
          <section className="landing-hero-refined">
            <div className="landing-hero-inner">
              <div className="landing-hero-copy">
                <div className="landing-eyebrow">Official home</div>
                <h1>UFIconnect</h1>
                <p>
                  A social network for people, posts, communities, messaging, videos,
                  and finding your next job in one personalized scroll.
                </p>
                <div className="landing-actions">
                  <Link to="/register" className="landing-primary-action">Join free</Link>
                  <Link to="/global" className="landing-secondary-action">Skip sign up - Global Feed</Link>
                </div>
              </div>
            </div>
          </section>

          <section className="landing-proof-strip" aria-label="UFIconnect at a glance">
            <div className="landing-proof-inner">
              <div><strong>80+</strong><span>communities</span></div>
              <div><strong>500+</strong><span>roles supported</span></div>
              <div><strong>30+</strong><span>live sources</span></div>
              <div><strong>0</strong><span>ads in the feed</span></div>
            </div>
          </section>

          <section className="landing-section landing-product-section">
            <SectionHeading eyebrow="Inside" title="Built around the feed, not a pitch deck">
              The first thing people see should feel like the place they are about to use.
            </SectionHeading>
            <div className="landing-product-grid">
              <div className="landing-product-shot">
                <img src="/homepage-feed-2026-09.png" alt="UFIconnect home feed with favorite sources and account tools" width="1440" height="1000" loading="lazy" />
              </div>
              <div className="landing-product-copy">
                {FEATURES.map(({ label, title, desc }) => (
                  <div key={title} className="landing-feature-row">
                    <span>{label}</span>
                    <div>
                      <h3>{title}</h3>
                      <p>{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="landing-section landing-sources-section">
            <SectionHeading eyebrow="Live Sources" title="A feed that keeps moving">
              Public sources, connected accounts, and UFIconnect posts are balanced into one scrolling experience.
            </SectionHeading>
            <div className="landing-source-row">
              {SOURCES.map(source => <SourceChip key={source} source={source} />)}
            </div>
          </section>

          <section className="landing-section landing-start-section">
            <SectionHeading eyebrow="Start" title="A welcoming path in">
              Browse first, or create an account and let UFIconnect shape itself around what you like to read.
            </SectionHeading>
            <div className="landing-step-grid">
              {STEPS.map(([title, desc], index) => (
                <div key={title} className="landing-step-card">
                  <span>{index + 1}</span>
                  <h3>{title}</h3>
                  <p>{desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section id="pricing" className="landing-section landing-pricing-section">
            <SectionHeading eyebrow="Plans" title="Free to begin, clear when you upgrade">
              The main feed stays free. Resume Builder is available now, and Business is coming soon.
            </SectionHeading>
            <div className="landing-plan-grid">
              <div className="landing-plan-card">
                <div className="landing-plan-top">
                  <h3>Free</h3>
                </div>
                <div className="landing-plan-price">$0<small>/mo</small></div>
                <p>Feed, communities, messaging, posting, and opportunities.</p>
              </div>
              {TIERS.map(t => (
                <PlanCard
                  key={t.tier}
                  title={t.name}
                  price={t.price}
                  tagline={t.tagline}
                  locked={t.locked}
                />
              ))}
              <div className="landing-plan-card landing-resume-live">
                <div className="landing-plan-top">
                  <h3>Resume Builder</h3>
                </div>
                <div className="landing-plan-price">$149.94<small>/6 months</small></div>
                <p>Draft, polish, export, and save an ATS-scored resume to your profile.</p>
                <Link to="/resume-builder" className="landing-plan-link">Open Resume Builder</Link>
              </div>
            </div>
          </section>

          <section className="landing-section landing-share-section">
            <div className="landing-share-copy">
              <SectionHeading eyebrow="Invite" title="Bring your people in">
                UFIconnect is better when the people you learn from, work with, and build beside are here too.
              </SectionHeading>
            </div>
            <div className="landing-share-actions">
              <button type="button" onClick={handleShare}>{shareCopied ? 'Link copied' : 'Copy share link'}</button>
              {SHARE_LINKS.map(({ label, href }) => (
                <a
                  key={label}
                  href={href}
                  target={label === 'Email' ? undefined : '_blank'}
                  rel={label === 'Email' ? undefined : 'noreferrer'}
                >
                  {label}
                </a>
              ))}
            </div>
          </section>

          <section id="faq" className="landing-section landing-faq-section">
            <SectionHeading eyebrow="Questions" title="Good to know" />
            <div className="landing-faq-list">
              {FAQS.map(({ q, a }) => (
                <div key={q} className="landing-faq-item">
                  <h3>{q}</h3>
                  <p>{a}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="landing-final-cta">
            <h2>Welcome to UFIconnect.</h2>
            <p>Start with the live Global Feed, or join free and make the network yours.</p>
            <div className="landing-actions">
              <Link to="/register" className="landing-primary-action">Join free</Link>
              <Link to="/global" className="landing-secondary-action">Open Global Feed</Link>
            </div>
          </section>
        </main>

        <footer className="landing-footer">
          <p>&copy; {new Date().getFullYear()} UFIconnect</p>
          <p>
            <Link to="/terms">Terms</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/child-safety">Child Safety</Link>
            <a href="mailto:support@uficonnect.org">support@uficonnect.org</a>
          </p>
        </footer>
      </div>
    </>
  );
}
