import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { ArrowDown, ClipboardCheck, Database, Eye, FileCheck2, LayoutDashboard, ListChecks, Network, Server, UserRound, Wrench } from 'lucide-react';
import PublicOverviewLayout from './PublicOverviewLayout';

const STEPS = [
  { title: 'Choose a task', icon: UserRound, summary: 'An authorized operator starts with a question or an operational task.', detail: 'For example: investigate a stale feed, review a source worker, or check service health. Access to Office is restricted to authorized operators; a UFIconnect membership does not grant administrative access.' },
  { title: 'Inspect and plan', icon: Eye, summary: 'Review service observations and decide what needs attention.', detail: 'Office brings together source freshness, queue state, service measurements and recent results. Agent explanations use the available observations. A missing measurement stays unknown, and an agent heartbeat does not prove a job succeeded.' },
  { title: 'Choose a control', icon: ListChecks, summary: 'Use an available control for the service that owns the work.', detail: 'Controls cover tasks such as refreshing active sources, transferring staged posts and checking delivery. Each control has a defined target and impact. The agent conversation can explain observations; it cannot run commands or change the service.' },
  { title: 'Confirm and run', icon: Wrench, summary: 'The service checks access and runs the selected operation.', detail: 'Higher-impact controls request explicit confirmation before running. The server accepts only supported controls. Provider configuration and service availability still apply; an unavailable action is not reported as completed.' },
  { title: 'Review the result', icon: ClipboardCheck, summary: 'Check the recorded outcome and the updated service state.', detail: 'Office records control runs and their results. Operators can review failures and follow up with another check. A submitted request or an animation is not proof of successful delivery; the result and service observations provide that evidence.' },
];

function OfficeWorkflow() {
  const [selected, setSelected] = useState(0);
  const step = STEPS[selected];
  return <figure className="public-office-workflow">
    <figcaption id="office-workflow-caption">An operator-led workflow. Select a step to see what happens.</figcaption>
    <ol className="public-office-steps" aria-labelledby="office-workflow-caption">
      {STEPS.map(({ title, icon: Icon }, index) => <li key={title}>
        <button type="button" aria-pressed={selected === index} aria-controls="office-step-detail" onClick={() => setSelected(index)}>
          <span className="public-overview-step-number">0{index + 1}</span>
          <Icon size={23} aria-hidden="true" />
          <span>{title}</span>
        </button>
      </li>)}
    </ol>
    <div id="office-step-detail" className="public-office-step-detail" aria-live="polite" aria-atomic="true">
      <span className="public-overview-eyebrow">Step {selected + 1} of {STEPS.length}</span>
      <h3>{step.title}</h3><p><strong>{step.summary}</strong></p><p>{step.detail}</p>
    </div>
  </figure>;
}

export default function OfficeOverview() {
  return <PublicOverviewLayout>
    <Helmet>
      <title>How Office Works | UFIconnect</title>
      <meta name="description" content="See how UFIconnect Office helps operators inspect service health, review source workers, run authorized controls and check results, with diagrams of the workflow and services." />
      <link rel="canonical" href="https://uficonnect.org/how-office-works" />
      <meta property="og:title" content="How Office Works | UFIconnect" />
      <meta property="og:description" content="An illustrated guide to the operational dashboard behind UFIconnect: people, controls, source workers and service results." />
      <meta property="og:url" content="https://uficonnect.org/how-office-works" />
      <meta property="og:type" content="website" />
    </Helmet>

    <section className="public-overview-hero" aria-labelledby="office-overview-title">
      <div>
        <span className="public-overview-eyebrow">Behind UFIconnect</span>
        <h1 id="office-overview-title">How Office works.</h1>
        <p className="public-overview-lead">Office is the operations dashboard for the people who run UFIconnect.</p>
        <p>It brings service observations, source workers and administrative controls into one place, so operators can understand a problem, choose an action and review the outcome.</p>
        <div className="public-overview-actions"><a className="public-overview-button" href="#office-workflow">Explore the workflow <ArrowDown size={17} aria-hidden="true" /></a><span className="public-overview-status">Public guide · restricted dashboard</span></div>
      </div>
    </section>

    <section id="office-workflow" className="public-overview-section" aria-labelledby="office-workflow-title">
      <span className="public-overview-eyebrow">From a question to a checked result</span>
      <h2 id="office-workflow-title">Observe. Decide. Run. Review.</h2>
      <OfficeWorkflow />
    </section>

    <section className="public-overview-section" aria-labelledby="office-services-title">
      <span className="public-overview-eyebrow">How the services fit together</span>
      <h2 id="office-services-title">Separate services, one operational view.</h2>
      <p className="public-overview-intro">The website, Office, API and pipeline have distinct jobs. The diagram below shows the public-source feed path; connected accounts are also handled on demand with the member's authorization.</p>
      <figure className="public-office-architecture" aria-labelledby="office-architecture-caption">
        <div className="public-office-dashboard"><LayoutDashboard size={27} aria-hidden="true" /><div><h3>Office dashboard</h3><p>Authorized operators inspect the API and pipeline and send supported controls.</p></div></div>
        <div className="public-office-connection"><ArrowDown size={20} aria-hidden="true" /><span>Service observations and authorized controls</span><ArrowDown size={20} aria-hidden="true" /></div>
        <ol className="public-office-data-flow" aria-label="Public-source content flow">
          <li><Network aria-hidden="true" /><h3>Sources</h3><p>Enabled public sources, subject to each source's rules and availability.</p></li>
          <li><Wrench aria-hidden="true" /><h3>Pipeline</h3><p>Source workers fetch, screen and organize incoming posts.</p></li>
          <li><Database aria-hidden="true" /><h3>Database staging</h3><p>Posts wait for transfer into the API's public feed cache.</p></li>
          <li><Server aria-hidden="true" /><h3>API service</h3><p>Serves feed requests and handles account features.</p></li>
          <li><UserRound aria-hidden="true" /><h3>UFIconnect website</h3><p>Members and visitors browse the available content.</p></li>
        </ol>
        <figcaption id="office-architecture-caption">Read left to right on larger screens, and top to bottom on phones. Office observes and controls the backend services; public visitors use the UFIconnect website.</figcaption>
      </figure>
    </section>

    <section className="public-overview-section" aria-labelledby="office-agent-title">
      <span className="public-overview-eyebrow">What the agents do</span>
      <h2 id="office-agent-title">Software roles with specific jobs.</h2>
      <div className="public-overview-grid public-overview-grid--three">
        <article className="public-overview-card"><Network aria-hidden="true" /><h3>Source workers</h3><p>Fetch enabled public sources on the pipeline. Scheduling, retries and source availability determine when new content arrives.</p></article>
        <article className="public-overview-card"><Eye aria-hidden="true" /><h3>Observations and explanations</h3><p>Report service measurements and explain a selected worker's available observations. Agent chat is read-only and cannot deploy, delete or operate tools.</p></article>
        <article className="public-overview-card"><FileCheck2 aria-hidden="true" /><h3>Operator controls</h3><p>Offer defined operations with server-side access checks, confirmation where required, and recorded results. Operators review the effect of a change.</p></article>
      </div>
      <p className="public-overview-caption">The city and agent visuals help explain activity. They represent software roles, not employees, independent decision makers or proof that work has completed.</p>
    </section>

    <section className="public-overview-section public-overview-faq" aria-labelledby="office-questions-title">
      <h2 id="office-questions-title">A few useful distinctions</h2>
      <details><summary>Is Office part of my personal or Business membership?</summary><p>Office is a restricted operational dashboard for running UFIconnect. Your personal account, Command Center and Business recruiting workspace are separate member features.</p></details>
      <details><summary>Does chatting with an agent perform an action?</summary><p>No. Agent chat explains available observations and suggests checks. Operational actions use separate controls, and higher-impact actions require confirmation.</p></details>
      <details><summary>Does this page show live internal data?</summary><p>No. These diagrams explain the architecture. They do not load Office status, private records, access credentials or internal action history.</p></details>
      <details><summary>Where do I go for an account or content issue?</summary><p>Use the reporting options on posts or <a href="mailto:support@uficonnect.org">contact support</a>. Read our <Link to="/privacy">Privacy Policy</Link> for information about account data and privacy requests.</p></details>
    </section>
  </PublicOverviewLayout>;
}
