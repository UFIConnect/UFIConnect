import AppearanceControl from '../components/AppearanceControl';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { TIERS } from '../components/PricingModal';
import { SOURCE_META } from '../components/sourceMeta';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import LegalLinks from '../components/LegalLinks';
import './LandingPricing.css';
import './LandingTrust.css';

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
    a: 'The feed includes UFIConnect member posts and content from available external sources. Source names and original links remain visible. Connections, playback, and actions depend on each provider’s permissions and availability.',
  },
  {
    q: 'Is Resume Builder available?',
    a: 'Yes. Choose $30/month or $149.94 every 6 months. Both options include the same Resume Builder tools.',
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

function PlanCard({ title, price, tagline }) {
  return (
    <div className="landing-plan-card">
      <div className="landing-plan-top">
        <h3>{title}</h3>
      </div>
      <div className="landing-plan-price">
        ${price}<small>/mo</small>
      </div>
      <p>{tagline}</p>
      {title === 'Business' && (
        <div className="landing-plan-alternative">
          <span>One person at the price above</span>
          <strong>Teams: $19.94 per person/month</strong>
          <span>For 2 or more people, including the owner. A workspace for recruiting, candidates, and career sources.</span>
        </div>
      )}
      <Link to="/settings" className="landing-plan-link">View {title} membership</Link>
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
              <img className="landing-identity" src="/uficonnect-wordmark.svg?v=blue-ufi-20261006" width="180" height="36" alt="UFIConnect" />
            </Link>
            <nav className="landing-nav-actions" aria-label="Homepage"><div className="public-theme-control"><AppearanceControl compact /></div>
              <Link to="/global">Global Feed</Link>
              <Link to="/vault-device">Vault device</Link>
              <Link to="/how-it-works">How it works</Link>
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
                  A social and professional workspace for browsing public posts,
                  joining communities, messaging people, and finding jobs.
                  Connect supported accounts when you choose, with each source
                  clearly identified.
                </p>
                <div className="landing-actions">
                  <Link to="/register" className="landing-primary-action">Join free</Link>
                  <Link to="/global" className="landing-secondary-action">Explore the feed</Link>
                </div>
                <p className="landing-trust-intro">Operated as UFIConnect in California, United States. <Link to="/privacy">Privacy policy</Link> · <Link to="/terms">Terms of service</Link> · <a href="mailto:support@uficonnect.org">Contact support</a></p>
              </div>
              <div className="landing-network-art">
                <img src="/homepage-app-network-2026-10.jpg"
                  alt="UFIconnect at the center of a connected network of social, community, and creative apps"
                  width="1206" height="669" fetchPriority="high" />
              </div>
            </div>
          </section>

          <section className="landing-proof-strip" aria-label="UFIconnect at a glance">
            <div className="landing-proof-inner">
              <div><strong>Explore</strong><span>Browse public posts</span></div>
              <div><strong>Connect</strong><span>Choose supported accounts</span></div>
              <div><strong>Work</strong><span>Discover career opportunities</span></div>
              <div><strong>Control</strong><span>Manage your privacy choices</span></div>
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
            <p className="landing-source-disclosure">Source names and marks identify their respective services. UFIConnect is independent and is not endorsed by these providers. A listed source does not promise account access, all content, or every interaction. <Link to="/policies#connected-services">Connected services and attribution</Link></p>
          </section>

          <section className="landing-section landing-trust-section" aria-labelledby="homepage-google-purpose">
            <SectionHeading eyebrow="Purpose and permissions" title="Understand what you connect" />
            <div className="landing-trust-grid">
              <article><h3 id="homepage-google-purpose">How Google services are used</h3><p>Google sign-in can identify your account. An optional YouTube connection supports the YouTube features you authorize, such as subscribed content, channel analytics, or supported actions. Requested permissions are shown before access is granted.</p><p>Google account data is used to provide those features. It is not used to train general-purpose AI models or to target advertising. <Link to="/privacy">Read how data is accessed, stored, shared and deleted</Link>.</p></article>
              <article><h3>Safety is part of using UFIConnect</h3><p>Non-consensual intimate imagery, including AI-generated content, is prohibited. UFIConnect does not use Google APIs to create or enable AI-generated non-consensual intimate imagery.</p><p>Report a post through its menu or use our <Link to="/copyright">copyright reporting process</Link>. <Link to="/policies#community">Community guidelines</Link> also cover harassment, exploitation, impersonation and other abuse.</p></article>
              <article><h3>Your privacy choices</h3><p>Optional analytics and homepage ad measurement have separate consent controls. You can review or withdraw consent, disconnect supported accounts, and request access to or deletion of your information.</p><p><Link to="/#analytics">Cookie and tracking choices</Link> · <Link to="/policies#retention">Retention and deletion</Link> · <Link to="/policies">All policies</Link></p></article>
            </div>
          </section>

          <section className="landing-section landing-explainers" aria-label="Explore UFIConnect products">
            <article><span className="landing-eyebrow">Vault device</span><h2>A closer look at the device concept</h2><p>See how the proposed hardware relates to the available browser Vault, and which features are still in development.</p><Link to="/vault-device" className="landing-secondary-action">Explore the Vault device</Link></article>
            <article><span className="landing-eyebrow">Your feeds, explained</span><h2>See how UFIConnect works</h2><p>Explore the mixed feed, focus on individual sources and keep up with the accounts you follow. See how it all connects.</p><Link to="/how-it-works" className="landing-secondary-action">Explore the feed diagram</Link></article>
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
            <SectionHeading eyebrow="Plans" title="Choose your membership.">
              Explore Pro and Business, or add Resume Builder to your account.
            </SectionHeading>
            <div className="landing-plan-grid">
              {TIERS.map(t => (
                <PlanCard
                  key={t.tier}
                  title={t.name}
                  price={t.price}
                  tagline={t.tagline}
                />
              ))}
              <div className="landing-plan-card landing-resume-live">
                <div className="landing-plan-top">
                  <h3>Resume Builder</h3>
                </div>
                <div className="landing-plan-price">$30<small>/mo</small></div>
                <p>Draft, polish, export, and save an ATS-scored resume to your profile.</p>
                <div className="landing-plan-alternative">
                  <strong>Or $149.94 every 6 months</strong>
                  <span>The same tools, with your choice of billing interval.</span>
                </div>
                <Link to="/resume-builder" className="landing-plan-link">Open Resume Builder</Link>
              </div>
            </div>
            <p className="landing-pricing-terms">Prices are in USD. Paid memberships and add-ons renew automatically. Review any applicable tax and your total at checkout. Manage or cancel in Settings.</p>
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
          <LegalLinks />
        </footer>
      </div>
    </>
  );
}
