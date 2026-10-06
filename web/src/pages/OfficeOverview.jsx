import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowRight, Layers, ListFilter, Users, ExternalLink, Play, Briefcase } from 'lucide-react';
import PublicOverviewLayout from './PublicOverviewLayout';

const VIEWS = [
  { name: 'Mixed feed', icon: Layers, title: 'Different sources. One feed.', description: 'Browse posts from several available sources together. Your interests help shape your home feed, and source and topic filters let you adjust what you see.', sources: ['Community posts', 'Videos', 'Articles'], cards: ['A conversation from a community', 'A video from a creator', 'An article from another source'] },
  { name: 'Source feeds', icon: ListFilter, title: 'Focus on one source.', description: 'Choose a source in the feed filters to see its available posts. Select other sources to change the mix, or clear your selection to return to the broader feed. An optional topic filter narrows your results further.', sources: ['Selected source'], cards: ['A post from your selected source', 'Another post from the same source', 'More from that source'] },
  { name: 'Following', icon: Users, title: 'Keep up with the accounts you follow.', description: 'Sign in and connect a supported account when required. Following uses the access you authorize and the content that each service makes available. Availability differs by provider.', sources: ['Accounts you follow'], cards: ['An update from a followed account', 'Another available update'] },
];

function FeedDiagram() {
  const [selected, setSelected] = useState(0);
  const view = VIEWS[selected];
  return <figure className="public-feed-diagram">
    <figcaption>Try the three views below. This diagram is an example, not a live feed.</figcaption>
    <div className="public-feed-options" role="group" aria-label="Feed views">
      {VIEWS.map(({ name, icon: Icon }, index) => <button key={name} type="button" aria-pressed={selected === index} aria-controls="feed-diagram-detail" onClick={() => setSelected(index)}><Icon size={19} aria-hidden="true" />{name}</button>)}
    </div>
    <div id="feed-diagram-detail" aria-live="polite" aria-atomic="true">
      <h3>{view.title}</h3><p>{view.description}</p>
      <div className="public-feed-path">
        <div className="public-feed-inputs"><span className="public-overview-eyebrow">Where posts come from</span>{view.sources.map(source => <span className="public-feed-source" key={source}>{source}</span>)}</div>
        <ArrowRight className="public-feed-arrow" aria-hidden="true" />
        <div className="public-feed-hub"><img src="/uficonnect-mark.svg?v=blue-ufi-20261006" alt="" width="48" height="48" /><strong>UFIConnect</strong><span>{view.name}</span></div>
        <ArrowRight className="public-feed-arrow" aria-hidden="true" />
        <ol className="public-feed-examples" aria-label="Example posts">{view.cards.map(card => <li key={card}><span>Source · Original author</span><strong>{card}</strong><small>Original post link stays with the content</small></li>)}</ol>
      </div>
    </div>
  </figure>;
}

export default function OfficeOverview() {
  return <PublicOverviewLayout>
    <Helmet>
      <title>How UFIConnect works | UFIConnect</title>
      <meta name="description" content="Understand the mixed feed, individual source feeds and Following. See how to browse, choose sources and explore UFIConnect." />
      <link rel="canonical" href="https://uficonnect.org/how-it-works" />
      <meta property="og:title" content="How UFIConnect works" />
      <meta property="og:description" content="Your guide to mixed feeds, source feeds and the tools around them." />
      <meta property="og:url" content="https://uficonnect.org/how-it-works" />
      <meta property="og:type" content="website" />
    </Helmet>
    <section className="public-overview-hero" aria-labelledby="how-it-works-title">
      <span className="public-overview-eyebrow">Your feeds, explained</span>
      <h1 id="how-it-works-title">How UFIConnect works.</h1>
      <p className="public-overview-lead">Explore a mix of posts in one place, or focus on the sources you want to see.</p>
      <p>UFIConnect brings social content, communities and professional opportunities into a shared workspace. Every source keeps its identity, and you can open the original post when you want to go further.</p>
      <div className="public-overview-actions"><Link to="/global" className="public-overview-button">Explore the public feed <ArrowRight size={17} aria-hidden="true" /></Link><a href="#your-feeds">See how the feeds connect <ArrowDown size={17} aria-hidden="true" /></a></div>
    </section>
    <section id="your-feeds" className="public-overview-section" aria-labelledby="your-feeds-title">
      <span className="public-overview-eyebrow">Choose your view</span><h2 id="your-feeds-title">A mix, a single source, or your follows.</h2>
      <FeedDiagram />
      <div className="public-overview-note"><Users size={24} aria-hidden="true" /><div><h3>Start browsing. Personalize when you sign in.</h3><p>The public Global Feed is a preview anyone can browse. Sign in for source filters, a personalized feed and Following. Connecting an external account is a separate choice, and each service controls the permissions and content it provides.</p></div></div>
    </section>
    <section className="public-overview-section" aria-labelledby="start-title">
      <span className="public-overview-eyebrow">Get started</span><h2 id="start-title">Make the feed yours.</h2>
      <ol className="public-overview-flow public-overview-flow--three">
        <li><span className="public-overview-step-number">01</span><Layers aria-hidden="true" /><h3>Explore the mix</h3><p>Open the Global Feed to browse public posts. Create an account to choose interests and use your personal home feed.</p></li>
        <li><span className="public-overview-step-number">02</span><ListFilter aria-hidden="true" /><h3>Choose your sources</h3><p>In your member feed, use the source filters to focus on a provider or combine several. Add a topic filter when you want something more specific.</p></li>
        <li><span className="public-overview-step-number">03</span><ExternalLink aria-hidden="true" /><h3>Follow the content</h3><p>Read the post and check its source. Open the original for the full conversation or provider features. Use the report option if something needs attention.</p></li>
      </ol>
    </section>
    <section className="public-overview-section" aria-labelledby="more-title">
      <span className="public-overview-eyebrow">Around your feed</span><h2 id="more-title">Keep exploring UFIConnect.</h2>
      <div className="public-overview-grid public-overview-grid--three">
        <article className="public-overview-card"><Play aria-hidden="true" /><h3>Videos and Music</h3><p>Use the dedicated views to find available media. Playback and access depend on the original provider and its supported player.</p></article>
        <article className="public-overview-card"><Users aria-hidden="true" /><h3>People and communities</h3><p>Find people, join groups and continue conversations with your UFIConnect account.</p></article>
        <article className="public-overview-card"><Briefcase aria-hidden="true" /><h3>Jobs and recruiting</h3><p>Explore opportunities and resume tools. Business memberships provide a workspace focused on recruiting and work.</p></article>
      </div>
      <p className="public-overview-caption">Vault is a separate password and document tool. <Link to="/vault-device">See the browser Vault and planned device experience.</Link></p>
    </section>
    <section className="public-overview-section public-overview-faq" aria-labelledby="questions-title">
      <h2 id="questions-title">A few useful answers</h2>
      <details><summary>Does every source offer the same features?</summary><p>No. Available posts, playback, account connections and interactions depend on each provider. UFIConnect keeps source attribution and links visible. Read the <Link to="/policies#connected-services">connected services disclosure</Link> for details.</p></details>
      <details><summary>Why does changing a source change my feed?</summary><p>The mixed feed brings together available sources. Choosing a source limits results to that selection; choosing a topic narrows them further. A source can have fewer posts or be temporarily unavailable.</p></details>
      <details><summary>Does a UFIConnect account sign me into every other service?</summary><p>No. Supported external accounts are connected separately with your permission. You can manage those connections from your account.</p></details>
      <div className="public-overview-actions"><Link to="/register" className="public-overview-button">Create your account <ArrowRight size={17} aria-hidden="true" /></Link><Link to="/login">Already a member? Sign in</Link></div>
    </section>
  </PublicOverviewLayout>;
}