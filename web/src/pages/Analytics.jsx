import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowUpRight, ChartNoAxesCombined, CircleDollarSign, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import Layout from '../components/Layout';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import client from '../api/client';
import './Analytics.css';
import useTabMetrics from '../analytics/useTabMetrics';

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const metric = value => typeof value === 'number' && Number.isFinite(value) ? number.format(value) : 'Unavailable';
const statusLabel = value => String(value || 'unavailable').replaceAll('_', ' ');
const dateLabel = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not synced';
const revenueLabel = revenue => {
  if (typeof revenue?.amount !== 'number' || !Number.isFinite(revenue.amount) || !/^[A-Z]{3}$/.test(revenue.currency || '')) return 'Unavailable';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: revenue.currency }).format(revenue.amount); } catch { return 'Unavailable'; }
};
const safeUrl = value => {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
};

function SourceLink({ url, children }) {
  const href = safeUrl(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="creator-analytics-external">{children}<ArrowUpRight size={14} aria-hidden="true" /><span className="creator-analytics-sr"> (opens in a new tab)</span></a> : null;
}

function Metric({ label, value }) {
  const unavailable = typeof value !== 'number' || !Number.isFinite(value);
  return <div className="creator-analytics-metric"><dt>{label}</dt><dd className={unavailable ? 'is-unavailable' : undefined}>{metric(value)}</dd></div>;
}

const SECTIONS = [['overview', 'Overview'], ['content', 'Content'], ['audience', 'Audience'], ['sources', 'Connected sources'], ['earnings', 'Earnings'], ['tools', 'Tools']];

function DailyPosts({ native, expanded = false }) {
  const daily = (Array.isArray(native?.daily) ? native.daily : []).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day.day)
    && typeof day.posts === 'number' && Number.isFinite(day.posts) && day.posts >= 0).slice().sort((a, b) => a.day.localeCompare(b.day));
  const peak = Math.max(1, ...daily.map(day => day.posts));
  const table = <div className="creator-analytics-table-wrap" tabIndex={0} role="region" aria-label="Daily UFIconnect posts"><table><caption>Your UFIconnect posts by creation date</caption><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Posts created</th></tr></thead><tbody>{daily.map(day => <tr key={day.day}><th scope="row">{day.day}</th><td>{metric(day.posts)}</td></tr>)}</tbody></table></div>;
  return <section className="creator-analytics-card creator-analytics-chart-card" aria-labelledby="analytics-posts-over-time">
    <div className="creator-analytics-section-heading"><div><h2 id="analytics-posts-over-time">Posts over time</h2><p>Your UFIconnect posts, grouped by creation day in UTC.</p></div><span className="creator-analytics-status">UFIconnect</span></div>
    {daily.length ? <>
      <div className="creator-analytics-chart" aria-hidden="true"><span className="creator-analytics-chart-peak">{metric(peak)}</span><div className="creator-analytics-bars">{daily.map(day => <div key={day.day} className="creator-analytics-bar-track" title={`${day.day}: ${metric(day.posts)} posts`}><span style={{ height: `${day.posts / peak * 100}%` }} /></div>)}</div><div className="creator-analytics-chart-dates"><span>{daily[0].day}</span><span>{daily.at(-1).day}</span></div></div>
      {expanded ? table : <details className="creator-analytics-details"><summary>View daily data</summary>{table}</details>}
    </> : <div className="creator-analytics-empty"><h3>{native?.status === 'available' ? 'No daily data for this period' : 'Post history unavailable'}</h3><p>Your daily chart will appear when this report includes post activity.</p></div>}
  </section>;
}

function SourceCard({ source }) {
  return <article className="creator-analytics-card creator-analytics-source">
    <header>
      <span className="creator-analytics-source-mark" aria-hidden="true">{hasBrandIcon(source.id) ? <BrandIcon platform={source.id} size={23} /> : String(source.label || source.id).slice(0, 2).toUpperCase()}</span>
      <div><h3>{source.label}</h3><span className="creator-analytics-muted">{source.connected ? 'Account connected' : 'Account not connected'}</span></div>
      <span className="creator-analytics-status">{statusLabel(source.status)}</span>
    </header>
    <dl className="creator-analytics-metrics">
      <Metric label="Source views" value={source.metrics?.views} />
      <Metric label="Source likes" value={source.metrics?.likes} />
      <Metric label="Source comments" value={source.metrics?.comments} />
      <Metric label="Source posts" value={source.metrics?.posts} />
    </dl>
    {source.metricScope && <p className="creator-analytics-caption">{source.metricScope}</p>}
    {source.periodMetrics && <div className="creator-analytics-source-period"><h4>Selected period</h4>{source.periodRange && <p className="creator-analytics-caption">{source.periodRange.startDate} to {source.periodRange.endDate} (source reporting dates)</p>}<dl className="creator-analytics-metrics"><Metric label="Views" value={source.periodMetrics.views} /><Metric label="Likes" value={source.periodMetrics.likes} /><Metric label="Comments" value={source.periodMetrics.comments} /></dl></div>}
    <p className="creator-analytics-muted">{source.reason || 'Engagement metrics are provided by the original source.'}</p>
    {source.note && <p className="creator-analytics-muted">{source.note}</p>}
    {source.capabilities && <details className="creator-analytics-source-controls"><summary>Source controls</summary><dl className="creator-analytics-facts">{[['officialPlayer', 'Official player'], ['like', 'Like through API'], ['comment', 'Comment through API'], ['sourceAnalytics', 'Analytics API']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{source.capabilities[key] === true ? 'Requires source authorization' : 'Unavailable'}</dd></div>)}</dl><p className="creator-analytics-caption">Playback, advertising, and content restrictions remain with the source.</p></details>}
    <footer><span>Synced: {dateLabel(source.lastSyncedAt)}</span><SourceLink url={source.originalUrl}>Open {source.label}</SourceLink></footer>
  </article>;
}

export default function Analytics() {
  const [section, setSection] = useState('overview');
  useTabMetrics('analytics', section);
  const tabs = useRef(null);
  const [days, setDays] = useState(30);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState({ source: '', sourceUrl: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const requestVersion = useRef(0);

  const loadReport = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true); setError('');
    try {
      const { data } = await client.get('/creator-analytics/report', { params: { days } });
      if (version === requestVersion.current) setReport(data);
      return true;
    } catch (err) {
      if (version === requestVersion.current) setError(err.response?.data?.message || 'Analytics could not be loaded. Try again.');
      return false;
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    setReport(null);
    loadReport();
    return () => { requestVersion.current += 1; };
  }, [loadReport]);

  async function refresh() {
    setRefreshing(true); setError(''); setNotice('');
    try {
      await client.post('/creator-analytics/refresh', { days }, { timeout: 30000 });
      if (await loadReport()) setNotice('Refresh finished. Each source shows its latest sync status.');
    } catch (err) {
      setError(err.response?.data?.message || 'Source refresh could not finish. Try again.');
    } finally { setRefreshing(false); }
  }

  async function submitReport(event) {
    event.preventDefault();
    if (submitting) return;
    setFormError(''); setNotice('');
    if (!safeUrl(form.sourceUrl) || !form.sourceUrl.trim().startsWith('https://')) { setFormError('Enter the original source URL starting with https://.'); return; }
    setSubmitting(true);
    try {
      await client.post('/creator-analytics/copyright-reports', { source: form.source, sourceUrl: form.sourceUrl.trim(), reason: form.reason.trim() });
      setForm({ source: '', sourceUrl: '', reason: '' });
      setNotice('Your copyright concern was recorded for review.');
      await loadReport();
    } catch (err) {
      setFormError(err.response?.data?.message || 'Your concern could not be recorded. Try again.');
    } finally { setSubmitting(false); }
  }

  const sources = report?.sources || [];
  const shownSources = sources.filter(source => sourceFilter === 'all' || source.id === sourceFilter);
  const native = report?.uficonnect;
  const learning = report?.deepLearning;
  const copyright = report?.copyright;

  function openSources() {
    setSection('sources');
    tabs.current?.querySelector('#analytics-tab-sources')?.focus();
  }

  function navigateTabs(event) {
    const current = SECTIONS.findIndex(([id]) => id === section);
    const next = event.key === 'ArrowRight' ? (current + 1) % SECTIONS.length
      : event.key === 'ArrowLeft' ? (current + SECTIONS.length - 1) % SECTIONS.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? SECTIONS.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setSection(SECTIONS[next][0]);
    tabs.current?.querySelectorAll('[role="tab"]')[next]?.focus();
  }

  return <Layout wide>
    <Helmet><title>Analytics | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <div className="creator-analytics">
      <header className="creator-analytics-header">
        <div><p className="creator-analytics-eyebrow">Your performance</p><h1><ChartNoAxesCombined size={27} aria-hidden="true" />Analytics</h1><p>Understand your content, engagement, and connected accounts.</p></div>
        <Link to="/connected-accounts" className="btn btn-ghost">Manage accounts</Link>
      </header>
      <div className="creator-analytics-toolbar">
        <label htmlFor="analytics-period">Reporting period<select id="analytics-period" value={days} disabled={refreshing || submitting} onChange={event => { setNotice(''); setDays(Number(event.target.value)); }}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label>
        <span className="creator-analytics-muted">{report ? `Report updated ${dateLabel(report.generatedAt)}` : 'Your account only'}</span>
        <button type="button" className="btn btn-primary" onClick={refresh} disabled={refreshing || loading || submitting}><RefreshCw size={15} aria-hidden="true" />{refreshing ? 'Refreshing sources…' : 'Refresh sources'}</button>
      </div>
      <div className="creator-analytics-tabs" role="tablist" aria-label="Analytics sections" ref={tabs} onKeyDown={navigateTabs}>{SECTIONS.map(([id, label]) => <button key={id} type="button" id={`analytics-tab-${id}`} role="tab" aria-selected={section === id} aria-controls={`analytics-panel-${id}`} tabIndex={section === id ? 0 : -1} onClick={() => setSection(id)}>{label}</button>)}</div>
      {error && <div className="creator-analytics-message is-error" role="alert">{error}<button type="button" className="btn btn-ghost btn-sm" onClick={loadReport} disabled={loading || refreshing}>Try again</button></div>}
      {notice && <p className="creator-analytics-message" role="status">{notice}</p>}
      {report?.localPreview && <p className="creator-analytics-message" role="status">Local preview account. Connected source metrics and production activity are unavailable here.</p>}
      {loading && !report && <div className="creator-analytics-card creator-analytics-loading" role="status">Loading your analytics…</div>}
      {report && <div role="tabpanel" id={`analytics-panel-${section}`} aria-labelledby={`analytics-tab-${section}`} tabIndex={0} aria-busy={loading || refreshing}>
        {section === 'sources' && <section className="creator-analytics-section" aria-labelledby="source-analytics-title">
          <div className="creator-analytics-section-heading"><div><h2 id="source-analytics-title">Connected sources</h2><p>Review performance reported by each platform, with its own reporting scope.</p></div><label htmlFor="analytics-source-filter">Source<select id="analytics-source-filter" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value="all">All sources ({sources.length})</option>{sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label></div>
          <p className="creator-analytics-caption">Source totals and selected-period analytics are labeled separately. Unavailable means the source has not supplied that metric. Each platform defines a view; playback here may not count. Counts from different platforms are not a shared measure of reach.</p>
          <div className="creator-analytics-source-grid">{shownSources.map(source => <SourceCard key={source.id} source={source} />)}</div>
          {!shownSources.length && <p className="creator-analytics-card">No source data is available. <Link to="/connected-accounts">Manage your connections</Link>.</p>}
        </section>}

        {['overview', 'content'].includes(section) && <>
        <section className="creator-analytics-section creator-analytics-card" aria-labelledby="ufi-analytics-title">
          <div className="creator-analytics-section-heading"><div><h2 id="ufi-analytics-title">Your UFIconnect activity</h2><p>Posts created during the selected period, with their current likes and comments.</p></div><span className="creator-analytics-status">{statusLabel(native?.status)}</span></div>
          <dl className="creator-analytics-metrics creator-analytics-native-metrics"><Metric label="Your posts" value={native?.posts} /><Metric label="Likes received" value={native?.likesReceived} /><Metric label="Comments received" value={native?.commentsReceived} /></dl>
          <p className="creator-analytics-caption">Likes and comments are the current totals on these posts, including engagement received after they were created. Connected platform totals are shown separately.</p>
        </section>
        <DailyPosts native={native} expanded={section === 'content'} />
        {section === 'overview' && <div className="creator-analytics-overview-actions"><p className="creator-analytics-muted">Looking for another platform?</p><button type="button" className="btn btn-ghost btn-sm" onClick={openSources}>View connected sources<ArrowUpRight size={14} aria-hidden="true" /></button></div>}
        </>}

        {section === 'audience' && <section className="creator-analytics-card creator-analytics-audience" aria-labelledby="analytics-audience-title"><h2 id="analytics-audience-title">Audience</h2><div className="creator-analytics-empty"><h3>Audience data is not available yet</h3><p>This report does not include follower growth, unique reach, or audience demographics. Views, likes, and comments are shown in their own sections.</p><span className="creator-analytics-status">Unavailable</span></div><button type="button" className="btn btn-ghost btn-sm" onClick={openSources}>View connected source metrics</button></section>}

        {section === 'earnings' && <section className="creator-analytics-section" aria-labelledby="analytics-earnings-title">
          <div className="creator-analytics-section-heading"><div><h2 id="analytics-earnings-title"><CircleDollarSign size={20} aria-hidden="true" />Earnings</h2><p>Estimates supplied by your authorized sources. Each amount keeps its source, currency, and reporting dates.</p></div></div>
          <p className="creator-analytics-caption">{report.monetization?.note || 'Creator earnings and advertising remain with the original source. An unavailable estimate is not a zero balance.'}</p>
          <div className="creator-analytics-source-grid">{sources.map(source => <article key={source.id} className="creator-analytics-card creator-analytics-earnings-card"><h3>{source.label}</h3><dl><dt>Estimated source revenue</dt><dd>{revenueLabel(source.revenue)}</dd></dl>{source.revenue?.startDate && <p className="creator-analytics-caption">{source.revenue.startDate} to {source.revenue.endDate}</p>}{source.revenue?.note && <p className="creator-analytics-muted">{source.revenue.note}</p>}<SourceLink url={source.originalUrl}>Open {source.label}</SourceLink></article>)}</div>
          {!sources.length && <p className="creator-analytics-card">Source earnings are unavailable. Connect an account and authorize its analytics to see supported estimates.</p>}
          <div className="creator-analytics-inline-actions creator-analytics-overview-actions"><Link className="btn btn-ghost btn-sm" to="/connected-accounts?analytics=1&monetization=1">Authorize source analytics</Link><Link className="btn btn-ghost btn-sm" to="/centers/monetization">Monetization workspace</Link></div>
        </section>}

        {section === 'tools' && <>
        <div className="creator-analytics-section-heading"><div><h2>Tools and settings</h2><p>Manage reports, permissions, rights, and your analysis workspaces.</p></div></div>
        <div className="creator-analytics-pair">
          <section className="creator-analytics-card" aria-labelledby="analytics-workspace-title"><h2 id="analytics-workspace-title">Your workspaces</h2><div className="creator-analytics-tool-links"><Link to="/centers/source-analytics">Imported reports<ArrowUpRight size={15} aria-hidden="true" /></Link><Link to="/centers/monetization">Monetization workspace<ArrowUpRight size={15} aria-hidden="true" /></Link><Link to="/centers/deep-learning">Deep learning workspace<ArrowUpRight size={15} aria-hidden="true" /></Link><Link to="/connected-accounts">Connected account permissions<ArrowUpRight size={15} aria-hidden="true" /></Link></div><dl className="creator-analytics-facts"><div><dt>UFIconnect membership</dt><dd>{statusLabel(report.monetization?.plan)} · {statusLabel(report.monetization?.status)}</dd></div><div><dt>Source action requests</dt><dd>{metric(native?.interactionRequests)}</dd></div></dl><p className="creator-analytics-caption">Source action requests are audit records, not confirmed engagement. Source platforms publish their own counts.</p><Link className="btn btn-ghost btn-sm" to="/settings?tab=account">Manage membership</Link></section>
          <section className="creator-analytics-card" aria-labelledby="analytics-learning-title"><h2 id="analytics-learning-title"><Sparkles size={20} aria-hidden="true" />Deep learning insights</h2><span className="creator-analytics-status">{statusLabel(learning?.status)}</span><p>{learning?.reason || 'Insights will appear when an enabled model has enough authorized data.'}</p>{learning?.model && <p className="creator-analytics-caption">Model: {learning.model}</p>}{learning?.insights?.length > 0 && <ul className="creator-analytics-insights">{learning.insights.map((insight, index) => <li key={index}>{typeof insight === 'string' ? insight : <><strong>{insight.title}</strong>{insight.detail && <p>{insight.detail}</p>}</>}</li>)}</ul>}</section>
        </div>

        <section className="creator-analytics-section creator-analytics-card" aria-labelledby="analytics-copyright-title">
          <div className="creator-analytics-section-heading"><div><h2 id="analytics-copyright-title"><ShieldCheck size={20} aria-hidden="true" />Copyright and source controls</h2><p>{copyright?.policy || 'Original sources retain control over playback, rights, removal, and creator monetization.'}</p></div></div>
          <div className="creator-analytics-copyright-grid">
            <form onSubmit={submitReport} className="creator-analytics-report-form"><h3>Record a copyright concern</h3><p className="creator-analytics-muted">Share the original URL and explain the concern for UFIconnect review. For a source takedown, use that platform’s reporting process.</p><label htmlFor="copyright-source">Original source<select id="copyright-source" value={form.source} onChange={event => setForm(value => ({ ...value, source: event.target.value }))} required disabled={submitting}><option value="">Choose a source</option>{sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label><label htmlFor="copyright-source-url">Original post URL<input id="copyright-source-url" type="url" value={form.sourceUrl} onChange={event => setForm(value => ({ ...value, sourceUrl: event.target.value }))} placeholder="https://" maxLength={2048} required disabled={submitting} /></label><label htmlFor="copyright-reason">Describe your concern<textarea id="copyright-reason" rows={4} value={form.reason} onChange={event => setForm(value => ({ ...value, reason: event.target.value }))} minLength={10} maxLength={2000} required disabled={submitting} /></label>{formError && <p className="creator-analytics-message is-error" role="alert">{formError}</p>}<button type="submit" className="btn btn-primary" disabled={submitting || !form.source || !form.sourceUrl.trim() || form.reason.trim().length < 10}>{submitting ? 'Recording…' : 'Submit for review'}</button></form>
            <div><h3>Your reports</h3>{copyright?.reports?.length ? <ul className="creator-analytics-reports">{copyright.reports.map(item => <li key={item.id}><div><strong>{sources.find(source => source.id === item.source)?.label || item.source}</strong><span className="creator-analytics-status">{statusLabel(item.status)}</span></div><SourceLink url={item.sourceUrl}>View original post</SourceLink><time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time></li>)}</ul> : <p className="creator-analytics-muted">You have no recorded copyright concerns.</p>}</div>
          </div>
        </section>

        <section className="creator-analytics-section creator-analytics-card" aria-labelledby="analytics-security-title"><h2 id="analytics-security-title"><ShieldCheck size={20} aria-hidden="true" />Connection safeguards</h2><p>{report.security?.credentialStorage}</p>{report.security?.rules?.length > 0 && <ul className="creator-analytics-security-rules">{report.security.rules.map(rule => <li key={rule}>{rule}</li>)}</ul>}<p className="creator-analytics-caption">{typeof report.security?.auditRetentionDays === 'number' && <>Interaction audit retention: {report.security.auditRetentionDays} days. </>}<Link to="/privacy#analytics">Analytics privacy controls</Link></p>{report.security?.vault && <div className="creator-analytics-vault"><h3>Device security architecture</h3><span className="creator-analytics-status">{statusLabel(report.security.vault.state || report.security.vault.status)}</span><p>{report.security.vault.reason || (report.security.vault.hardwareIntegrated === false ? 'The device verification service is a software prototype. Secure-element hardware, attestation, NFC pairing, recovery, and hardware VPN keys still require integration. It does not protect the browser Vault.' : 'Device verification status is provided by the configured service.')}</p><Link to="/vault" className="btn btn-ghost btn-sm">Open UFI Vault</Link></div>}</section>
        </>}
      </div>}
    </div>
  </Layout>;
}
