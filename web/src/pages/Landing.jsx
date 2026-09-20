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
    title: 'More of what moves you',
    desc: 'Fresh perspectives, worthwhile conversations, and videos worth your time. Discover a mix shaped by your interests.',
  },
  {
    label: 'People',
    title: 'Find your kind of people',
    desc: 'Meet people who share your interests, exchange ideas, and make connections that go beyond a follow.',
  },
  {
    label: 'Work',
    title: 'Make room for your next move',
    desc: 'Explore jobs, gigs, and learning opportunities that connect what you enjoy with where you want to go.',
  },
  {
    label: 'Center',
    title: 'Turn your ideas into something',
    desc: 'Bring your drafts, creative tools, connected accounts, and job search together in Command Center.',
  },
];

const STEPS = [
  ['Come as you are', 'Explore the public feed or join free to make room for your own interests.'],
  ['Make it yours', 'Choose what matters to you, from the topics you love to the work you want to do.'],
  ['See where it takes you', 'Join a conversation, find a community, or discover your next opportunity.'],
];

const FAQS = [
  {
    q: 'Is UFIconnect free?',
    a: 'Yes. The core feed, profile, communities, messaging, and opportunities are free to start.',
  },
  {
    q: 'Can I browse without creating an account?',
    a: 'Yes. Choose Explore the feed to browse public posts before creating an account.',
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
const SHARE_TEXT = 'Find your people and your next opportunity on UFIconnect. A social network for the things you enjoy and the places you want to go.';
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
        <meta name="description" content="Find your people and your next opportunity on UFIconnect. Discover fresh conversations, join communities, and explore jobs in a social network shaped by your interests." />
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
                <div className="landing-eyebrow">Your world, connected</div>
                <h1>UFIconnect</h1>
                <p>
                  Your interests. Your communities. Your people.
                  Discover conversations across your favorite apps and bring
                  your world together in one social network.
                </p>
                <div className="landing-actions">
                  <Link to="/register" className="landing-primary-action">Join free</Link>
                  <Link to="/global" className="landing-secondary-action">Explore the feed</Link>
                </div>
              </div>
              <div className="landing-network-art">
                <img src="/homepage-app-network-2026-09.jpg"
                  alt="UFIconnect at the center of a connected network of social, community, and creative apps"
                  width="1536" height="1024" fetchPriority="high" />
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
            <SectionHeading eyebrow="Discover" title="Good conversations. New possibilities.">
              Stay curious, meet people, and make your next move. There is more than one reason to connect.
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
            <SectionHeading eyebrow="Discover more" title="Different perspectives, one place">
              Go beyond a single source. Explore the conversations and ideas that make your world bigger.
            </SectionHeading>
            <div className="landing-source-row">
              {SOURCES.map(source => <SourceChip key={source} source={source} />)}
            </div>
          </section>

          <section className="landing-section landing-start-section">
            <SectionHeading eyebrow="Get started" title="Your next connection starts here">
              Start with a little curiosity. Build a feed around the people, interests, and possibilities that matter to you.
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
            <SectionHeading eyebrow="Plans" title="Start free. Grow from there.">
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
            <h2>Your people. Your possibilities.</h2>
            <p>A new conversation could be the start of something. Join UFIconnect free.</p>
            <div className="landing-actions">
              <Link to="/register" className="landing-primary-action">Join free</Link>
              <Link to="/global" className="landing-secondary-action">Explore the feed</Link>
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
