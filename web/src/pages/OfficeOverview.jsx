import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ArrowRight, Database, Filter, Layers, Link2, ShieldCheck, Users } from 'lucide-react';
import PublicOverviewLayout from './PublicOverviewLayout';

const VIEWS = [
  { name: 'Mixed feed', icon: Layers, scope: 'Multiple available sources', selection: 'Your interests, selected sources and topics', result: 'One feed with the original source on every post', detail: 'The mixed feed combines UFIConnect posts and available external content. Your saved interests guide discovery. Explicit source and topic filters let you narrow the results, while the selected sort order controls their presentation.' },
  { name: 'Source feeds', icon: Filter, scope: 'One provider or a selected group of providers', selection: 'The sources you select in the feed controls', result: 'Only available posts from those sources', detail: 'Source feeds use the same reading interface as the mixed feed. Selecting a provider changes the content scope; it does not merge your accounts or change that provider’s permissions. Add a topic filter to narrow the selection further.' },
  { name: 'Following', icon: Users, scope: 'Followed accounts, joined communities and supported connections', selection: 'Your UFIConnect follows and authorized external account access', result: 'Updates available within your following scope', detail: 'Following draws on your follows, joined communities and supported account connections. External services determine which followed-account content they expose. A connection does not guarantee access to every post or interaction.' },
];
function FeedViews() {
  const [selected,setSelected] = useState(0);
  const view = VIEWS[selected];
  return <div className="public-feed-diagram">
    <div className="public-feed-options" role="group" aria-label="Feed views">{VIEWS.map(({name,icon:Icon},index)=><button key={name} type="button" aria-pressed={selected===index} aria-controls="feed-view-detail" onClick={()=>setSelected(index)}><Icon size={19} aria-hidden="true" />{name}</button>)}</div>
    <div id="feed-view-detail" aria-live="polite">
      <h3>{view.name}</h3><p>{view.detail}</p>
      <dl className="public-feed-spec">
        <div><dt>Content scope</dt><dd>{view.scope}</dd></div>
        <div><dt>What controls it</dt><dd>{view.selection}</dd></div>
        <div><dt>What you see</dt><dd>{view.result}</dd></div>
      </dl>
    </div>
  </div>;
}
export default function OfficeOverview() {
  return <PublicOverviewLayout>
    <Helmet>
      <title>How UFIConnect works | UFIConnect</title>
      <meta name="description" content="How UFIConnect connects sources, organizes posts and delivers mixed, source and following feeds alongside community, career and account tools." />
      <link rel="canonical" href="https://uficonnect.org/how-it-works" />
      <meta property="og:title" content="How UFIConnect works" />
      <meta property="og:description" content="Content flow, feed controls, connected accounts and the tools available in UFIConnect." />
      <meta property="og:url" content="https://uficonnect.org/how-it-works" />
      <meta property="og:type" content="website" />
    </Helmet>
    <section className="public-overview-hero">
      <span className="public-overview-eyebrow">Platform overview</span>
      <h1>How UFIConnect works</h1>
      <p className="public-overview-lead">A shared workspace for content discovery, communities and professional activity.</p>
      <p>UFIConnect organizes available content from multiple sources into mixed, source-specific and following feeds. Source attribution, account permissions and provider playback rules remain attached to the content throughout that process.</p>
      <div className="public-overview-actions"><Link to="/global" className="public-overview-button">View the public feed <ArrowRight size={17} aria-hidden="true" /></Link><a href="#content-flow">Explore the content flow</a></div>
    </section>
    <section id="content-flow" className="public-overview-section">
      <span className="public-overview-eyebrow">From the source to your screen</span><h2>How content reaches your feed</h2>
      <p className="public-overview-intro">Public sources and authorized account connections follow separate access rules. UFIConnect brings the available results into a consistent reading interface.</p>
      <ol className="public-overview-flow public-overview-flow--four" aria-label="UFIConnect content flow">
        <li><span className="public-overview-step-number">01</span><Link2 aria-hidden="true" /><h3>Source access</h3><p>Public feeds supply content through available source integrations. Account connections require your authorization and the provider’s supported permissions.</p></li>
        <li><span className="public-overview-step-number">02</span><Database aria-hidden="true" /><h3>Content organization</h3><p>Posts are checked and organized with their author, source, timestamp, text and available media. Background refreshes update public content; availability and freshness vary by source.</p></li>
        <li><span className="public-overview-step-number">03</span><Filter aria-hidden="true" /><h3>Feed selection</h3><p>Your chosen view, source filters, topics and account scope determine which posts are eligible. Your preferences and sort controls shape the results you browse.</p></li>
        <li><span className="public-overview-step-number">04</span><Layers aria-hidden="true" /><h3>Reading and actions</h3><p>Read the available post, play supported media, save content or open the original. Reporting is available on posts; external interactions depend on the provider.</p></li>
      </ol>
    </section>
    <section className="public-overview-section">
      <span className="public-overview-eyebrow">Feed controls</span><h2>Mixed feeds, source feeds and Following</h2>
      <FeedViews />
      <p className="public-overview-caption">Visitors can browse the public Global Feed. Sign in to personalize your home feed, use source filters and access Following. Clearing an explicit source selection returns to the broader feed allowed by that view.</p>
    </section>
    <section className="public-overview-section">
      <span className="public-overview-eyebrow">Connected features</span><h2>How the workspace fits together</h2>
      <div className="public-overview-grid public-overview-grid--three">
        <article className="public-overview-card"><h3>Feed, Videos and Music</h3><p>Different views of available content. Media uses supported playback routes, with links to the original source when playback belongs on the provider’s service.</p></article>
        <article className="public-overview-card"><h3>People, groups and messages</h3><p>Your UFIConnect identity connects your profile, community participation and conversations. Following helps you return to relevant accounts and communities.</p></article>
        <article className="public-overview-card"><h3>Opportunities and resume tools</h3><p>Career listings connect discovery with role information and the original application page. Resume tools support preparation and applications.</p></article>
        <article className="public-overview-card"><h3>Business recruiting</h3><p>A Business membership provides a workspace focused on work and recruiting. Membership and team settings manage access to those tools.</p></article>
        <article className="public-overview-card"><h3>Vault and the planned device</h3><p>The browser Vault stores encrypted personal items locally. The <Link to="/vault-device">planned device</Link> extends the concept to authenticated, automated sign-ins.</p></article>
        <article className="public-overview-card"><h3>Account and privacy controls</h3><p>Settings brings together account security, appearance, connected services and membership management. You control which supported accounts to connect.</p></article>
      </div>
    </section>
    <section className="public-overview-section">
      <span className="public-overview-eyebrow">Permissions and availability</span><h2>What stays with the source</h2>
      <div className="public-overview-note"><ShieldCheck size={24} aria-hidden="true" /><div><h3>One interface, separate service permissions</h3><p>Connecting a service authorizes only the supported access you grant. It does not sign you into every provider, transfer ownership of their content or make every external action available inside UFIConnect.</p><p>Deleted content, access changes, rate limits and unavailable media can affect what appears. Original links and source identity remain visible so you can inspect the context at the source.</p></div></div>
      <p>Review <Link to="/policies#connected-services">connected service disclosures</Link>, <Link to="/privacy">privacy controls</Link> and <Link to="/policies#reporting">reporting procedures</Link>.</p>
      <div className="public-overview-actions"><Link to="/register" className="public-overview-button">Create an account</Link><Link to="/login">Sign in</Link></div>
    </section>
  </PublicOverviewLayout>;
}