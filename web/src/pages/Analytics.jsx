import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowUpRight, ChartNoAxesCombined, CircleDollarSign, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import Layout from '../components/Layout';
import BrandIcon, { hasBrandIcon } from '../components/BrandIcon';
import client from '../api/client';
import './Analytics.css';

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
    <div className="creator-analytics-source-revenue"><span>Estimated source revenue</span><strong>{revenueLabel(source.revenue)}</strong>{source.revenue?.startDate && <small>{source.revenue.startDate} to {source.revenue.endDate}</small>}{source.revenue?.note && <p className="creator-analytics-caption">{source.revenue.note}</p>}</div>
    <p className="creator-analytics-muted">{source.reason || 'Engagement metrics are provided by the original source.'}</p>
    {source.note && <p className="creator-analytics-muted">{source.note}</p>}
    {source.capabilities && <details className="creator-analytics-source-controls"><summary>Source controls</summary><dl className="creator-analytics-facts">{[['officialPlayer', 'Official player'], ['like', 'Like through API'], ['comment', 'Comment through API'], ['sourceAnalytics', 'Analytics API']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{source.capabilities[key] === true ? 'Requires source authorization' : 'Unavailable'}</dd></div>)}</dl><p className="creator-analytics-caption">Playback, advertising, and content restrictions remain with the source.</p></details>}
    <footer><span>Synced: {dateLabel(source.lastSyncedAt)}</span><SourceLink url={source.originalUrl}>Open {source.label}</SourceLink></footer>
  </article>;
}

export default function Analytics() {
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

  return <Layout wide>
    <Helmet><title>Analytics and rights | UFIconnect</title><meta name="robots" content="noindex" /></Helmet>
    <div className="creator-analytics">
      <header className="creator-analytics-header">
        <div><p className="creator-analytics-eyebrow">Your creator workspace</p><h1><ChartNoAxesCombined size={27} aria-hidden="true" />Analytics and rights</h1><p>Source engagement, your UFIconnect activity, and copyright concerns in one place.</p></div>
        <Link to="/connected-accounts" className="btn btn-ghost">Manage accounts</Link>
      </header>
      <div className="creator-analytics-toolbar">
        <label htmlFor="analytics-period">Reporting period<select id="analytics-period" value={days} disabled={refreshing || submitting} onChange={event => { setNotice(''); setDays(Number(event.target.value)); }}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label>
        <span className="creator-analytics-muted">{report ? `Report updated ${dateLabel(report.generatedAt)}` : 'Your account only'}</span>
        <button type="button" className="btn btn-primary" onClick={refresh} disabled={refreshing || loading || submitting}><RefreshCw size={15} aria-hidden="true" />{refreshing ? 'Refreshing sources…' : 'Refresh sources'}</button>
      </div>
      {error && <div className="creator-analytics-message is-error" role="alert">{error}<button type="button" className="btn btn-ghost btn-sm" onClick={loadReport} disabled={loading || refreshing}>Try again</button></div>}
      {notice && <p className="creator-analytics-message" role="status">{notice}</p>}
      {report?.localPreview && <p className="creator-analytics-message" role="status">Local preview account. Connected source metrics and production activity are unavailable here.</p>}
      {loading && !report && <div className="creator-analytics-card creator-analytics-loading" role="status">Loading your analytics…</div>}
      {report && <div aria-busy={loading || refreshing}>
        <section className="creator-analytics-section" aria-labelledby="source-analytics-title">
          <div className="creator-analytics-section-heading"><div><h2 id="source-analytics-title">Across your sources</h2><p>Engagement metrics are provided by the original source. Each platform decides what qualifies as a view. A watch in UFIconnect does not guarantee a source view.</p></div><label htmlFor="analytics-source-filter">Source<select id="analytics-source-filter" value={sourceFilter} onChange={event => setSourceFilter(event.target.value)}><option value="all">All sources ({sources.length})</option>{sources.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label></div>
          <p className="creator-analytics-caption">Source totals and selected-period analytics are labeled separately. Unavailable means the source has not supplied that metric. Counts from different platforms are not a shared measure of reach.</p>
          <div className="creator-analytics-source-grid">{shownSources.map(source => <SourceCard key={source.id} source={source} />)}</div>
          {!shownSources.length && <p className="creator-analytics-card">No source data is available. <Link to="/connected-accounts">Manage your connections</Link>.</p>}
        </section>

        <section className="creator-analytics-section creator-analytics-card" aria-labelledby="ufi-analytics-title">
          <div className="creator-analytics-section-heading"><div><h2 id="ufi-analytics-title">Your UFIconnect activity</h2><p>Posts created during the selected period, with their current likes and comments.</p></div><span className="creator-analytics-status">{statusLabel(native?.status)}</span></div>
          <dl className="creator-analytics-metrics creator-analytics-native-metrics"><Metric label="Your posts" value={native?.posts} /><Metric label="Likes received" value={native?.likesReceived} /><Metric label="Comments received" value={native?.commentsReceived} /><Metric label="Source action requests" value={native?.interactionRequests} /></dl>
          <p className="creator-analytics-caption">Source action requests are audit records. Source platforms confirm engagement and publish their own counts.</p>
          {native?.daily?.length > 0 && <details className="creator-analytics-details"><summary>Daily posts (UTC)</summary><div className="creator-analytics-table-wrap" tabIndex={0} role="region" aria-label="Daily UFIconnect posts"><table><caption>Your native UFIconnect posts by creation date</caption><thead><tr><th scope="col">Day</th><th scope="col">Posts created</th></tr></thead><tbody>{native.daily.map(day => <tr key={day.day}><th scope="row">{day.day}</th><td>{metric(day.posts)}</td></tr>)}</tbody></table></div></details>}
        </section>

        <div className="creator-analytics-pair">
          <section className="creator-analytics-card" aria-labelledby="analytics-monetization-title"><h2 id="analytics-monetization-title"><CircleDollarSign size={20} aria-hidden="true" />Monetization</h2><dl className="creator-analytics-facts"><div><dt>UFIconnect membership</dt><dd>{statusLabel(report.monetization?.plan)} · {statusLabel(report.monetization?.status)}</dd></div><div><dt>Source revenue</dt><dd>{report.monetization?.sourceRevenueAvailable ? 'See source estimates above' : 'Unavailable'}</dd></div></dl><p>{report.monetization?.note || 'Creator earnings and advertising remain with the original source. Revenue is shown only when an authorized source supplies it.'}</p><div className="creator-analytics-inline-actions"><Link className="btn btn-ghost btn-sm" to="/settings?tab=account">Manage membership</Link><Link className="btn btn-ghost btn-sm" to="/connected-accounts?analytics=1&monetization=1">Authorize source analytics</Link></div></section>
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
      </div>}
    </div>
  </Layout>;
}
