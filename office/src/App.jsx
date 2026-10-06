import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import Controls from './Controls';
import PostPipeline from './PostPipeline';
import LocalWeb from './LocalWeb';
import Setup from './Setup';
import Reports from './Reports';
import RecoveryOverview from './RecoveryOverview';
import { mergeObservedAgents, observeAgentPayload } from './office-telemetry.mjs';
import { createOfficeClient, createOfficeEventSource, createTrustedOfficeFetch, connectOfficeStreams, mergeOfficeLog } from './office-runtime.mjs';
import { requestOfficeAccess } from './OfficeAccessDialog';

const API = import.meta.env.VITE_API_URL || '';
// uficonnect-pipeline's own URL (see render.yaml) — the service that
// actually runs the ~30 continuous source-fetchers post-split (see
// SERVICE_ROLE in backend/index.js). Falls back to API when unset so a
// dashboard build from before uficonnect-pipeline exists (or a local dev
// setup running everything in one process) keeps working exactly as before —
// every dual-source fetch/merge below degrades to "both requests hit the
// same place," not a broken one.
const PIPELINE_API = import.meta.env.VITE_PIPELINE_API_URL || API;
// transferStagedPosts drains in batches of up to 100k/minute now (20 x 5000-
// row batches per tick) — steady-state pending should stay well under this.
// Past it, the sidebar flags it rather than requiring a click into Pipeline
// to notice a real backlog (how the 8+ day stale-pipeline backlog went
// unnoticed for so long in the first place).
const STAGING_BACKLOG_WARN = 20000;
// The new Live City (towns, beltway and 3D region) runs in the local Office (the
// development and release-local builds that Local web runs) until it is finalized.
// The hosted production build keeps the previous Live City; each build leaves the
// other version's code out.
const LOCAL_OFFICE = import.meta.env.MODE !== 'production';
const LiveCity = LOCAL_OFFICE ? lazy(() => import('./LiveCity')) : lazy(() => import('./legacy-city/LiveCity'));
const PRIMARY_OFFICE_VIEWS = new Set(['overview', 'city', 'controls', 'setup', 'deploy']);

// ─── office auth ────────────────────────────────────────────────────────────
// Office requires a configured server token and a matching x-office-token
// header. Credentials are held in memory and never appended to stream URLs.
const trustedOfficeFetch = createTrustedOfficeFetch({ baseUrls: [API, PIPELINE_API], pageUrl: window.location.href,
  development: import.meta.env.DEV, fetcher: (...args) => fetch(...args) });
const officeClient = createOfficeClient({
  storage: { removeItem: key => {
    try { localStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
    try { sessionStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
  } },
  fetcher: trustedOfficeFetch, prompt: requestOfficeAccess,
  onTokenChange: () => window.dispatchEvent(new Event('office-token-changed')),
});
const officeFetch = officeClient.request;
const OfficeEventSource = createOfficeEventSource({ fetcher: trustedOfficeFetch, getToken: officeClient.getToken });
function officeStreamUrl(path, base = API) {
  return `${base}${path}`;
}

function useMediaQuery(query) {
  const read = useCallback(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  ), [query]);
  const [matches, setMatches] = useState(read);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, [query]);

  return matches;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtAgo(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function fmtUntil(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.ceil((new Date(ts).getTime() - Date.now()) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ─── shared style constants ───────────────────────────────────────────────────

function fmtStorage(dbSize) {
  if (!dbSize || dbSize.mb == null) return 'storage -';
  const limit = dbSize.limitMb ? ` / ${dbSize.limitMb.toLocaleString()}MB` : 'MB';
  const pct = dbSize.usedPct != null ? ` - ${dbSize.usedPct}%` : '';
  return `${dbSize.mb.toLocaleString()}MB${limit}${pct}`;
}
function storageColor(dbSize) {
  if (dbSize?.status === 'critical') return '#f87171';
  if (dbSize?.status === 'warn') return '#fbbf24';
  return '#64748b';
}

function badgeCode(value, fallback = 'ID') {
  const code = String(value || '')
    .replace(/\b(agent|source|worker)\b/gi, '')
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
  return code || fallback;
}

const H1 = { margin: '0 0 6px', fontSize: 24, fontWeight: 800, letterSpacing: -0.5, color: '#f1f5f9' };
const SUBTITLE = { margin: '0 0 28px', color: '#64748b', fontSize: 14, lineHeight: 1.5 };
const CODE = { background: '#1e293b', padding: '2px 7px', borderRadius: 4, fontFamily: 'monospace', fontSize: '0.88em', color: '#94a3b8' };

// ─── primitive components ─────────────────────────────────────────────────────

function Dot({ ok, pulse }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
      background: ok ? '#22c55e' : '#ef4444',
      boxShadow: ok ? '0 0 0 3px rgba(34,197,94,.2)' : 'none',
      animation: ok && pulse ? 'pulse 2s ease-in-out infinite' : 'none',
    }} />
  );
}

// Seconds -> "3m" / "2h" / "9d" — used in the sidebar's per-service health
// rows so an unexpectedly large number (pipeline sat at 8+ days once) is
// visible at a glance instead of requiring a click into a detail view.
function formatUptime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}

function Card({ children, style }) {
  return (
    <div style={{
      background: '#0d0d1a',
      border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 12,
      padding: 20,
      ...style,
    }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, disabled, variant = 'primary', size = 'md', style }) {
  const pads = size === 'sm' ? '5px 13px' : '9px 20px';
  const font = size === 'sm' ? 12 : 13;
  const variants = {
    primary: { background: disabled ? '#1e2d4a' : '#1d4ed8', color: disabled ? '#475569' : '#fff' },
    ghost:   { background: 'rgba(59,130,246,.1)',  color: '#60a5fa' },
    success: { background: 'rgba(34,197,94,.12)',  color: '#4ade80' },
    danger:  { background: 'rgba(239,68,68,.1)',   color: '#f87171' },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        border: 'none', borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 600, transition: 'opacity .15s', opacity: disabled ? .6 : 1,
        padding: pads, fontSize: font, ...variants[variant], ...style,
      }}
    >
      {children}
    </button>
  );
}

function Label({ children, color = '#94a3b8' }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.3, color }}>
      {children}
    </span>
  );
}

function StatCard({ icon, label, value, sub, color }) {
  return (
    <Card style={{ flex: '1 1 145px', minWidth: 130 }}>
      <Label>{label}</Label>
      <div style={{ margin: '8px 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <span style={{ fontSize: 18 }}>{icon}</span>}
        <span style={{ fontSize: 26, fontWeight: 800, color: color || '#e2e8f0', lineHeight: 1 }}>
          {value ?? '—'}
        </span>
      </div>
      {sub && <div style={{ fontSize: 11, color: '#475569' }}>{sub}</div>}
    </Card>
  );
}

function LogEntry({ entry }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,.035)',
    }}>
      <span style={{ fontSize: 10, lineHeight: 1.5, flexShrink: 0, fontWeight: 800, color: entry.color || '#94a3b8', minWidth: 22 }}>
        {badgeCode(entry.agentId, 'LOG')}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: entry.color || '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>{entry.msg}</div>
        <div style={{ fontSize: 10, color: '#334155', marginTop: 1 }}>{entry.agentId}</div>
      </div>
      <span style={{ fontSize: 10, color: '#475569', whiteSpace: 'nowrap', marginTop: 2 }}>{fmtTime(entry.ts)}</span>
    </div>
  );
}

// ─── Website Optimizer Panel ──────────────────────────────────────────────────

const SUB_AGENT_LABELS = {
  web_perf: 'Perf', web_seo: 'SEO', web_cache: 'Cache',
  web_storage: 'Storage', web_api: 'API', web_pipeline: 'Pipeline', web_office: 'Office', web_pwa: 'PWA',
};

function findingImpact(finding) {
  if (finding.includes('HTTP status'))  return 35;
  if (finding.includes('TTFB'))         return 12;
  if (finding.includes('Total load'))   return 10;
  if (finding.includes('HTML payload')) return 8;
  if (finding.includes('Canonical'))    return 8;
  if (finding.includes('Open Graph'))   return 6;
  if (finding.includes('Structured'))   return 6;
  if (finding.includes('manifest'))     return 4;
  if (finding.includes('cache-control') || finding.includes('ETag')) return 4;
  return 0;
}

function WebOptimizerPanel({ web, triggerAgent, triggering }) {
  if (!web) return null;

  const subEntries = Object.entries(web.subAgents || {});
  const isRunning  = triggering['web_optimizer'] || web.status === 'running';
  const latencyTarget = Math.max(20, Number(web.latencyTargetMs) || 80);
  const latencyColor = (value) => {
    if (value == null) return '#64748b';
    if (value > latencyTarget * 2) return '#f87171';
    if (value > latencyTarget) return '#fbbf24';
    return '#4ade80';
  };

  const ttfbColor = latencyColor(web.lastTtfbMs);
  const loadColor = latencyColor(web.lastTotalMs);
  const sizeKb    = web.lastBytes ? (web.lastBytes / 1024).toFixed(1) : null;
  // 450,000 bytes matches the "HTML payload heavier than target" threshold
  // in scoreWebsiteSnapshot on the backend — was 460*1024 (470,910 bytes)
  // here, which meant this metric could still read green while the
  // Findings list below was already flagging the payload as too heavy.
  const sizeColor = !sizeKb ? '#64748b' : web.lastBytes > 450000 ? '#f87171' : '#4ade80';
  const scoreColor = web.score >= 80 ? '#4ade80' : web.score >= 60 ? '#fbbf24' : '#f87171';

  return (
    <Card style={{ marginBottom: 28 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#60a5fa' }}>WEB</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Website Health</div>
            {web.lastRun && (
              <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>
                Last audit {fmtAgo(web.lastRun)}
                {web.publicUrl && <> · <a href={web.publicUrl} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'none' }}>{web.publicUrl}</a></>}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 24, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>
            {web.score != null ? `${web.score}/100` : '—'}
          </span>
          <Btn size="sm" variant="ghost" onClick={() => triggerAgent('web_optimizer')} disabled={isRunning}>
            {isRunning ? '...' : '↺ Re-run'}
          </Btn>
        </div>
      </div>

      {/* Metrics row */}
      <div style={{
        display: 'flex', gap: 24, flexWrap: 'wrap',
        padding: '10px 14px', background: 'rgba(255,255,255,.03)',
        borderRadius: 8, marginBottom: 16,
      }}>
        {[
          {
            label: 'TTFB',
            value: web.lastTtfbMs != null ? `${web.lastTtfbMs}ms` : '—',
            color: ttfbColor,
            title: web.lastInitialTtfbMs != null && web.lastInitialTtfbMs !== web.lastTtfbMs
              ? `Warm edge response. First pass: ${web.lastInitialTtfbMs}ms.`
              : `Target: ${latencyTarget}ms or less.`,
          },
          {
            label: 'Load',
            value: web.lastTotalMs != null ? `${web.lastTotalMs}ms` : '—',
            color: loadColor,
            title: `Target: ${latencyTarget}ms or less.`,
          },
          { label: 'Size',   value: sizeKb           != null ? `${sizeKb} KB`         : '—', color: sizeColor },
          { label: 'Status', value: web.lastStatus   ?? '—',
            color: !web.lastStatus ? '#64748b' : web.lastStatus < 400 ? '#4ade80' : '#f87171' },
        ].map(({ label, value, color, title }) => (
          <div key={label} title={title}>
            <div style={{ fontSize: 10, color: '#475569', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Findings */}
      <div style={{ marginBottom: 16 }}>
        <Label>Findings</Label>
        {!web.findings || web.findings.length === 0 ? (
          <div style={{ fontSize: 12, color: '#4ade80', marginTop: 8 }}>No issues found</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {web.findings.map((f, i) => {
              const pts = findingImpact(f);
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '7px 12px',
                  background: 'rgba(251,191,36,.06)', border: '1px solid rgba(251,191,36,.15)',
                  borderRadius: 7,
                }}>
                  <span style={{ fontSize: 12, color: '#fbbf24' }}>! {f}</span>
                  {pts > 0 && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#f87171', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      −{pts} pts
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sub-agent chips */}
      {subEntries.length > 0 && (
        <div>
          <Label>Audit Surfaces</Label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {subEntries.map(([id, sub]) => (
              <div key={id} style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '6px 11px',
                background: 'rgba(255,255,255,.04)',
                border: `1px solid ${sub.status === 'healthy' ? 'rgba(34,197,94,.2)' : sub.lastError ? 'rgba(239,68,68,.2)' : 'rgba(255,255,255,.07)'}`,
                borderRadius: 8,
              }}>
                <Dot ok={sub.status === 'healthy'} pulse={sub.status === 'running'} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1' }}>{SUB_AGENT_LABELS[id] || id}</div>
                  {sub.lastRun
                    ? <div style={{ fontSize: 10, color: '#475569' }}>{fmtAgo(sub.lastRun)}</div>
                    : <div style={{ fontSize: 10, color: '#334155' }}>not run</div>
                  }
                  {sub.lastError && (
                    <div style={{ fontSize: 10, color: '#f87171', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sub.lastError}>
                      {sub.lastError.slice(0, 60)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Overview view ────────────────────────────────────────────────────────────

function OverviewView({ status, pipelineStatus, log, agents, triggerAgent, triggering }) {
  const s = status?.server;
  const f = pipelineStatus?.feed || status?.feed;
  const a = status?.agents;
  const src = pipelineStatus?.sources || status?.sources;
  const apiWeb = status?.websiteOptimizer;
  const pipelineWeb = pipelineStatus?.websiteOptimizer;
  // Public-web checks belong to the API process, while the storage audit
  // intentionally runs only beside the source workers on pipeline. Present
  // both in one Overview card so "Storage" cannot look idle when its real
  // pipeline-owned audit is healthy.
  const web = apiWeb ? {
    ...apiWeb,
    subAgents: {
      ...(apiWeb.subAgents || {}),
      ...(pipelineWeb?.subAgents?.web_storage
        ? { web_storage: pipelineWeb.subAgents.web_storage }
        : {}),
    },
  } : pipelineWeb;
  const pausedWorkers = src?.workers?.filter(w => w.paused) || [];

  return (
    <>
      <h1 style={H1}>Command Center</h1>
      <p style={SUBTITLE}>Service health at a glance. Open the details when you need them.</p>

      {pausedWorkers.length > 0 && (
        <div style={{
          marginBottom: 20, padding: '10px 16px', borderRadius: 8,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#f87171' }}>!</span>
          <span style={{ fontSize: 12, color: '#fca5a5' }}>
            <strong>{pausedWorkers.length}</strong> source worker{pausedWorkers.length !== 1 ? 's' : ''} paused by circuit breaker
            {' - '}{pausedWorkers.map(w => `${badgeCode(w.name || w.id)} ${(w.name?.replace(' Agent','') || w.id)}`).join(', ')}
            {'. Will auto-resume in ~5min.'}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <StatCard icon="UP" label="Uptime"        value={s ? fmtUptime(s.uptime) : '—'}           sub={s?.env}                                                     color="#60a5fa" />
        <StatCard icon="FP" label="Feed Posts"    value={f?.postCount?.toLocaleString() ?? '—'}    sub={f?.refreshedAt ? `refreshed ${fmtAgo(f.refreshedAt)}` : null} color="#4ade80" />
        <StatCard icon="AG" label="Agents"        value={a?.active ?? '—'}                         sub={`${a?.logSize || 0} log entries`}                            color="#fbbf24" />
        <StatCard icon="DB" label="Primary database" value={s?.db === 'connected' ? 'Live' : s?.db === 'fallback' ? 'Memory' : '—'} sub={s?.dbReadFailoverActive ? 'read failover active' : s?.db} color={s?.db === 'connected' ? '#4ade80' : '#f97316'} />
        <StatCard icon="SSE" label="SSE Clients"  value={f?.sseClients ?? '—'}                     sub="feed subscribers"                                            color="#a78bfa" />
        <StatCard
          icon="SRC"
          label="Sources"
          value={src ? `${src.healthy}/${src.total}` : '—'}
          sub={src?.paused ? `${src.paused} paused` : src?.starting ? `${src.starting} starting` : 'all healthy'}
          color={src?.paused ? '#f97316' : src?.starting ? '#94a3b8' : '#4ade80'}
        />
      </div>

      <RecoveryOverview server={s} />

      <details className="office-overview-detail">
        <summary>Website diagnostics</summary>
        <WebOptimizerPanel web={web} triggerAgent={triggerAgent} triggering={triggering} />
      </details>

      <details className="office-overview-detail">
      <summary>Agent status <span>{Object.keys(agents).length} agents</span></summary>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
        gap: 10, margin: '12px 0 28px',
      }}>
        {Object.entries(agents).map(([id, ag]) => (
          <Card key={id} style={{ padding: '13px 15px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 10, lineHeight: 1.5, flexShrink: 0, fontWeight: 800, color: ag.color || '#94a3b8', minWidth: 24 }}>
              {badgeCode(ag.name || id, 'AG')}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: ag.color }}>{ag.name}</div>
              <div style={{
                fontSize: 11, color: '#64748b', marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {ag.lastAction?.msg || 'Standby...'}
              </div>
            </div>
            <HealthBadge health={ag.health} />
          </Card>
        ))}
      </div>
      </details>

      <details className="office-overview-detail">
      <summary>Live activity <span>{log.length} entries</span></summary>
      <Card style={{ padding: 0, marginTop: 12 }}>
        <div style={{
          padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,.05)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Dot ok pulse />
          <span style={{ fontSize: 12, color: '#64748b' }}>Live · {log.length} entries</span>
        </div>
        <div style={{ maxHeight: 400, overflowY: 'auto', padding: '4px 16px 12px' }}>
          {log.length === 0
            ? <div style={{ textAlign: 'center', color: '#475569', fontSize: 13, padding: 36 }}>Connecting to agent stream...</div>
            : log.map(e => <LogEntry key={e.id} entry={e} />)
          }
        </div>
      </Card>
      </details>
    </>
  );
}

// ─── Agents view ──────────────────────────────────────────────────────────────

function HealthBadge({ health }) {
  if (!health) return null;
  const cfg = {
    healthy:  { bg: 'rgba(34,197,94,.12)',  color: '#4ade80', label: 'Healthy' },
    ready:    { bg: 'rgba(34,197,94,.12)',  color: '#4ade80', label: 'Ready' },
    armed:    { bg: 'rgba(34,197,94,.12)',  color: '#4ade80', label: 'Armed' },
    idle:     { bg: 'rgba(56,189,248,.1)',  color: '#38bdf8', label: 'Idle' },
    running:  { bg: 'rgba(56,189,248,.12)', color: '#38bdf8', label: 'Running' },
    skipped:  { bg: 'rgba(251,191,36,.12)', color: '#fbbf24', label: 'Skipped' },
    fallback: { bg: 'rgba(56,189,248,.1)',  color: '#38bdf8', label: 'Fallback' },
    contained:{ bg: 'rgba(168,85,247,.12)', color: '#c084fc', label: 'Contained' },
    pressure: { bg: 'rgba(251,191,36,.12)', color: '#fbbf24', label: 'Pressure' },
    critical: { bg: 'rgba(239,68,68,.1)',   color: '#f87171', label: 'Critical' },
    degraded: { bg: 'rgba(251,191,36,.12)', color: '#fbbf24', label: 'Degraded' },
    paused:   { bg: 'rgba(239,68,68,.1)',   color: '#f87171', label: 'Paused' },
    gated:    { bg: 'rgba(148,163,184,.12)',color: '#94a3b8', label: 'Gated' },
    unavailable: { bg: 'rgba(148,163,184,.12)', color: '#94a3b8', label: 'Unavailable' },
    unknown: { bg: 'rgba(148,163,184,.12)', color: '#94a3b8', label: 'Not reported' },
  }[health.status] || { bg: 'rgba(148,163,184,.1)', color: '#94a3b8', label: '—' };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
      background: cfg.bg, color: cfg.color, textTransform: 'uppercase', letterSpacing: 0.8,
    }}>
      {cfg.label}
    </span>
  );
}

function AgentsView({ agents, triggerAgent, triggering }) {
  return (
    <>
      <h1 style={H1}>Agent Control</h1>
      <p style={SUBTITLE}>Inspect registered workers and processing stages. Agents run on their reported schedules or on demand; manual actions are available where supported.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))', gap: 18 }}>
        {Object.entries(agents).map(([id, ag]) => {
          const isPaused = ag.health?.status === 'paused';
          return (
            <Card key={id} style={isPaused ? { borderColor: 'rgba(239,68,68,.25)' } : {}}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 28, lineHeight: 1 }}>{ag.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: ag.color }}>{ag.name}</span>
                    <HealthBadge health={ag.health} />
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>
                    id: <code style={{ ...CODE, padding: '1px 5px' }}>{id}</code>
                    {' · '}runs every {ag.interval}
                    {ag.postCount != null && <> · <span style={{ color: '#60a5fa' }}>{ag.postCount.toLocaleString()} posts</span></>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {ag.triggerable === false ? <span style={{ fontSize: 11, color: '#94a3b8' }}>Read only</span> :
                    <Btn size="sm" variant={isPaused ? 'danger' : 'ghost'} onClick={() => triggerAgent(id)} disabled={triggering[id]}>
                      {triggering[id] ? '...' : isPaused ? '↺ Reset' : '▶ Run'}
                    </Btn>}
                </div>
              </div>
              <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.65, margin: '0 0 14px' }}>
                {ag.description}
              </p>
              {ag.health && (
                <div style={{
                  display: 'flex', gap: 16, marginBottom: 12, padding: '7px 10px',
                  background: 'rgba(255,255,255,.03)', borderRadius: 6,
                  fontSize: 11, color: '#475569',
                }}>
                  <span>Fetches: <strong style={{ color: '#94a3b8' }}>{ag.health.fetchCount?.toLocaleString() ?? 'Not reported'}</strong></span>
                  <span>Errors: <strong style={{ color: ag.health.totalErrors ? '#f87171' : '#94a3b8' }}>{ag.health.totalErrors ?? 'Not reported'}</strong></span>
                  {ag.lastFetch && <span>Last fetch: <strong style={{ color: '#94a3b8' }}>{fmtAgo(ag.lastFetch)}</strong></span>}
                </div>
              )}
              <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
                <Label>Last 5 actions</Label>
                <div style={{ marginTop: 8 }}>
                  {(ag.logs || []).slice(0, 5).map(e => (
                    <div key={e.id} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 11, alignItems: 'flex-start' }}>
                      <span style={{ flexShrink: 0 }}>{e.emoji}</span>
                      <span style={{ color: e.color, flex: 1, lineHeight: 1.5 }}>{e.msg}</span>
                      <span style={{ color: '#475569', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtAgo(e.ts)}</span>
                    </div>
                  ))}
                  {(!ag.logs || ag.logs.length === 0) && (
                    <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>No recent activity reported.</div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ─── Deploy view ──────────────────────────────────────────────────────────────

function DeployView({ triggerDeploy, deploying, log }) {
  const services = [
    {
      slug: 'api',
      name: 'Backend API',
      desc: 'Node.js Express — REST API + agent system',
      url: 'https://api.uficonnect.org',
      health: 'https://api.uficonnect.org/health',
      icon: 'API',
      hook: 'RENDER_HOOK_API',
    },
    {
      slug: 'web',
      name: 'Web Frontend',
      desc: 'React SPA — main user-facing app',
      url: 'https://uficonnect.org',
      icon: 'WEB',
      hook: 'RENDER_HOOK_WEB',
    },
    {
      slug: 'office',
      name: 'Office',
      desc: 'This dashboard — operations & monitoring',
      url: 'https://office.uficonnect.org',
      icon: 'OFF',
      hook: 'RENDER_HOOK_OFFICE',
    },
    {
      slug: 'pipeline',
      name: 'Pipeline',
      desc: 'Same codebase as Backend API (SERVICE_ROLE=pipeline) — does all external-source fetching',
      url: 'https://uficonnect-pipeline-708r.onrender.com',
      health: 'https://uficonnect-pipeline-708r.onrender.com/health',
      icon: 'PIPE',
      hook: 'RENDER_HOOK_PIPELINE',
    },
  ];

  const deployLogs = log.filter(e => e.agentId === 'deploy').slice(0, 8);

  return (
    <>
      <h1 style={H1}>Deploy Center</h1>
      <p style={SUBTITLE}>
        Push to <strong style={{ color: '#e2e8f0' }}>main</strong> to verify and deploy every service, or redeploy a verified service here.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 13, maxWidth: 680, marginBottom: 30 }}>
        {services.map(({ slug, name, desc, url, icon, hook }) => (
          <Card key={slug} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 800, flexShrink: 0, color: '#60a5fa', minWidth: 34 }}>{icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>{name}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{desc}</div>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 11, color: '#3b82f6', marginTop: 3, display: 'block' }}
              >
                {url} ↗
              </a>
              <div style={{ fontSize: 10, color: '#334155', marginTop: 3 }}>
                Hook env: <code style={{ ...CODE, fontSize: 10 }}>{hook}</code>
              </div>
            </div>
            <Btn onClick={() => triggerDeploy(slug)} disabled={deploying[slug]}>
              {deploying[slug] ? 'Deploying...' : 'Deploy Now'}
            </Btn>
          </Card>
        ))}
      </div>

      <Card style={{ maxWidth: 680, background: '#0a1628', borderColor: 'rgba(59,130,246,.18)', marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', marginBottom: 10 }}>
          Verified Deployment Gate
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.8 }}>
          Every push to <code style={CODE}>main</code> runs <em>Verify UFIconnect</em>. Only a successful, still-current commit is sent to Render through the protected GitHub environment hooks.
          <br />
          The <em>Deploy Now</em> buttons dispatch that same guarded workflow when <code style={CODE}>OFFICE_GITHUB_TOKEN</code> has Actions write access.
          <br />
          GitHub environment secrets: <code style={CODE}>RENDER_HOOK_API</code> · <code style={CODE}>RENDER_HOOK_WEB</code> · <code style={CODE}>RENDER_HOOK_OFFICE</code> · <code style={CODE}>RENDER_HOOK_PIPELINE</code>.
          Render blueprint auto-deploy remains disabled so an unverified commit cannot bypass this gate.
        </div>
      </Card>

      {deployLogs.length > 0 && (
        <>
          <Label color="#475569">Recent Deploy Activity</Label>
          <Card style={{ marginTop: 12, maxWidth: 680, padding: '12px 16px' }}>
            {deployLogs.map(e => <LogEntry key={e.id} entry={e} />)}
          </Card>
        </>
      )}
    </>
  );
}

// ─── Autofix view ─────────────────────────────────────────────────────────────

const AUTOFIX_STATUS_COLOR = {
  detected: '#94a3b8', rejected: '#64748b', deploying: '#38bdf8',
  verifying: '#fbbf24', verified: '#4ade80', reverted: '#f87171',
};

function AutofixView() {
  const [data, setData] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await officeFetch(`${API}/office/autofix/attempts`);
      setData(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const toggle = async () => {
    setToggling(true);
    try {
      const r = await officeFetch(`${API}/office/autofix/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !data?.enabled }),
      });
      setData(await r.json());
    } catch {}
    setToggling(false);
    load();
  };

  if (!data) return (<><h1 style={H1}>Autofix</h1><p style={SUBTITLE}>Loading…</p></>);

  const attempts = data.attempts || [];

  return (
    <>
      <h1 style={H1}>Autofix</h1>
      <p style={SUBTITLE}>
        Groups server errors by signature; once the same bug clears a distinct-session
        threshold, a single narrow fix category (null-guard) is checked against a hard
        scope/denylist gate, syntax- and boot-smoke-tested, then committed via GitHub —
        with an automatic revert if health regresses afterward. Detection always runs;
        committing anything requires the switch below.
      </p>

      <Card style={{ display: 'flex', alignItems: 'center', gap: 16, maxWidth: 680, marginBottom: 20 }}>
        <span style={{ fontSize: 12, fontWeight: 800, flexShrink: 0, color: '#38bdf8', minWidth: 34 }}>FIX</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>
            Autofix is {data.enabled ? 'ENABLED' : 'disabled'}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {data.enabled
              ? 'Eligible candidates can be committed, verified, and deployed.'
              : 'Detection and logging still run — nothing gets committed while off.'}
          </div>
        </div>
        <Btn onClick={toggle} disabled={toggling} variant={data.enabled ? 'danger' : 'primary'}>
          {toggling ? 'Working…' : data.enabled ? 'Disable' : 'Enable'}
        </Btn>
      </Card>

      <div style={{ display: 'flex', gap: 13, maxWidth: 680, marginBottom: 24 }}>
        <Card style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 }}>Deploys today</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', marginTop: 4 }}>{data.deploysToday ?? 0} / {data.maxPerDay}</div>
        </Card>
        <Card style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 }}>Deploys this week</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', marginTop: 4 }}>{data.deploysThisWeek ?? 0} / {data.maxPerWeek}</div>
        </Card>
        <Card style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.6 }}>Reverts (all time)</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: data.totalReverts ? '#f87171' : '#f1f5f9', marginTop: 4 }}>{data.totalReverts ?? 0}</div>
        </Card>
      </div>

      <Label color="#475569">Recent Attempts</Label>
      <div style={{ maxWidth: 680, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {attempts.length === 0 && (
          <Card style={{ color: '#64748b', fontSize: 13 }}>No attempts yet — nothing has cleared the detection threshold.</Card>
        )}
        {attempts.map(a => (
          <Card key={a.id} style={{ padding: '12px 16px', cursor: 'pointer' }} onClick={() => setExpanded(expanded === a.id ? null : a.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5,
                color: AUTOFIX_STATUS_COLOR[a.status] || '#94a3b8',
                border: `1px solid ${AUTOFIX_STATUS_COLOR[a.status] || '#94a3b8'}`,
                borderRadius: 4, padding: '2px 6px', flexShrink: 0,
              }}>{a.status}</span>
              <code style={{ ...CODE, fontSize: 11 }}>{a.signature}</code>
              <span style={{ fontSize: 12, color: '#64748b' }}>{a.session_count} session(s)</span>
              <span style={{ fontSize: 11, color: '#334155', marginLeft: 'auto' }}>
                {a.source_file}{a.source_line ? `:${a.source_line}` : ''}
              </span>
            </div>
            {expanded === a.id && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8', lineHeight: 1.7 }}>
                {a.reject_reason && <div>Reject reason: <span style={{ color: '#e2e8f0' }}>{a.reject_reason}</span></div>}
                {a.revert_reason && <div>Revert reason: <span style={{ color: '#f87171' }}>{a.revert_reason}</span></div>}
                {a.commit_sha && (
                  <div>Commit: <code style={{ ...CODE, fontSize: 10 }}>{String(a.commit_sha).slice(0, 10)}</code></div>
                )}
                {a.revert_commit_sha && (
                  <div>Revert commit: <code style={{ ...CODE, fontSize: 10 }}>{String(a.revert_commit_sha).slice(0, 10)}</code></div>
                )}
                {a.diff_text && (
                  <pre style={{ background: '#0a0a12', border: '1px solid rgba(255,255,255,.06)', borderRadius: 6, padding: 10, marginTop: 6, overflowX: 'auto', fontSize: 11, whiteSpace: 'pre-wrap' }}>{a.diff_text}</pre>
                )}
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

// ─── Analytics view ───────────────────────────────────────────────────────────

function AnalyticsView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [users, setUsers] = useState(null);
  const [usersError, setUsersError] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadUsers = useCallback(() => {
    officeFetch(`${API}/office/users`)
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Unable to load user analytics');
        return body;
      })
      .then(j => { setUsers(j); setUsersError(false); })
      .catch(() => setUsersError(true));
  }, []);

  const loadAnalytics = useCallback(() => {
    officeFetch(`${API}/office/analytics/pageviews`)
      .then(async r => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'Unable to load pageview analytics');
        return body;
      })
      .then(j => { setData(j); setError(false); })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    loadAnalytics();
    loadUsers();
    const id = window.setInterval(() => { loadAnalytics(); loadUsers(); }, 30000);
    return () => window.clearInterval(id);
  }, [loadAnalytics, loadUsers]);

  async function handleDeleteUser(u) {
    if (!window.confirm(`Permanently delete "${u.name}" (${u.email})? This removes their account, posts, and follows — cannot be undone.`)) return;
    setDeletingId(u.id);
    try {
      const r = await officeFetch(`${API}/office/users/${u.id}`, { method: 'DELETE' });
      const j = await r.json();
      if (j.deleted) loadUsers();
      else alert('Delete failed — see server logs.');
    } catch {
      alert('Delete failed — see server logs.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <h1 style={H1}>Analytics</h1>
      <p style={SUBTITLE}>Aggregate page and app-screen counts, service performance, and optional diagnostic reports. Counts use UTC calendar days and do not identify individual visitors. Optional Google Analytics reports are separate.</p>

      {error && <Card style={{ maxWidth: 520 }}><div style={{ color: '#f87171', fontSize: 13 }}>Couldn't load analytics.</div></Card>}

      {!data && !error && <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div>}

      {data && !data.available && (
        <Card style={{ maxWidth: 520 }}>
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Database not connected — pageview logging is disabled until DATABASE_URL is set.</div>
        </Card>
      )}

      {/* Registered users — pageviews above count anonymous visits, so on
          their own they say nothing about how many of those visits actually
          became an account. This is the other half of that picture. */}
      <Label color="#475569">Registered Users</Label>
      {usersError && <Card style={{ maxWidth: 520, marginTop: 12, marginBottom: 28 }}><div style={{ color: '#f87171', fontSize: 13 }}>Couldn't load user stats.</div></Card>}
      {!users && !usersError && <div style={{ color: '#64748b', fontSize: 13, margin: '12px 0 28px' }}>Loading…</div>}
      {users && !users.available && (
        <Card style={{ maxWidth: 520, marginTop: 12, marginBottom: 28 }}>
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Database not connected — no registered users can be persisted until DATABASE_URL is set.</div>
        </Card>
      )}
      {users && users.available && (
        <>
          <div style={{ display: 'flex', gap: 16, margin: '12px 0 20px', flexWrap: 'wrap' }}>
            <Card style={{ minWidth: 150 }}>
              <Label>Registered accounts</Label>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#60a5fa', marginTop: 6 }}>{users.total}</div>
            </Card>
            <Card style={{ minWidth: 150 }}>
              <Label>Completed onboarding</Label>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#4ade80', marginTop: 6 }}>{users.onboarded}</div>
            </Card>
            <Card style={{ minWidth: 150 }}>
              <Label>New today</Label>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#e2e8f0', marginTop: 6 }}>{users.today}</div>
            </Card>
            <Card style={{ minWidth: 150 }}>
              <Label>New last 7 days</Label>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#e2e8f0', marginTop: 6 }}>{users.last7}</div>
            </Card>
          </div>

          <div style={{ fontSize: 11.5, color: '#64748b', margin: '-8px 0 18px' }}>
            Account totals describe registered accounts. Aggregate usage counts are reported separately and are not linked to these accounts.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0 28px', maxWidth: 680 }}>
            {users.recent.length === 0 && (
              <Card style={{ color: '#64748b', fontSize: 13 }}>No signups yet.</Card>
            )}
            {users.recent.map(u => (
              <Card key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 18px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                  <div style={{ fontSize: 11.5, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: u.onboarded ? 'rgba(74,222,128,.12)' : 'rgba(251,191,36,.12)', color: u.onboarded ? '#4ade80' : '#fbbf24', whiteSpace: 'nowrap' }}>
                  {u.onboarded ? 'onboarded' : 'incomplete'}
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{new Date(u.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                <button
                  onClick={() => handleDeleteUser(u)}
                  disabled={deletingId === u.id}
                  title="Delete this account"
                  style={{
                    background: 'none', border: 'none', cursor: deletingId === u.id ? 'default' : 'pointer',
                    color: '#f87171', fontSize: 13, opacity: deletingId === u.id ? 0.5 : 1, padding: '2px 4px',
                  }}
                >
                  {deletingId === u.id ? '...' : 'Delete'}
                </button>
              </Card>
            ))}
          </div>
        </>
      )}

      {data?.mode === 'aggregate' && data.service && (
        <Card style={{ marginBottom: 24 }}>
          <Label>Service performance</Label>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '8px 0' }}>
            {Number(data.service.total || 0).toLocaleString()} completed requests since this API process started.
            {' '}These counters reset when the process restarts and do not represent all server instances.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {(data.service.responses || []).map(row => <div key={`${row.statusClass}-${row.durationBucket}`} style={{ color: '#cbd5e1', fontSize: 12 }}>
              {row.statusClass} · {row.durationBucket}: {Number(row.count || 0).toLocaleString()}
            </div>)}
          </div>
        </Card>
      )}
      {data?.available && data.mode !== 'aggregate' && (
        <Card style={{ marginBottom: 24, fontSize: 13, color: '#fbbf24' }}>Aggregate analytics is unavailable from this API release. Deploy the matching backend to view the new reports.</Card>
      )}
      {data && data.available && data.mode === 'aggregate' && (
        <>
          <Label color="#475569">Page and screen views · UTC calendar days</Label>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '8px 0' }}>Repeat visits count again. These totals are not unique people or signed-in members.</p>
          <div style={{ display: 'flex', gap: 16, margin: '12px 0 28px', flexWrap: 'wrap' }}>
            <Card style={{ minWidth: 150 }}>
              <Label>Today</Label>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#60a5fa', marginTop: 6 }}>{data.today}</div>
            </Card>
            <Card style={{ minWidth: 150 }}>
              <Label>Last 7 days</Label>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#4ade80', marginTop: 6 }}>{data.last7}</div>
            </Card>
            <Card style={{ minWidth: 150 }}>
              <Label>Last 30 days</Label>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#e2e8f0', marginTop: 6 }}>{data.last30}</div>
            </Card>
            <Card style={{ minWidth: 150 }}>
              <Label>Optional diagnostics · 30d</Label>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#c084fc', marginTop: 6 }}>{data.performance?.last30 ?? 0}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Reports from people who enabled performance insights</div>
            </Card>
          </div>

          {(data.performance?.byCode || []).length > 0 && (
            <Card style={{ marginBottom: 24 }}>
              <Label>Optional performance insights · 30 days</Label>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
                {data.performance.byCode.map(row => <div key={row.code} style={{ color: '#cbd5e1', fontSize: 12 }}>
                  {row.code.replaceAll('_', ' ')}: {Number(row.count || 0).toLocaleString()}
                </div>)}
              </div>
            </Card>
          )}
          <Label color="#475569">Top page and screen categories (30d)</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '12px 0 28px', maxWidth: 680 }}>
            {data.topPaths.length === 0 && (
              <Card style={{ color: '#64748b', fontSize: 13 }}>No pageviews logged yet.</Card>
            )}
            {data.topPaths.map(p => (
              <Card key={p.path} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 18px' }}>
                <div style={{ flex: 1, fontSize: 13, fontFamily: 'monospace', color: '#cbd5e1' }}>{p.path}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa' }}>{p.views}</div>
              </Card>
            ))}
          </div>

          <Label color="#475569">Daily (30d)</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '12px 0 28px', maxWidth: 680 }}>
            {data.daily.length === 0 && (
              <Card style={{ color: '#64748b', fontSize: 13 }}>No history yet.</Card>
            )}
            {data.daily.slice().reverse().map(d => (
              <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#94a3b8', padding: '4px 0' }}>
                <div style={{ width: 90 }}>{d.day}</div>
                <div style={{ flex: 1, background: 'rgba(255,255,255,.05)', borderRadius: 4, height: 14, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, (d.views / Math.max(...data.daily.map(x => x.views), 1)) * 100)}%`,
                    background: '#3b82f6', height: '100%',
                  }} />
                </div>
                <div style={{ width: 40, textAlign: 'right', color: '#e2e8f0', fontWeight: 600 }}>{d.views}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ─── Versions view ────────────────────────────────────────────────────────────

function VersionsView({ versions, status, pipelineStatus }) {
  // Real reachability for the two services we actually have live status
  // for — was a hardcoded <Dot ok pulse /> on every row regardless of
  // actual health before this, which is exactly the kind of thing that let
  // pipeline sit stale for 8+ days with nothing here ever flagging it. web/
  // office are static hosting with no equivalent /office/status signal
  // wired up, so they stay unlabeled rather than faking a green dot for them too.
  const HEALTH = {
    api:      { known: true,  ok: !!status?.server,         uptime: status?.server?.uptime },
    pipeline: { known: true,  ok: !!pipelineStatus?.server,  uptime: pipelineStatus?.server?.uptime },
  };
  const repos = [
    {
      name: 'UFIConnect Monorepo',
      desc: 'Backend (Node.js) · Web (React) · Mobile (Expo) · Office (React)',
      url: 'https://github.com/UFIConnect/UFIConnect',
      icon: 'PKG',
    },
  ];

  return (
    <>
      <h1 style={H1}>Versions & Repositories</h1>
      <p style={SUBTITLE}>Installed versions, live service URLs, code repositories, and update instructions.</p>

      {versions ? (
        <>
          <Card style={{ maxWidth: 520, marginBottom: 20, display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <div>
              <Label>Backend Version</Label>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#60a5fa', marginTop: 6 }}>
                v{versions.backend.version}
              </div>
            </div>
            <div>
              <Label>Node.js</Label>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#4ade80', marginTop: 6 }}>
                {versions.backend.node}
              </div>
            </div>
            <div>
              <Label>Package</Label>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>{versions.backend.name}</div>
            </div>
          </Card>

          <Label color="#475569">Live Services</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '12px 0 28px', maxWidth: 680 }}>
            {versions.services.map(svc => {
              const h = HEALTH[svc.slug];
              return (
              <Card key={svc.slug} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px' }}>
                {h?.known ? <Dot ok={h.ok} pulse={h.ok} /> : <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#334155', flexShrink: 0 }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{svc.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>
                    {svc.domain}
                    {h?.known && (h.ok
                      ? ` · up ${formatUptime(h.uptime)}`
                      : ' · unreachable')}
                  </div>
                </div>
                <a
                  href={svc.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: '7px 16px', borderRadius: 7,
                    border: '1px solid rgba(59,130,246,.3)',
                    color: '#60a5fa', fontSize: 12, textDecoration: 'none', fontWeight: 600,
                  }}
                >
                  Open ↗
                </a>
              </Card>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ color: '#475569', fontSize: 14, marginBottom: 28 }}>Loading version info...</div>
      )}

      <Label color="#475569">Repositories</Label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '12px 0 28px', maxWidth: 680 }}>
        {repos.map(r => (
          <Card key={r.name}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 22 }}>{r.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{r.desc}</div>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12, color: '#3b82f6', marginTop: 4, display: 'block' }}
                >
                  {r.url} ↗
                </a>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Label color="#475569">Installing New Versions</Label>
      <Card style={{ marginTop: 12, maxWidth: 680, background: '#081a10', borderColor: 'rgba(34,197,94,.15)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#4ade80', marginBottom: 10 }}>
          How to Update Any Service
        </div>
        <ol style={{ fontSize: 12, color: '#94a3b8', lineHeight: 2.1, paddingLeft: 20 }}>
          <li>Make your code changes locally in the repo</li>
          <li>Commit: <code style={CODE}>git commit -m "your change"</code></li>
          <li>Push: <code style={CODE}>git push origin main</code></li>
          <li>GitHub verifies the current main commit and then triggers the Render hooks</li>
          <li>Or use the Deploy Center tab to redeploy the already-verified commit</li>
        </ol>
        <div style={{ marginTop: 12, fontSize: 11, color: '#334155' }}>
          API, Web, Office, and Pipeline each have a Render build; one successful main verification deploys all four.
        </div>
      </Card>
    </>
  );
}

// ─── Sources view ─────────────────────────────────────────────────────────────

function SourcesView({ status, triggerAgent, triggering }) {
  const src = status?.sources;
  const workers = src?.workers || [];

  const statusCfg = {
    starting: { dot: '#64748b', bg: 'rgba(148,163,184,.07)', border: 'rgba(148,163,184,.16)', label: 'Starting' },
    healthy:  { dot: '#22c55e', bg: 'rgba(34,197,94,.08)',  border: 'rgba(34,197,94,.18)',  label: 'Healthy' },
    fallback: { dot: '#38bdf8', bg: 'rgba(56,189,248,.08)', border: 'rgba(56,189,248,.2)', label: 'Fallback' },
    ready:    { dot: '#22c55e', bg: 'rgba(34,197,94,.08)',  border: 'rgba(34,197,94,.18)',  label: 'Ready' },
    degraded: { dot: '#f59e0b', bg: 'rgba(251,191,36,.07)', border: 'rgba(251,191,36,.2)',  label: 'Degraded' },
    paused:   { dot: '#ef4444', bg: 'rgba(239,68,68,.07)',  border: 'rgba(239,68,68,.22)',  label: 'Paused' },
    pro:      { dot: '#f59e0b', bg: 'rgba(245,158,11,.07)', border: 'rgba(245,158,11,.2)',  label: 'Pro' },
    gated:    { dot: '#64748b', bg: 'rgba(148,163,184,.06)', border: 'rgba(148,163,184,.18)', label: 'Gated' },
  };

  return (
    <>
      <h1 style={H1}>Live Sources</h1>
      <p style={SUBTITLE}>Real-time health of all {src?.total ?? 'data'} sources, including public workers, curated fallback agents, and Pro OAuth-authenticated per-user sources.</p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <StatCard icon="SRC" label="Total Sources"  value={src?.total ?? '—'}    sub="active workers"            color="#60a5fa" />
        <StatCard icon="OK" label="Healthy"         value={src?.healthy ?? '—'}  sub="fetching or fallback-backed" color="#4ade80" />
        <StatCard icon="⏳" label="Starting"         value={src?.starting ?? '—'} sub="awaiting first fetch"       color="#94a3b8" />
        <StatCard icon="!" label="Degraded"         value={src?.degraded ?? '—'} sub=">=3 consecutive errors"    color="#fbbf24" />
        <StatCard icon="PZ" label="Paused"          value={src?.paused ?? '—'}   sub="circuit breaker tripped"   color="#f87171" />
        <StatCard icon="POST" label="Total Seen"
          value={workers.reduce((s, w) => s + (w.postCount || 0), 0).toLocaleString()}
          sub="posts across all sources" color="#a78bfa" />
      </div>

      {workers.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 13, color: '#475569' }}>Workers starting up... check back in a few seconds.</div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {workers.map(w => {
            const cfg = statusCfg[w.status] || statusCfg.healthy;
            const errorRate = w.fetchCount > 0 ? ((w.totalErrors / w.fetchCount) * 100).toFixed(1) : '0.0';
            return (
              <div key={w.id} style={{
                background: cfg.bg, border: `1px solid ${cfg.border}`,
                borderRadius: 10, padding: '14px 16px',
                display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, lineHeight: 1, fontWeight: 800, minWidth: 22, color: w.color || '#e2e8f0' }}>
                    {badgeCode(w.name || w.id, 'SRC')}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: w.color || '#e2e8f0' }}>
                      {w.name?.replace(' Agent', '') || w.id}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>{w.id}</div>
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20,
                    background: cfg.border, color: cfg.dot, textTransform: 'uppercase', letterSpacing: 0.8,
                  }}>
                    {cfg.label}
                  </span>
                  <span style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: cfg.dot,
                    boxShadow: w.status === 'healthy' ? `0 0 0 3px ${cfg.dot}33` : 'none',
                    animation: w.status === 'healthy' ? 'pulse 2s ease-in-out infinite' : 'none',
                  }} />
                </div>

                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#64748b', flexWrap: 'wrap' }}>
                  <span>In <strong style={{ color: '#e2e8f0' }}>{(w.postCount || 0).toLocaleString()}</strong> posts</span>
                  <span>Fetches <strong style={{ color: '#e2e8f0' }}>{(w.fetchCount || 0).toLocaleString()}</strong></span>
                  <span>Err <strong style={{ color: w.totalErrors ? '#f87171' : '#4ade80' }}>{errorRate}%</strong></span>
                </div>

                {(w.cadence || w.refreshTtlMinutes) && (
                  <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.45 }}>
                    {w.cadence && <>Scheduled {w.cadence}</>}
                    {w.cycleMinutes != null && <> · full topic cycle {w.cycleMinutes}m</>}
                    {w.refreshTtlMinutes != null && <> · live refresh TTL {w.refreshTtlMinutes}m</>}
                  </div>
                )}

                {w.isConnectedSource ? (
                  <div style={{ fontSize: 10, color: '#22c55e', padding: '4px 8px', background: 'rgba(34,197,94,.06)', borderRadius: 4 }}>
                    Connected-account source — live requests run when a user connects this account.
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: '#475569' }}>
                      <span>{w.lastSuccess ? `Last ok: ${fmtAgo(w.lastSuccess)}` : 'No successful fetch yet'}</span>
                      <button
                        onClick={() => triggerAgent(w.id)}
                        disabled={triggering[w.id]}
                        style={{
                          fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 5, border: 'none', cursor: 'pointer',
                          background: w.paused ? 'rgba(239,68,68,.15)' : 'rgba(59,130,246,.1)',
                          color: w.paused ? '#f87171' : '#60a5fa',
                        }}
                      >
                        {triggering[w.id] ? '...' : w.paused ? 'Reset' : 'Run'}
                      </button>
                    </div>
                    {w.paused && (
                      <div style={{ fontSize: 10, color: '#f87171', padding: '4px 8px', background: 'rgba(239,68,68,.06)', borderRadius: 4 }}>
                        Paused - {w.consecutiveErrors} consecutive errors. Auto-resumes in ~5 min.
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Feed Manager: sort helper + transfer helper ───────────────────────────────
// Sort helper: makes the existing per-source cap and sort/distribution
// agents actually visible instead of trusted blindly — shows the live
// composition of the shared feed cache and lets you trigger a re-sort.
// Transfer helper: a safer, visible way to push fresh content from the
// office's source workers into the site than the old blind trigger button —
// shows real progress (which source, how many done) instead of firing and
// hoping, and the underlying refresh queue is paced so it can't reproduce
// the concurrent-load crash from triggering everything at once.

const COMPOSITION_COLORS = [
  '#60a5fa', '#4ade80', '#f59e0b', '#f87171', '#a78bfa', '#38bdf8',
  '#fb923c', '#e879f9', '#34d399', '#facc15', '#818cf8', '#f472b6',
];

function SortHelperPanel({ status, triggerAgent, triggering }) {
  const composition = status?.feed?.composition || [];
  const sortAgent = status?.sortAgent;
  const distrib = status?.sortDistributionAgent;
  const mixOptimizer = status?.mixOptimizer;
  const sortOptimizer = status?.sortOptimizer;
  const cap18 = 18; // matches SRC_CAP in handleFeedRequest — ranked/newest/popular modes

  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <Label color="#a78bfa">Sort Helper</Label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Btn size="sm" variant="ghost" onClick={() => triggerAgent('sort_agent')} disabled={triggering.sort_agent}>
            {triggering.sort_agent ? '...' : 'Re-sort now'}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => triggerAgent('sort_distrib')} disabled={triggering.sort_distrib}>
            {triggering.sort_distrib ? '...' : 'Re-diversify now'}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => triggerAgent('mix_optimizer')} disabled={triggering.mix_optimizer}>
            {triggering.mix_optimizer ? '...' : 'Audit mix now'}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => triggerAgent('sort_optimizer')} disabled={triggering.sort_optimizer}>
            {triggering.sort_optimizer ? '...' : 'Audit ranking now'}
          </Btn>
        </div>
      </div>
      <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 16px' }}>
        Live composition of the shared feed cache. Any one source is capped at ≤{cap18}% of what a
        user actually sees (≤10% in Balanced sort) regardless of how large its share is here.
      </p>

      {composition.length === 0 ? (
        <div style={{ fontSize: 12, color: '#475569' }}>No posts cached yet.</div>
      ) : (
        <>
          <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', marginBottom: 10 }}>
            {composition.map((c, i) => (
              <div key={c.source} title={`${c.source}: ${c.pct}%`}
                style={{ width: `${c.pct}%`, background: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length], minWidth: c.pct > 0 ? 2 : 0 }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginBottom: 18 }}>
            {composition.map((c, i) => (
              <div key={c.source} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length], flexShrink: 0 }} />
                <span style={{ color: '#94a3b8' }}>{c.source}</span>
                <strong style={{ color: c.pct > cap18 ? '#fbbf24' : '#e2e8f0' }}>{c.pct}%</strong>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', fontSize: 11, color: '#64748b' }}>
          <Label>Sort Agent</Label>
          <div style={{ marginTop: 4, color: '#e2e8f0' }}>{(sortAgent?.totalRuns ?? 0).toLocaleString()} runs · last {sortAgent?.lastDurationMs ?? 0}ms</div>
          <div style={{ marginTop: 2 }}>{sortAgent?.lastRun ? `Last ran ${fmtAgo(sortAgent.lastRun)}` : 'Not run yet'}</div>
        </div>
        <div style={{ flex: '1 1 200px', fontSize: 11, color: '#64748b' }}>
          <Label>Distribution Agent</Label>
          <div style={{ marginTop: 4, color: '#e2e8f0' }}>{(distrib?.totalRuns ?? 0).toLocaleString()} runs</div>
          <div style={{ marginTop: 2 }}>
            {distrib?.lastDiversified ? `Last interleaved ${distrib.lastDiversified} posts from ${distrib.lastRun ? fmtAgo(distrib.lastRun) : '—'}` : '—'}
          </div>
        </div>
        <div style={{ flex: '1 1 200px', fontSize: 11, color: '#64748b' }}>
          <Label>Mix Optimizer</Label>
          <div style={{ marginTop: 4, color: mixOptimizer?.lastIssues?.length ? '#fbbf24' : '#e2e8f0' }}>
            {(mixOptimizer?.totalRuns ?? 0).toLocaleString()} runs · {mixOptimizer?.lastCheckedPools ?? 0} pool(s) checked
          </div>
          <div style={{ marginTop: 2 }}>
            {mixOptimizer?.lastIssues?.length
              ? `Rebalanced: ${mixOptimizer.lastIssues.join(' · ')}`
              : mixOptimizer?.lastRun ? `Balanced as of ${fmtAgo(mixOptimizer.lastRun)}` : '—'}
          </div>
        </div>
        <div style={{ flex: '1 1 200px', fontSize: 11, color: '#64748b' }}>
          <Label>Sort Optimizer</Label>
          <div style={{ marginTop: 4, color: '#e2e8f0' }}>
            {(sortOptimizer?.totalRuns ?? 0).toLocaleString()} runs · score spread {sortOptimizer?.lastScoreSpread ?? 0}
          </div>
          <div style={{ marginTop: 2 }}>
            {sortOptimizer?.lastRun
              ? `ranked/newest overlap ${sortOptimizer.lastRankedNewestOverlap ?? 0}/20 · ${fmtAgo(sortOptimizer.lastRun)}`
              : '—'}
          </div>
        </div>
      </div>
    </Card>
  );
}

function RefetchHelperPanel({ status, triggerAgent, triggering }) {
  const q = status?.refreshQueue;
  const running = !!q?.running;
  const pct = q?.batchTotal ? Math.round((q.batchDone / q.batchTotal) * 100) : 0;
  const workers = status?.sources?.workers || [];
  const reddit = workers.find(w => w.id === 'reddit');
  const outage = reddit?.outageBackoff;

  // Fetchable, ungated sources only — connected-account sources (Twitter,
  // LinkedIn, Instagram, Facebook) run per-user on demand, not from here,
  // and gated ones (TikTok, USAJobs) have no real fetcher behind them yet.
  const transferable = workers
    .filter(w => !w.isConnectedSource && w.status !== 'gated')
    .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  const [targetSource, setTargetSource] = useState('');
  useEffect(() => {
    if (!targetSource && transferable.length) setTargetSource(transferable[0].id);
  }, [transferable.length]); // eslint-disable-line
  const targetWorker = transferable.find(w => w.id === targetSource);
  const targetBusy = targetSource && triggering[targetSource];

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Label color="#38bdf8">Refetch Helper</Label>
        <Btn size="sm" onClick={() => triggerAgent('feed')} disabled={triggering.feed || running}>
          {running ? 'Refetching...' : '⇪ Refetch all sources now'}
        </Btn>
      </div>
      <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 16px' }}>
        Queues every source worker to refetch in paced batches within the current memory budget.
        Pending sources wait during critical pressure and resume automatically when the guard recovers.
        Runs on the pipeline service — separate from the Staging → Cache transfer that promotes what gets fetched
        here into the table users actually read from (see Pipeline).
      </p>

      <div style={{
        background: running ? 'rgba(56,189,248,.06)' : 'rgba(255,255,255,.02)',
        border: `1px solid ${running ? 'rgba(56,189,248,.2)' : 'rgba(255,255,255,.06)'}`,
        borderRadius: 8, padding: '12px 14px', marginBottom: 14,
      }}>
        {running ? (
          <>
            {/* One lane per parallel worker (TRANSFER_WORKER_COUNT server-
                side) — a fixed slot each, not a list that reshuffles every
                time a worker starts or finishes a source, so it actually
                reads as "4 independent workers" rather than a jittering
                queue dump. Pulses while that slot holds a real source,
                goes flat/dim the instant it's back between tasks. */}
            <div style={{ display: 'flex', gap: 7, marginBottom: 10, flexWrap: 'wrap' }}>
              {(q.currentIds || []).map((id, slot) => {
                const w = id ? workers.find(x => x.id === id) : null;
                return (
                  <div key={slot} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 600,
                    background: id ? 'rgba(56,189,248,.14)' : 'rgba(255,255,255,.03)',
                    border: `1px solid ${id ? 'rgba(56,189,248,.4)' : 'rgba(255,255,255,.07)'}`,
                    color: id ? '#e2e8f0' : '#475569',
                    transition: 'background .25s, border-color .25s, color .25s',
                  }}>
                    <span style={{
                      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                      background: id ? '#38bdf8' : '#334155',
                      animation: id ? 'pulse 1.1s ease-in-out infinite' : 'none',
                    }} />
                    {id ? <>{badgeCode(w?.name || id, 'SRC')} {(w?.name || id).replace(' Agent', '')}</> : 'idle'}
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 12, marginBottom: 8 }}>
              <span style={{ color: '#60a5fa' }}>{q.batchDone}/{q.batchTotal} done · {q.pending} queued</span>
            </div>
            <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: '#38bdf8', transition: 'width .3s' }} />
            </div>
          </>
        ) : q?.pending > 0 ? (
          <div role="status" style={{ fontSize: 12, color: '#fbbf24' }}>
            {q.pending.toLocaleString()} sources queued — {q.pausedForStability ? 'waiting for memory to recover' : 'waiting for the next collection pass'}.
            <div style={{ marginTop: 4 }}>Pending work is retained. Skipped fetch attempts are historical checks, not a count of lost posts.</div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            Idle — {q?.lastFinished ? `last refetch finished ${fmtAgo(q.lastFinished)}` : 'no refetch run yet'}
            {q?.lastReason ? ` (${q.lastReason})` : ''}
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
              {(q?.processedLastHour ?? 0).toLocaleString()} sources refetched in the last hour
              {q?.dbPostCount != null ? ` · ${q.dbPostCount.toLocaleString()} posts in DB` : ''}
            </div>
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 14, marginBottom: outage?.active ? 14 : 0 }}>
        <Label color="#60a5fa">Refetch a specific source</Label>
        <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 10px' }}>
          Pushes one platform straight to its own filter tab on the site (e.g. the GitHub tab) —
          it's fetched and saved directly, not routed through the mixed/True Mix pool the way "All"
          and "Personal Feed" are.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select
            value={targetSource}
            onChange={e => setTargetSource(e.target.value)}
            disabled={!transferable.length}
            style={{
              background: '#0d0d1a', color: '#e2e8f0', border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 6, padding: '7px 10px', fontSize: 12, flex: '1 1 200px',
            }}
          >
            {transferable.map(w => (
              <option key={w.id} value={w.id}>{badgeCode(w.name || w.id)} {(w.name || w.id).replace(' Agent', '')}</option>
            ))}
          </select>
          <Btn
            size="sm"
            onClick={() => targetSource && triggerAgent(targetSource)}
            disabled={!targetSource || targetBusy}
          >
            {targetBusy ? 'Refetching...' : 'Refetch source'}
          </Btn>
        </div>
        {targetWorker && (
          <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>
            {targetWorker.lastSuccess ? `Last refetched ${fmtAgo(targetWorker.lastSuccess)}` : 'Never refetched yet'}
            {' · '}{(targetWorker.postCount || 0).toLocaleString()} posts seen
          </div>
        )}
      </div>

      {outage?.active && (
        <div style={{ fontSize: 11, color: '#fbbf24', padding: '8px 10px', background: 'rgba(251,191,36,.08)', borderRadius: 6, marginBottom: 4 }}>
          Reddit is in a protective backoff right now - its anonymous endpoints are being rate-limited
          by Reddit, so it's standing down rather than retrying (until {fmtTime(outage.until)}). This is
          expected behavior, not a broken source.
        </div>
      )}
    </Card>
  );
}

// Sorting/composition/refetch-queue state all lives in globalFeedCache/
// workerHealth, which only the pipeline role's continuous workers ever
// populate (same reason SourcesView reads pipelineStatus, not status) — this
// view used to be fed api's status, which meant Sort Helper and Refetch
// Helper below always rendered empty/idle on the api role, i.e. always.
function FeedManagerView({ pipelineStatus, triggerAgent, triggering }) {
  return (
    <>
      <h1 style={H1}>Feed Manager</h1>
      <p style={SUBTITLE}>Manage how the shared feed is sorted and how content moves from the office's source workers to the live site.</p>
      <SortHelperPanel status={pipelineStatus} triggerAgent={triggerAgent} triggering={triggering} />
      <RefetchHelperPanel status={pipelineStatus} triggerAgent={triggerAgent} triggering={triggering} />
    </>
  );
}

// ─── Pipeline: one animated view of the whole source → sort → transfer →
// live-site path, all four stages driven by the same real status/composition
// data the Sources/Feed Manager views already show separately — this just
// puts them on one live, moving line instead of three panels you have to
// mentally stitch together yourself.
const PIPELINE_STATUS_DOT = {
  starting: '#64748b', healthy: '#22c55e', fallback: '#38bdf8', ready: '#22c55e',
  degraded: '#f59e0b', paused: '#ef4444', pro: '#f59e0b', gated: '#64748b',
};

// Every stage in this view reads from one of two services' status objects
// (see the view's own top comment) — this makes which one explicit right on
// the stage itself instead of requiring a read of the source to know.
function SvcTag({ svc }) {
  const color = svc === 'pipeline' ? '#60a5fa' : '#f472b6';
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px',
      color, background: `${color}18`, border: `1px solid ${color}40`,
      borderRadius: 4, padding: '1px 5px', marginLeft: 6,
    }}>
      {svc}
    </span>
  );
}

function FlowConnector({ colors, fast, compact = false }) {
  const dur = fast ? 1.1 : 2.6;
  return (
    <div style={{
      position: 'relative', height: 4, flex: compact ? '0 0 34px' : '0 0 56px', margin: '0 2px',
      background: 'rgba(255,255,255,.05)', borderRadius: 2, overflow: 'hidden', alignSelf: 'center',
    }}>
      {colors.map((c, i) => (
        <span key={i} style={{
          position: 'absolute', top: -2, left: 0, width: 8, height: 8, borderRadius: '50%',
          background: c, boxShadow: `0 0 6px ${c}`,
          animation: `flowRight ${dur}s linear infinite`,
          animationDelay: `${(i * dur) / colors.length}s`,
        }} />
      ))}
    </div>
  );
}

function PipelineNode({ children, glow, style }) {
  return (
    <div style={{
      background: '#0d0d1a',
      border: `1px solid ${glow ? `${glow}55` : 'rgba(255,255,255,.08)'}`,
      borderRadius: 14,
      boxShadow: glow ? `0 0 22px ${glow}1f` : 'none',
      padding: 16,
      display: 'flex', flexDirection: 'column',
      ...style,
    }}>
      {children}
    </div>
  );
}

function TransferRing({ pct, active }) {
  const r = 25, c = 2 * Math.PI * r;
  return (
    <svg width={64} height={64} style={{ animation: active ? 'glowPulse 1.6s ease-in-out infinite' : 'none' }}>
      <circle cx={32} cy={32} r={r} fill="none" stroke="rgba(56,189,248,.15)" strokeWidth={5} />
      <circle
        cx={32} cy={32} r={r} fill="none" stroke="#38bdf8" strokeWidth={5} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={active ? c - (pct / 100) * c : c}
        transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset .5s ease' }}
      />
      <text x={32} y={38} textAnchor="middle" fontSize={13} fontWeight="800" fill="#e2e8f0">RQ</text>
    </svg>
  );
}

// Post-split (see SERVICE_ROLE, backend/index.js), this view's own stages
// genuinely span both services, not just one status object read two ways:
// - pipelineStatus: everything upstream of a post existing in the DB at all
//   (Sources, Equalizer, Filter, Sort & Rank's in-memory globalFeedCache,
//   and the Refetch Queue that nudges a stale source to fetch again) — all
//   of this only ever has real data on the pipeline role now, since
//   startContinuousWorkers/enqueueSourceRefresh are gated there.
// - status (api): Staging → Cache (transferStagedPosts runs on api only)
//   and Topic Filter (per-request, served live by whichever role answers
//   the request — always api, since pipeline has no public traffic).
// Viewed stays its own independent fetch either way (DB-backed analytics,
// correct regardless of which service answers it).
function PipelineView({ status, pipelineStatus, compact = false }) {
  const [pageviews, setPageviews] = useState(null);
  useEffect(() => {
    let cancelled = false;
    officeFetch(`${API}/office/analytics/pageviews`).then(r => r.json())
      .then(j => { if (!cancelled) setPageviews(j); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const workers = (pipelineStatus?.sources?.workers || []).slice().sort((a, b) => (b.postCount || 0) - (a.postCount || 0));
  const healthyCount = workers.filter(w => ['healthy', 'ready', 'fallback', 'pro'].includes(w.status)).length;
  const composition  = pipelineStatus?.feed?.composition || [];
  const equalizer    = pipelineStatus?.equalizer;
  const filterAgent  = pipelineStatus?.filterAgent;
  const feedAudit    = pipelineStatus?.feedAudit;
  const sortAgent    = pipelineStatus?.sortAgent;
  const staging      = status?.staging;
  const dbSize       = status?.dbSize;
  const cacheFreshness = status?.feedStorage?.cache || {};
  const retention    = status?.feedStorage?.retention || {};
  const cacheMaintenance = status?.feedStorage?.cacheMaintenance || {};
  const afterTransferRunning = Boolean(retention?.inFlight || cacheMaintenance?.inFlight);
  const afterTransferDegraded = retention?.status === 'degraded' || cacheMaintenance?.status === 'degraded';
  const afterTransferLastRun = [retention?.lastRun, cacheMaintenance?.lastRun].filter(Boolean).sort().at(-1) || null;
  const topicFilterAgent = status?.topicFilterAgent;
  // Computed from globalFeedCache.posts server-side (see its own comment) —
  // only real on the pipeline role, same as composition/sortAgent above,
  // unlike topicFilterAgent just above (a genuinely per-request, api-role
  // stat) — these two look like they'd share a source but don't.
  const topicComposition = pipelineStatus?.sortRankTopicComposition || [];
  const q            = pipelineStatus?.refreshQueue;
  const running      = !!q?.running;
  const pct          = q?.batchTotal ? Math.round((q.batchDone / q.batchTotal) * 100) : 0;
  const smallNode = compact
    ? { flexBasis: 168, width: 168, minWidth: 168, padding: 12 }
    : {};
  const wideNode = compact
    ? { flexBasis: 230, width: 230, minWidth: 230, padding: 12 }
    : {};
  const ringSize = compact ? 52 : 62;

  return (
    <>
      <h1 style={H1}>Pipeline</h1>
      <p style={SUBTITLE}>
        Every platform, live — from fetch through filtering, sorting, staging, transfer to cache, per-user topic
        narrowing, and onto the site. Sources through Sort &amp; Rank run on the pipeline service now; Staging → Cache
        and onward run on api. Moves in real time as it actually happens, nothing staged for the screenshot.
      </p>

      <Card style={{ overflowX: 'auto', padding: compact ? 12 : 20 }}>
        <div style={{ display: 'flex', alignItems: 'stretch', minWidth: compact ? 1430 : 1600 }}>
          {/* Stage 1 — Sources */}
          <PipelineNode style={{ flex: '1 1 360px', minWidth: 320, ...wideNode }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div><Label color="#60a5fa">Sources</Label><SvcTag svc="pipeline" /></div>
              <span style={{ fontSize: 11, color: '#64748b' }}>{healthyCount}/{workers.length} live</span>
            </div>
            {workers.length === 0 ? (
              <div style={{ fontSize: 12, color: '#475569' }}>Workers starting up…</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 280, overflowY: 'auto', alignContent: 'flex-start' }}>
                {workers.map(w => {
                  const dot = PIPELINE_STATUS_DOT[w.status] || '#64748b';
                  const recentlyActive = w.lastSuccess && (Date.now() - new Date(w.lastSuccess).getTime()) < 120000;
                  const isLive = recentlyActive || w.status === 'healthy';
                  return (
                    <div
                      key={w.id}
                      title={`${(w.name || w.id).replace(' Agent', '')} — ${w.status} — ${(w.postCount || 0).toLocaleString()} posts`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '4px 9px', borderRadius: 20, fontSize: 11, color: '#94a3b8',
                        background: isLive ? `${dot}18` : 'rgba(255,255,255,.03)',
                        border: `1px solid ${isLive ? `${dot}55` : 'rgba(255,255,255,.06)'}`,
                      }}
                    >
                      <span style={{ fontSize: 9, lineHeight: 1, fontWeight: 800, minWidth: 18, color: dot }}>{badgeCode(w.name || w.id, 'S')}</span>
                      <span style={{
                        display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: dot,
                        animation: isLive ? 'pulse 1.6s ease-in-out infinite' : 'none',
                      }} />
                    </div>
                  );
                })}
              </div>
            )}
          </PipelineNode>

          <FlowConnector colors={['#60a5fa', '#38bdf8']} compact={compact} />

          {/* Stage 1.5 — Equalizer: sits between raw fetches and Filter —
              see runEqualizerDrain server-side. Each source's fetches queue
              here instead of going straight to Filter; a drain every 2s
              interleaves them fairly, weighted by each source's own
              configured pull rate (SOURCE_CONFIG shards) and dampened for
              whichever source is currently over-represented in what's
              actually made it through recently — never excludes, only
              reorders, same as every other diversity mechanism in this
              pipeline. */}
          <PipelineNode glow="#38bdf8" style={{ flex: '0 0 210px', textAlign: 'center', alignItems: 'center', ...smallNode }}>
            <div><Label color="#38bdf8">Equalizer</Label><SvcTag svc="pipeline" /></div>
            <div style={{
              width: ringSize, height: ringSize, borderRadius: '50%', margin: '14px 0',
              background: 'radial-gradient(circle, rgba(56,189,248,.28), rgba(56,189,248,.03))',
              border: '1px solid rgba(56,189,248,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              animation: 'glowPulse 2.4s ease-in-out infinite',
            }}><span style={{ fontSize: 12, fontWeight: 800 }}>EQ</span></div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
              {(equalizer?.pendingTotal ?? 0).toLocaleString()} queued
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {equalizer?.lastRun ? `Drained ${fmtAgo(equalizer.lastRun)}` : 'Not run yet'}
            </div>
          </PipelineNode>

          <FlowConnector colors={['#38bdf8', '#fbbf24']} compact={compact} />

          {/* Stage 2 — Filter: every fetched post's first checkpoint, before
              it's even eligible for sorting — see filterAgentState/
              addAndBroadcast server-side. Two independent drops happen
              here: invalid (no id, or a fallback/placeholder post) and
              duplicate (already broadcast by this or another source, within
              the rolling seenPostIds window). */}
          <PipelineNode glow="#fbbf24" style={{ flex: '0 0 200px', textAlign: 'center', alignItems: 'center', ...smallNode }}>
            <div><Label color="#fbbf24">Filter</Label><SvcTag svc="pipeline" /></div>
            <div style={{
              width: ringSize, height: ringSize, borderRadius: '50%', margin: '14px 0',
              background: 'radial-gradient(circle, rgba(251,191,36,.28), rgba(251,191,36,.03))',
              border: '1px solid rgba(251,191,36,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              animation: 'glowPulse 2.4s ease-in-out infinite',
            }}><span style={{ fontSize: 12, fontWeight: 800 }}>FL</span></div>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, marginBottom: 8, fontWeight: 700 }}>
              <span style={{ color: '#f87171' }}>−{((filterAgent?.lastDroppedInvalid ?? 0) + (filterAgent?.lastDroppedDuplicate ?? 0)).toLocaleString()}</span>
              <span style={{ color: '#4ade80' }}>+{(filterAgent?.lastOutput ?? 0).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {filterAgent?.lastRun ? `Filtered ${fmtAgo(filterAgent.lastRun)}` : 'Not run yet'}
            </div>
          </PipelineNode>

          <FlowConnector colors={['#fbbf24', '#a78bfa']} compact={compact} />

          {/* Stage 3 — Sort & Rank */}
          <PipelineNode glow="#a78bfa" style={{ flex: '0 0 200px', textAlign: 'center', alignItems: 'center', ...smallNode }}>
            <div><Label color="#a78bfa">Sort &amp; Rank</Label><SvcTag svc="pipeline" /></div>
            <div style={{
              width: ringSize, height: ringSize, borderRadius: '50%', margin: '14px 0',
              background: 'radial-gradient(circle, rgba(167,139,250,.28), rgba(167,139,250,.03))',
              border: '1px solid rgba(167,139,250,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              animation: 'glowPulse 2.4s ease-in-out infinite',
            }}><span style={{ fontSize: 12, fontWeight: 800 }}>SR</span></div>
            {composition.length > 0 && (
              <div style={{ display: 'flex', height: 8, width: '100%', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                {composition.slice(0, 14).map((c, i) => (
                  <div key={c.source} title={`${c.source}: ${c.pct}%`} style={{
                    width: `${c.pct}%`, minWidth: c.pct > 0 ? 2 : 0,
                    background: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length],
                  }} />
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {sortAgent?.lastRun ? `Ranked ${fmtAgo(sortAgent.lastRun)}` : 'Not run yet'}
            </div>
          </PipelineNode>

          <FlowConnector colors={['#a78bfa', '#38bdf8']} fast={running} compact={compact} />

          {/* Stage 4 — Refetch Queue (was labeled "Transfer" — renamed to
              avoid colliding with the actual Staging → Cache transfer added
              right after it, a genuinely different mechanism: this one
              nudges a stale external source to fetch again, pipeline-side
              only now). Event-driven, not on a fixed interval like Staging →
              Cache — items get queued whenever a source is flagged stale (or
              a manual trigger), then TRANSFER_WORKER_COUNT (4) parallel
              workers drain it continuously. The ring reflects the current
              batch, so it's honest for it to sit at 0% right as a fresh
              small batch starts. What it doesn't do on its own is convey
              that anything's actually happening overall — a rolling count
              underneath does that regardless of whether a batch happens to
              be running at this exact instant. */}
          <PipelineNode glow={running ? '#38bdf8' : undefined} style={{ flex: '0 0 200px', textAlign: 'center', alignItems: 'center', ...smallNode }}>
            <div><Label color="#38bdf8">Refetch Queue</Label><SvcTag svc="pipeline" /></div>
            <div style={{ margin: '14px 0' }}>
              <TransferRing pct={pct} active={running} />
            </div>
            <div style={{ fontSize: 11, color: running ? '#38bdf8' : '#64748b' }}>
              {running
                ? `${q.currentIds?.length ? q.currentIds.join(', ') : '…'} · ${q.batchDone}/${q.batchTotal}`
                : (q?.lastFinished ? `Idle · last ${fmtAgo(q.lastFinished)}` : 'Idle — no transfer run yet')}
            </div>
            <div style={{ fontSize: 10.5, color: '#475569', marginTop: 4 }}>
              {(q?.processedLastHour ?? 0).toLocaleString()} sources/hr
              {q?.dbPostCount != null ? ` · ${q.dbPostCount.toLocaleString()} posts in DB` : ''}
            </div>
          </PipelineNode>

          <FlowConnector colors={['#38bdf8', '#00d4aa']} compact={compact} />

          {/* Stage 4.5 — Staging → Cache. The mechanism that actually moves
              content to where users can see it post-split — everything
              before this point (Sources through Refetch Queue) only ever
              gets content as far as feed_posts_staging; this is what
              promotes it into feed_posts_cache, the table every real
              request actually reads from. Runs on the api role, not
              pipeline — see staging above (status.staging, not
              pipelineStatus). */}
          <PipelineNode glow="#00d4aa" style={{ flex: '0 0 200px', textAlign: 'center', alignItems: 'center', ...smallNode }}>
            <div><Label color="#00d4aa">Staging → Cache</Label><SvcTag svc="api" /></div>
            <div style={{
              width: ringSize, height: ringSize, borderRadius: '50%', margin: '14px 0',
              background: 'radial-gradient(circle, rgba(0,212,170,.28), rgba(0,212,170,.03))',
              border: '1px solid rgba(0,212,170,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              animation: 'glowPulse 2.4s ease-in-out infinite',
            }}><span style={{ fontSize: 12, fontWeight: 800 }}>DB</span></div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
              {(staging?.pendingCount ?? 0).toLocaleString()} pending
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {staging?.inFlight
                ? `Draining now · ${Math.round((staging.lockAgeMs || 0) / 1000)}s`
                : staging?.lastRun ? `Moved ${staging.lastCount ?? 0} · ${fmtAgo(staging.lastRun)}` : 'Not run yet'}
            </div>
            <div style={{ fontSize: 10.5, color: '#475569', marginTop: 4 }}>
              {(staging?.totalTransferred ?? 0).toLocaleString()} total transferred
              {staging?.liveCachePostCount != null ? ` · ${staging.liveCachePostCount.toLocaleString()} live posts` : ''}
            </div>
          </PipelineNode>

          <FlowConnector colors={['#00d4aa', '#22c55e']} compact={compact} />

          <PipelineNode glow={afterTransferRunning ? '#22c55e' : undefined} style={{ flex: '0 0 200px', textAlign: 'center', alignItems: 'center', ...smallNode }}>
            <div><Label color="#22c55e">After Transfer</Label><SvcTag svc="api" /></div>
            <div style={{
              width: ringSize, height: ringSize, borderRadius: '50%', margin: '14px 0',
              background: 'radial-gradient(circle, rgba(34,197,94,.24), rgba(34,197,94,.03))',
              border: '1px solid rgba(34,197,94,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              animation: afterTransferRunning ? 'glowPulse 1.8s ease-in-out infinite' : 'none',
            }}><span style={{ fontSize: 12, fontWeight: 800 }}>RT</span></div>
            <div style={{ fontSize: 11, fontWeight: 700, color: afterTransferDegraded ? '#f87171' : '#e2e8f0', marginBottom: 4 }}>
              {afterTransferRunning ? 'Cleaning now' : afterTransferLastRun ? `Cleaned ${fmtAgo(afterTransferLastRun)}` : 'Ready'}
            </div>
            <div style={{ fontSize: 10.5, color: '#475569', marginTop: 4 }}>
              {(retention?.lastArchivedCount ?? 0).toLocaleString()} archived from live
              {retention?.lastArchivePrunedCount ? ` · ${retention.lastArchivePrunedCount.toLocaleString()} pruned` : ''}
              {cacheMaintenance?.lastRuntimeRemovedCount ? ` · ${cacheMaintenance.lastRuntimeRemovedCount.toLocaleString()} cache expired` : ''}
            </div>
          </PipelineNode>

          <FlowConnector colors={['#22c55e', '#f472b6']} compact={compact} />

          {/* Stage 5 — Topic Filter: the one genuinely per-user step in this
              pipeline — every stage before this is shared/global, the same
              for every visitor. Hard-excludes anything not matching
              whichever topics this specific viewer picked at signup (see
              filterByUserTopics server-side). "Last run" reflects whichever
              request happened most recently, same live-motion convention
              Sort & Rank's own node already uses for its own per-request
              calls — not a global aggregate. */}
          <PipelineNode glow="#f472b6" style={{ flex: '0 0 200px', textAlign: 'center', alignItems: 'center', ...smallNode }}>
            <div><Label color="#f472b6">Topic Filter</Label><SvcTag svc="api" /></div>
            <div style={{
              width: ringSize, height: ringSize, borderRadius: '50%', margin: '14px 0',
              background: 'radial-gradient(circle, rgba(244,114,182,.28), rgba(244,114,182,.03))',
              border: '1px solid rgba(244,114,182,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              animation: 'glowPulse 2.4s ease-in-out infinite',
            }}><span style={{ fontSize: 12, fontWeight: 800 }}>TF</span></div>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, marginBottom: 8, fontWeight: 700 }}>
              <span style={{ color: '#f87171' }}>−{(topicFilterAgent?.lastDropped ?? 0).toLocaleString()}</span>
              <span style={{ color: '#4ade80' }}>+{(topicFilterAgent?.lastOutput ?? 0).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {topicFilterAgent?.lastRun ? `Filtered ${fmtAgo(topicFilterAgent.lastRun)}` : 'Not run yet'}
            </div>
          </PipelineNode>

          <FlowConnector colors={['#f472b6', '#4ade80']} compact={compact} />

          {/* Stage 6 — Viewed (live site) */}
          <PipelineNode glow="#4ade80" style={{ flex: '1 1 200px', textAlign: 'center', alignItems: 'center', ...smallNode }}>
            <Label color="#4ade80">Viewed</Label>
            <div style={{
              width: ringSize, height: ringSize, borderRadius: '50%', margin: '14px 0',
              background: 'radial-gradient(circle, rgba(74,222,128,.24), rgba(74,222,128,.03))',
              border: '1px solid rgba(74,222,128,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              animation: 'glowPulse 2.4s ease-in-out infinite',
            }}><span style={{ fontSize: 12, fontWeight: 800 }}>PV</span></div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', lineHeight: 1 }}>
              {pageviews?.available === false ? '—' : (pageviews?.today ?? '—')}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>views · last 24h</div>
            <div style={{ fontSize: 10.5, color: '#475569', marginBottom: 8 }}>
              {pageviews?.available === false ? '—' : `${pageviews?.todayVisitors ?? '—'} unique IPs`}
            </div>
            <a href="https://uficonnect.org" target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#4ade80' }}>
              uficonnect.org ↗
            </a>
          </PipelineNode>
        </div>
      </Card>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14, fontSize: 11, color: '#475569' }}>
        <span><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#22c55e', marginRight: 5 }} />healthy / recently fetched</span>
        <span><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#38bdf8', marginRight: 5 }} />fallback</span>
        <span><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', marginRight: 5 }} />degraded</span>
        <span><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#ef4444', marginRight: 5 }} />paused</span>
        <span><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#64748b', marginRight: 5 }} />starting / gated</span>
      </div>

      {/* ── Detail row: what's actually happening inside each stage ── */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${compact ? 240 : 300}px, 1fr))`, gap: 14, marginTop: 20 }}>
        <EqualizerDetailCard equalizer={equalizer} workers={workers} />
        <FilterDetailCard filterAgent={filterAgent} />
        <FeedAuditDetailCard audit={feedAudit} />
        <SortRankDetailCard sortAgent={sortAgent} distrib={pipelineStatus?.sortDistributionAgent} composition={composition} />
        <TransferDetailCard q={q} workers={workers} dbSize={dbSize} cacheFreshness={cacheFreshness} />
        <StagingTransferDetailCard staging={staging} />
        <AfterTransferDetailCard retention={retention} cacheFreshness={cacheFreshness} cacheMaintenance={cacheMaintenance} />
        <TopicFilterDetailCard topicFilterAgent={topicFilterAgent} />
        <TransferByTopicCard topicComposition={topicComposition} />
        <ViewedDetailCard pageviews={pageviews} />
      </div>
    </>
  );
}

function DetailStat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 17, fontWeight: 800, color: color || '#e2e8f0', lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function FeedAuditDetailCard({ audit }) {
  const reasons = Object.entries(audit?.byReason || {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);
  return (
    <Card>
      <Label color="#22c55e">Feed audit</Label>
      <div style={{ display: 'flex', gap: 24, marginTop: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        <DetailStat label="checked" value={(audit?.checked ?? 0).toLocaleString()} />
        <DetailStat label="approved" value={(audit?.approved ?? 0).toLocaleString()} color="#4ade80" />
        <DetailStat label="rejected" value={(audit?.rejected ?? 0).toLocaleString()} color={audit?.rejected ? '#fbbf24' : '#64748b'} />
        <DetailStat label="approval" value={audit?.approvalPct == null ? '—' : `${audit.approvalPct}%`} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {reasons.length ? reasons.map(([reason, count]) => (
          <span key={reason} style={{ padding: '4px 7px', borderRadius: 5, background: 'rgba(251,191,36,.08)', color: '#fbbf24', fontSize: 10.5 }}>
            {reason.replaceAll('_', ' ')} · {count.toLocaleString()}
          </span>
        )) : <span style={{ color: '#475569', fontSize: 11 }}>No rejected imports</span>}
      </div>
      {audit?.lastRejected && (
        <div style={{ color: '#64748b', fontSize: 10.5, marginTop: 10 }}>
          Latest: {audit.lastRejected.source || 'unknown'} · {audit.lastRejected.reason?.replaceAll('_', ' ')} · {fmtAgo(audit.lastRejected.at)}
        </div>
      )}
    </Card>
  );
}

// Sits before Filter — see runEqualizerDrain server-side. bufferedBySource/
// pendingTotal are live (computed on read there, same pattern as
// feed.composition elsewhere), so "queued" always reflects exactly what's
// waiting for the next drain, not a stale snapshot from the last one.
function EqualizerDetailCard({ equalizer, workers = [] }) {
  const bufferedBySource = equalizer?.bufferedBySource || {};
  const drainedBySource = equalizer?.lastDrainedBySource || {};
  const acceptedBySource = equalizer?.lastAcceptedBySource || {};
  const rejectedBySource = equalizer?.lastRejectedBySource || {};
  const sharePct = equalizer?.recentSharePct || {};
  const drainedThisTick = Object.values(drainedBySource).reduce((sum, count) => sum + count, 0);
  const acceptedThisTick = Object.values(acceptedBySource).reduce((sum, count) => sum + count, 0);
  const rejectedThisTick = Object.values(rejectedBySource).reduce((sum, count) => sum + count, 0);
  const queuedRows = Object.entries(bufferedBySource).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const shareRows = Object.entries(sharePct).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const nameFor = (id) => (workers.find(w => w.id === id)?.name || id).replace(' Agent', '');
  const badgeFor = (id) => badgeCode(workers.find(w => w.id === id)?.name || id, 'SRC');

  return (
    <Card>
      <Label color="#38bdf8">Equalizer — detail</Label>
      <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 14px', lineHeight: 1.6 }}>
        Drains every 2s: interleaves whatever's queued from each source, weighted by its own configured pull rate
        and dampened if it is currently over-represented in accepted output. Queue and write batches are capped so a burst cannot exhaust memory or database connections.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 12, marginBottom: 14 }}>
        <DetailStat label="queued now" value={(equalizer?.pendingTotal ?? 0).toLocaleString()} color="#38bdf8" />
        <DetailStat label="drained/tick" value={drainedThisTick.toLocaleString()} />
        <DetailStat label="accepted/tick" value={acceptedThisTick.toLocaleString()} color="#4ade80" />
        <DetailStat label="rejected/tick" value={rejectedThisTick.toLocaleString()} color={rejectedThisTick ? '#fbbf24' : undefined} />
        <DetailStat label="write queue" value={(equalizer?.persistencePendingTotal ?? 0).toLocaleString()} color={equalizer?.persistenceInFlight ? '#38bdf8' : undefined} />
        <DetailStat label="total drained" value={(equalizer?.totalDrained ?? 0).toLocaleString()} />
        <DetailStat label="total accepted" value={(equalizer?.totalAccepted ?? 0).toLocaleString()} color="#4ade80" />
        <DetailStat label="last tick" value={equalizer?.lastDurationMs != null ? `${equalizer.lastDurationMs}ms` : '—'} />
      </div>

      {(equalizer?.totalBackpressureDropped ?? 0) > 0 && (
        <div style={{ margin: '0 0 12px', padding: '8px 10px', borderRadius: 6, background: 'rgba(251,191,36,.1)', color: '#fbbf24', fontSize: 11 }}>
          Backpressure protected the service by discarding {(equalizer.totalBackpressureDropped || 0).toLocaleString()} oldest queued post(s). Increase the Equalizer buffer limits if this keeps rising.
        </div>
      )}
      {(equalizer?.persistenceDroppedTotal ?? 0) > 0 && (
        <div style={{ margin: '0 0 12px', padding: '8px 10px', borderRadius: 6, background: 'rgba(239,68,68,.1)', color: '#f87171', fontSize: 11 }}>
          The database write queue discarded {(equalizer.persistenceDroppedTotal || 0).toLocaleString()} post(s) after repeated write failures. Check staging storage and the database connection.
        </div>
      )}

      {queuedRows.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>Waiting for next drain</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {queuedRows.map(([id, n]) => (
              <span key={id} style={{
                display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#e2e8f0',
                padding: '3px 9px', borderRadius: 14, background: 'rgba(56,189,248,.1)', border: '1px solid rgba(56,189,248,.25)',
              }}>
                {badgeFor(id)} {nameFor(id)} <span style={{ color: '#64748b' }}>{n}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {shareRows.length > 0 && (
        <div style={{ fontSize: 11, color: '#475569', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 10, lineHeight: 1.8 }}>
          <div style={{ marginBottom: 4 }}>Recent output share (what the dampening reacts to):</div>
          {shareRows.map(([id, pct]) => (
            <div key={id}>{badgeFor(id)} {nameFor(id)}: <span style={{ color: '#94a3b8' }}>{pct}%</span></div>
          ))}
        </div>
      )}
    </Card>
  );
}

// What every fetched post passes through before it's even eligible for
// sorting (see filterAgentState/addAndBroadcast server-side) — two
// independent checks, not one: invalid (no id, or a fallback/placeholder
// post that was never real content) and duplicate (already broadcast by
// this or another source, inside the rolling seenPostIds window — the same
// story can genuinely surface from two different platforms). bySource is a
// running total for the life of the process, not just the last call, so a
// platform that fetches rarely still shows real numbers instead of
// whatever happened to run most recently.
function FilterDetailCard({ filterAgent }) {
  const input = filterAgent?.lastInput ?? 0;
  const output = filterAgent?.lastOutput ?? 0;
  const droppedInvalid = filterAgent?.lastDroppedInvalid ?? 0;
  const droppedDuplicate = filterAgent?.lastDroppedDuplicate ?? 0;
  const durationS = (filterAgent?.lastDurationMs ?? 0) / 1000;
  const rate = durationS > 0 ? Math.round(input / durationS) : 0;
  const avgPerRun = filterAgent?.totalRuns ? Math.round((filterAgent.totalInput || 0) / filterAgent.totalRuns) : 0;
  const bySource = filterAgent?.bySource || [];

  return (
    <Card>
      <Label color="#fbbf24">Filter — detail</Label>
      <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 14px', lineHeight: 1.6 }}>
        Every fetch, before anything is sorted or ranked: drop invalid posts (no id, or a fallback/placeholder that
        was never real content) → drop duplicates (already broadcast by this or another source, within the rolling
        window). What's left is what Sort &amp; Rank ever sees. Real numbers from the most recent fetch below, not averages.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(255,255,255,.04)', fontSize: 12, color: '#e2e8f0', fontWeight: 700 }}>
          {input.toLocaleString()} in
        </div>
        <span style={{ color: '#475569' }}>→</span>
        <div style={{ padding: '6px 12px', borderRadius: 8, background: droppedInvalid > 0 ? 'rgba(239,68,68,.1)' : 'rgba(255,255,255,.04)', fontSize: 12, color: droppedInvalid > 0 ? '#f87171' : '#64748b', fontWeight: 700 }}>
          −{droppedInvalid.toLocaleString()} invalid
        </div>
        <span style={{ color: '#475569' }}>→</span>
        <div style={{ padding: '6px 12px', borderRadius: 8, background: droppedDuplicate > 0 ? 'rgba(239,68,68,.1)' : 'rgba(255,255,255,.04)', fontSize: 12, color: droppedDuplicate > 0 ? '#f87171' : '#64748b', fontWeight: 700 }}>
          −{droppedDuplicate.toLocaleString()} duplicate
        </div>
        <span style={{ color: '#475569' }}>→</span>
        <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(74,222,128,.1)', fontSize: 12, color: '#4ade80', fontWeight: 700 }}>
          {output.toLocaleString()} kept
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 12, marginBottom: 14 }}>
        <DetailStat label="items / sec" value={rate ? rate.toLocaleString() : '—'} color="#fbbf24" />
        <DetailStat label="last run" value={`${filterAgent?.lastDurationMs ?? 0}ms`} />
        <DetailStat label="total runs" value={(filterAgent?.totalRuns ?? 0).toLocaleString()} />
        <DetailStat label="avg items/run" value={avgPerRun.toLocaleString()} />
      </div>

      <div style={{ fontSize: 11, color: '#475569', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 10 }}>
        Last source in: <span style={{ color: '#94a3b8' }}>{filterAgent?.lastContext || '—'}</span>
        {filterAgent?.lastError && <div style={{ color: '#f87171', marginTop: 4 }}>! {filterAgent.lastError}</div>}
      </div>

      {bySource.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>What's being filtered, by platform</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 160, overflowY: 'auto' }}>
            {bySource.map((s, i) => {
              const dropped = s.droppedInvalid + s.droppedDuplicate;
              const keptPct = s.input ? Math.round((s.output / s.input) * 100) : 0;
              return (
                <div key={s.source} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length], flexShrink: 0 }} />
                  <span style={{ color: '#94a3b8', flex: 1 }}>{s.source}</span>
                  <span style={{ color: '#4ade80', fontWeight: 700 }}>{s.output.toLocaleString()} kept</span>
                  <span style={{ color: dropped > 0 ? '#f87171' : '#475569' }}>−{dropped.toLocaleString()}</span>
                  <span style={{ color: '#475569', width: 38, textAlign: 'right' }}>{keptPct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// What's actually being ranked (real input/output/dropped counts from the
// last sortFeedBatch run), how — the real algorithm steps, not a
// simplification — and at what rate, computed from the same lastDurationMs
// every other panel already shows, just turned into items/sec.
function SortRankDetailCard({ sortAgent, distrib, composition }) {
  const input = sortAgent?.lastInput ?? 0;
  const output = sortAgent?.lastOutput ?? 0;
  const dropped = sortAgent?.lastDropped ?? 0;
  const durationS = (sortAgent?.lastDurationMs ?? 0) / 1000;
  const rate = durationS > 0 ? Math.round(input / durationS) : 0;
  const avgPerRun = sortAgent?.totalRuns ? Math.round((sortAgent.totalItems || 0) / sortAgent.totalRuns) : 0;

  return (
    <Card>
      <Label color="#a78bfa">Sort &amp; Rank — detail</Label>
      <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 14px', lineHeight: 1.6 }}>
        Every run: dedupe by post id → score (Newest = post time · Popular = engagement leveled per-source, so one
        viral source can't set the scale for everyone · Ranked = a blended score with the same per-source leveling,
        ties broken by recency) → optionally cap any one source to keep the mix diversified. Real numbers from the
        most recent run below, not averages.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(255,255,255,.04)', fontSize: 12, color: '#e2e8f0', fontWeight: 700 }}>
          {input.toLocaleString()} in
        </div>
        <span style={{ color: '#475569' }}>→</span>
        <div style={{ padding: '6px 12px', borderRadius: 8, background: dropped > 0 ? 'rgba(239,68,68,.1)' : 'rgba(255,255,255,.04)', fontSize: 12, color: dropped > 0 ? '#f87171' : '#64748b', fontWeight: 700 }}>
          −{dropped.toLocaleString()} capped
        </div>
        <span style={{ color: '#475569' }}>→</span>
        <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(74,222,128,.1)', fontSize: 12, color: '#4ade80', fontWeight: 700 }}>
          {output.toLocaleString()} shown
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 12, marginBottom: 14 }}>
        <DetailStat label="items / sec" value={rate ? rate.toLocaleString() : '—'} color="#a78bfa" />
        <DetailStat label="last run" value={`${sortAgent?.lastDurationMs ?? 0}ms`} />
        <DetailStat label="total runs" value={(sortAgent?.totalRuns ?? 0).toLocaleString()} />
        <DetailStat label="avg items/run" value={avgPerRun.toLocaleString()} />
      </div>

      <div style={{ fontSize: 11, color: '#475569', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 10 }}>
        Triggered by: <span style={{ color: '#94a3b8' }}>{sortAgent?.lastContext || '—'}</span>
        {sortAgent?.lastError && <div style={{ color: '#f87171', marginTop: 4 }}>! {sortAgent.lastError}</div>}
      </div>

      {composition.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>What's being ranked, by source</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 160, overflowY: 'auto' }}>
            {composition.map((c, i) => (
              <div key={c.source} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length], flexShrink: 0 }} />
                <span style={{ color: '#94a3b8', flex: 1 }}>{c.source}</span>
                <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{c.count.toLocaleString()}</span>
                <span style={{ color: '#475569', width: 42, textAlign: 'right' }}>{c.pct}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {distrib?.lastDiversified != null && (
        <div style={{ fontSize: 11, color: '#475569', marginTop: 10 }}>
          Distribution agent last interleaved <span style={{ color: '#94a3b8' }}>{distrib.lastDiversified}</span> posts
          {distrib.lastRun ? ` · ${fmtAgo(distrib.lastRun)}` : ''}
        </div>
      )}
    </Card>
  );
}

// Real transfer throughput — while a batch is running this is measured
// against the actual elapsed time (not an assumption), so it settles once
// a couple of sources have gone through and gets more accurate as it runs.
function TransferDetailCard({ q, workers = [], dbSize, cacheFreshness = {} }) {
  const running = !!q?.running;
  const elapsedS = running && q.lastStarted ? (Date.now() - new Date(q.lastStarted).getTime()) / 1000 : 0;
  const rate = running && elapsedS > 2 && q.batchDone > 0 ? q.batchDone / elapsedS : null;
  const remaining = running && q.batchTotal != null ? Math.max(0, q.batchTotal - q.batchDone) : 0;
  const etaS = rate ? Math.round(remaining / rate) : null;
  const lastFullRunS = (!running && q?.lastStarted && q?.lastFinished)
    ? Math.round((new Date(q.lastFinished).getTime() - new Date(q.lastStarted).getTime()) / 1000)
    : null;

  return (
    <Card>
      <Label color="#38bdf8">Refetch Queue — detail</Label>
      <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 14px', lineHeight: 1.6 }}>
        Nudges a stale external source to fetch again — pipeline-side only now (see SERVICE_ROLE). Not the same
        thing as the Staging → Cache card: this re-fetches from the outside world; that one moves already-fetched
        posts to where users can see them. Queues every source worker, then drains 4 at a time in parallel — paced
        deliberately so a full refresh can't spike load the way firing every source at once used to.
      </p>

      {running && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {(q.currentIds || []).map((id, slot) => {
            const w = id ? workers.find(x => x.id === id) : null;
            return (
              <div key={slot} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 9px', borderRadius: 18, fontSize: 11, fontWeight: 600,
                background: id ? 'rgba(56,189,248,.14)' : 'rgba(255,255,255,.03)',
                border: `1px solid ${id ? 'rgba(56,189,248,.4)' : 'rgba(255,255,255,.07)'}`,
                color: id ? '#e2e8f0' : '#475569',
                transition: 'background .25s, border-color .25s, color .25s',
              }}>
                <span style={{
                  display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                  background: id ? '#38bdf8' : '#334155',
                  animation: id ? 'pulse 1.1s ease-in-out infinite' : 'none',
                }} />
                {id ? <>{badgeCode(w?.name || id, 'SRC')} {(w?.name || id).replace(' Agent', '')}</> : 'idle'}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 12, marginBottom: 14 }}>
        <DetailStat label="status" value={running ? 'Running' : 'Idle'} color={running ? '#38bdf8' : '#64748b'} />
        <DetailStat label="sources / sec" value={rate ? rate.toFixed(2) : (running ? 'measuring…' : '—')} color="#38bdf8" />
        <DetailStat label="pending" value={(q?.pending ?? 0).toLocaleString()} />
        <DetailStat label="ETA" value={etaS != null ? `~${etaS}s` : '—'} />
      </div>

      {/* Rolling, not per-batch — batchTotal/batchDone above reset to 0 at
          the start of every new batch (mostly small self-healing refills
          now), which reads as constant resetting on its own. This stays
          non-zero across batch boundaries as long as anything real has
          moved through in the last hour. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 12, marginBottom: 14 }}>
        <DetailStat label="sources / last hr" value={(q?.processedLastHour ?? 0).toLocaleString()} color="#4ade80" />
        <DetailStat label="posts in DB" value={q?.dbPostCount != null ? q.dbPostCount.toLocaleString() : '—'} />
        <DetailStat
          label={dbSize?.mb != null ? `${dbSize.mb.toLocaleString()}/${(dbSize.limitMb || 4096).toLocaleString()}MB` : 'API storage'}
          value={dbSize?.usedPct != null ? `${dbSize.usedPct}%` : '—'}
          color={storageColor(dbSize)}
        />
        <DetailStat label="cache write" value={cacheFreshness?.newestFetchedAt ? fmtAgo(cacheFreshness.newestFetchedAt) : '—'} color="#4ade80" />
      </div>

      <div style={{ fontSize: 11, color: '#475569', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 10, lineHeight: 1.8 }}>
        <div>Total transfer runs: <span style={{ color: '#94a3b8' }}>{(q?.totalRuns ?? 0).toLocaleString()}</span></div>
        <div>Last full run took: <span style={{ color: '#94a3b8' }}>{lastFullRunS != null ? `${lastFullRunS}s` : '—'}</span></div>
        <div>Reason: <span style={{ color: '#94a3b8' }}>{q?.lastReason || '—'}</span></div>
        <div>Newest cached post date: <span style={{ color: '#94a3b8' }}>{cacheFreshness?.newestPostCreatedAt ? fmtAgo(cacheFreshness.newestPostCreatedAt) : '—'}</span></div>
        {q?.lastError && <div style={{ color: '#f87171' }}>! {q.lastError}</div>}
      </div>
    </Card>
  );
}

// The mechanism that actually moves content to where users can see it
// post-split (see SERVICE_ROLE/transferStagedPosts server-side) — pulls
// whatever the pipeline role has staged into feed_posts_cache every minute,
// draining in a loop (up to 20 batches of 5000 rows per tick) rather than
// one fixed batch, so a backlog catches up instead of trickling out for
// hours. Runs on the api role only; staging (the object this reads) comes
// from that role's own /office/status response.
function StagingTransferDetailCard({ staging }) {
  const process = staging?.transferProcess || {};
  const liveCachePostCount = staging?.liveCachePostCount ?? process.liveCachePostCount;
  const bySourceRows = Object.entries(staging?.bySource || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const movedRows = Object.entries(staging?.lastSourceCounts || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const recentRuns = Array.isArray(staging?.recentRuns) ? staging.recentRuns.slice(0, 5) : [];
  const stagingClearedPosts = Array.isArray(staging?.lastStagingClearedPosts)
    ? staging.lastStagingClearedPosts.slice(0, 16)
    : [];
  const batchCapacity = process.batchSize && process.maxBatches
    ? process.batchSize * process.maxBatches
    : null;
  const formatMs = (ms) => {
    if (ms == null) return '—';
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms)}ms`;
  };

  return (
    <Card>
      <Label color="#38bdf8">Staging → Cache — detail</Label>
      <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 14px', lineHeight: 1.6 }}>
        Every minute, copies whatever the pipeline service has fetched since the last run out of
        feed_posts_staging and into feed_posts_cache — the table every real user's feed is actually served from —
        looping through up to 100k rows per tick if there's a backlog. Runs on the api role, not pipeline.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 12, marginBottom: 14 }}>
        <DetailStat label="pending in staging" value={staging?.pendingCount != null ? staging.pendingCount.toLocaleString() : '—'} color="#38bdf8" />
        <DetailStat label="live cache posts" value={liveCachePostCount != null ? liveCachePostCount.toLocaleString() : '—'} color="#4ade80" />
        <DetailStat label="last run moved" value={(staging?.lastCount ?? 0).toLocaleString()} />
        <DetailStat label="saved / staging cleared" value={`${(staging?.lastSavedCount ?? 0).toLocaleString()} / ${(staging?.lastDeletedCount ?? 0).toLocaleString()}`} />
        <DetailStat label="total transferred" value={(staging?.totalTransferred ?? 0).toLocaleString()} color="#4ade80" />
        <DetailStat label="transfer lock" value={staging?.inFlight ? 'active' : 'clear'} color={staging?.inFlight ? '#fbbf24' : '#4ade80'} />
        <DetailStat label="process state" value={process.state || (staging?.inFlight ? 'draining' : 'ready')} color={process.state === 'degraded' ? '#f87171' : '#38bdf8'} />
        <DetailStat label="last duration" value={formatMs(staging?.lastDurationMs)} />
        <DetailStat label="batch capacity" value={batchCapacity != null ? `${batchCapacity.toLocaleString()}/min` : '—'} />
        <DetailStat label="latest staged write" value={staging?.newestFetchedAt ? fmtAgo(staging.newestFetchedAt) : '—'} color="#38bdf8" />
      </div>
      <div style={{ fontSize: 11, color: '#475569', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 10, lineHeight: 1.8 }}>
        <div>Last run: <span style={{ color: '#94a3b8' }}>{staging?.lastRun ? fmtAgo(staging.lastRun) : 'not run yet'}</span></div>
        <div>Last trigger: <span style={{ color: '#94a3b8' }}>{staging?.lastReason || '—'}</span></div>
        <div>Staging cleared: <span style={{ color: '#94a3b8' }}>only after the same rows were saved into the live cache</span></div>
        <div>Current batch: <span style={{ color: '#94a3b8' }}>{staging?.currentBatch ? `${staging.currentBatch} (${(staging.currentBatchSize || 0).toLocaleString()} rows)` : 'idle'}</span></div>
        <div>Configured batch: <span style={{ color: '#94a3b8' }}>{process.batchSize ? `${process.batchSize.toLocaleString()} x ${process.maxBatches || 1}` : '—'}</span></div>
        <div>Oldest staged row: <span style={{ color: '#94a3b8' }}>{staging?.oldestFetchedAt ? fmtAgo(staging.oldestFetchedAt) : 'none queued'}</span></div>
        <div>Newest staged post date: <span style={{ color: '#94a3b8' }}>{staging?.newestPostCreatedAt ? fmtAgo(staging.newestPostCreatedAt) : '—'}</span></div>
        {staging?.inFlight && (
          <div style={{ color: '#fbbf24' }}>
            Transfer lock active for {Math.round((staging.lockAgeMs || 0) / 1000)}s
          </div>
        )}
        {staging?.lastError && <div style={{ color: '#f87171' }}>! {staging.lastError}</div>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginTop: 14, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Waiting by source</div>
          {bySourceRows.length ? bySourceRows.map(([source, count]) => (
            <div key={source} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, marginBottom: 5 }}>
              <span style={{ color: '#94a3b8' }}>{source}</span>
              <strong style={{ color: '#e2e8f0' }}>{Number(count || 0).toLocaleString()}</strong>
            </div>
          )) : <div style={{ fontSize: 11, color: '#475569' }}>No staged backlog.</div>}
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Last moved by source</div>
          {movedRows.length ? movedRows.map(([source, count]) => (
            <div key={source} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, marginBottom: 5 }}>
              <span style={{ color: '#94a3b8' }}>{source}</span>
              <strong style={{ color: '#e2e8f0' }}>{Number(count || 0).toLocaleString()}</strong>
            </div>
          )) : <div style={{ fontSize: 11, color: '#475569' }}>No completed transfer yet.</div>}
        </div>
      </div>

      {recentRuns.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Recent transfer runs</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentRuns.map((run) => (
              <div key={run.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center', fontSize: 11 }}>
                <span style={{ color: run.status === 'error' ? '#f87171' : '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {run.reason || 'scheduled'} · {run.finishedAt ? fmtAgo(run.finishedAt) : 'running'}
                </span>
                <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{(run.movedCount || 0).toLocaleString()} moved</span>
                <span style={{ color: '#64748b' }}>{formatMs(run.durationMs)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stagingClearedPosts.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Recently promoted and cleared from staging</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 190, overflowY: 'auto' }}>
            {stagingClearedPosts.map((post) => (
              <div key={post.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', fontSize: 11 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.title || post.id}</div>
                  <div style={{ color: '#64748b', marginTop: 2 }}>{post.source || 'unknown'}{post.topic ? ` - ${post.topic}` : ''}</div>
                </div>
                {post.sourceUrl && (
                  <a href={post.sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'none' }}>Open</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function AfterTransferDetailCard({ retention, cacheFreshness, cacheMaintenance }) {
  const policy = retention?.policy || {};
  const cachePolicy = cacheMaintenance?.policy || {};
  const breakdown = retention?.lastBreakdown || {};
  const rows = [
    ['Count cap', breakdown.countCap],
    ['Age cap', breakdown.ageCap],
    ['Unseen cap', breakdown.unseenCap],
    ['Archive age', breakdown.archiveAgeCap],
    ['Archive cap', breakdown.archiveCap],
  ].filter(([, item]) => item);
  const timers = Object.entries(retention?.timers || {});
  const runtimeCacheRows = Object.entries(cacheMaintenance?.lastBreakdown?.runtime || {})
    .filter(([, count]) => Number(count || 0) > 0);
  const officeCacheRows = Object.entries(cacheMaintenance?.lastBreakdown?.office || {})
    .filter(([, count]) => Number(count || 0) > 0);
  const sourceDeletion = retention?.sourceDeletion || {};
  const sourceDeletedPosts = Array.isArray(sourceDeletion.lastDeletedPosts) ? sourceDeletion.lastDeletedPosts : [];
  const removedPosts = Array.isArray(retention?.lastRemovedPosts) ? retention.lastRemovedPosts : [];
  const permanentlyDeletedPosts = Array.isArray(retention?.lastDeletedPosts) ? retention.lastDeletedPosts : [];
  const recentChanges = [
    ...sourceDeletedPosts.map(post => ({ ...post, action: 'Source deleted', color: '#f87171' })),
    ...removedPosts.map(post => ({ ...post, action: 'Archived from live', color: '#22c55e' })),
    ...permanentlyDeletedPosts.map(post => ({ ...post, action: 'Permanently pruned', color: '#f87171' })),
  ].slice(0, 16);
  const formatMs = (ms) => {
    if (ms == null) return '-';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  };

  return (
    <Card>
      <Label color="#22c55e">After Transfer - detail</Label>
      <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 14px', lineHeight: 1.6 }}>
        Runs after staged posts become live, plus scheduled count/unseen/archive passes. A source post is removed only when
        its original URL explicitly returns 404 or 410; old or over-cap rows are archived first, then pruned by age and count.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 12, marginBottom: 14 }}>
        <DetailStat label="state" value={retention?.inFlight ? 'running' : (retention?.status || 'idle')} color={retention?.status === 'degraded' ? '#f87171' : '#22c55e'} />
        <DetailStat label="live cache" value={cacheFreshness?.count != null ? cacheFreshness.count.toLocaleString() : '-'} />
        <DetailStat label="last reason" value={retention?.lastReason || '-'} color="#38bdf8" />
        <DetailStat label="live removed" value={(retention?.lastLiveDeletedCount ?? 0).toLocaleString()} />
        <DetailStat label="last archived" value={(retention?.lastArchivedCount ?? 0).toLocaleString()} color="#22c55e" />
        <DetailStat label="last pruned" value={(retention?.lastArchivePrunedCount ?? 0).toLocaleString()} />
        <DetailStat label="source deleted" value={(sourceDeletion.lastConfirmedDeletedCount ?? 0).toLocaleString()} color="#f87171" />
        <DetailStat label="source checked" value={(sourceDeletion.lastCheckedCount ?? 0).toLocaleString()} color="#38bdf8" />
        <DetailStat label="runtime cache expired" value={(cacheMaintenance?.lastRuntimeRemovedCount ?? 0).toLocaleString()} color="#38bdf8" />
        <DetailStat label="Office cache pruned" value={(cacheMaintenance?.lastOfficeRemovedCount ?? 0).toLocaleString()} />
        <DetailStat label="last duration" value={formatMs(retention?.lastDurationMs)} />
        <DetailStat label="last run" value={retention?.lastRun ? fmtAgo(retention.lastRun) : '-'} />
      </div>

      <div style={{ fontSize: 11, color: '#475569', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 10, lineHeight: 1.8 }}>
        <div>Live cap: <span style={{ color: '#94a3b8' }}>{policy.maxLivePosts?.toLocaleString?.() || '-'}</span></div>
        <div>Source floor: <span style={{ color: '#94a3b8' }}>{policy.sourceKeepFloor?.toLocaleString?.() || '-'} newest/source</span></div>
        <div>Retention: <span style={{ color: '#94a3b8' }}>{policy.highVolumePostDays || '-'}d high-volume, {policy.stalePostDays || '-'}d standard</span></div>
        <div>Unseen cap: <span style={{ color: '#94a3b8' }}>{policy.unseenPostDays || '-'}d unseen posts, every {policy.unseenCapIntervalSec || '-'}s</span></div>
        <div>Count timer: <span style={{ color: '#94a3b8' }}>every {policy.countCapIntervalSec || '-'}s</span></div>
        <div>Archive cap: <span style={{ color: '#94a3b8' }}>{policy.maxArchivePosts?.toLocaleString?.() || '-'} rows, {policy.archivePostDays || '-'}d max age</span></div>
        <div>Runtime cache cleanup: <span style={{ color: '#94a3b8' }}>every {cachePolicy.runtimeIntervalSec || '-'}s{cacheMaintenance?.nextRunAt ? `, next in ${fmtUntil(cacheMaintenance.nextRunAt)}` : ''}</span></div>
        <div>Office cache cleanup: <span style={{ color: '#94a3b8' }}>{cachePolicy.officeRetentionDays || '-'}d retention, {cachePolicy.officeMaxRowsPerTable?.toLocaleString?.() || '-'} rows/table, every {cachePolicy.officeIntervalSec || '-'}s{cacheMaintenance?.nextOfficeRunAt ? `, next in ${fmtUntil(cacheMaintenance.nextOfficeRunAt)}` : ''}</span></div>
        {cacheMaintenance?.lastOfficeHitBatchLimit && <div style={{ color: '#fbbf24' }}>Office backlog hit the bounded batch limit; catch-up runs every {cachePolicy.officeCatchUpIntervalSec || '-'}s until clear.</div>}
        <div>Source deletion check: <span style={{ color: '#94a3b8' }}>every {policy.sourceDeletionCheckIntervalSec || '-'}s, {policy.sourceDeletionCheckBatchSize || '-'} URLs per pass, after {policy.sourceDeletionGraceSec || '-'}s grace</span></div>
        <div>Source checker: <span style={{ color: '#94a3b8' }}>{sourceDeletion.inFlight ? 'running' : (sourceDeletion.status || 'idle')}, {sourceDeletion.lastUnverifiedCount || 0} kept after temporary/unknown responses</span></div>
        {retention?.lastError && <div style={{ color: '#f87171' }}>! {retention.lastError}</div>}
        {cacheMaintenance?.lastError && <div style={{ color: '#f87171' }}>! Cache cleanup: {cacheMaintenance.lastError}</div>}
        {sourceDeletion.lastError && <div style={{ color: '#f87171' }}>! Source deletion check: {sourceDeletion.lastError}</div>}
        {retention?.lastSkippedReason && <div style={{ color: '#fbbf24' }}>Skipped overlapping pass: {retention.lastSkippedReason}</div>}
      </div>

      {timers.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Scheduled cleanup timers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {timers.map(([name, timer]) => (
              <div key={name} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', fontSize: 11 }}>
                <span style={{ color: '#94a3b8' }}>{name.replace(/-/g, ' ')}</span>
                <span style={{ color: '#e2e8f0', textAlign: 'right' }}>
                  {timer.nextRunAt ? `next in ${fmtUntil(timer.nextRunAt)}` : `every ${timer.intervalSec || '-'}s`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(cacheMaintenance?.lastRun || runtimeCacheRows.length > 0 || officeCacheRows.length > 0) && (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Last cache cleanup</div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
            {cacheMaintenance?.lastRun ? `${fmtAgo(cacheMaintenance.lastRun)} - ${formatMs(cacheMaintenance.lastDurationMs)}` : 'Waiting for first scheduled pass'}
          </div>
          {runtimeCacheRows.length === 0 && officeCacheRows.length === 0 ? (
            <div style={{ fontSize: 11, color: '#475569' }}>No expired cache entries were waiting.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[...runtimeCacheRows.map(([name, count]) => [`Runtime - ${name}`, count]), ...officeCacheRows.map(([name, count]) => [`Office - ${name}`, count])].map(([name, count]) => (
                <div key={name} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', fontSize: 11 }}>
                  <span style={{ color: '#94a3b8' }}>{name.replace(/([a-z])([A-Z])/g, '$1 $2')}</span>
                  <strong style={{ color: '#e2e8f0' }}>{Number(count || 0).toLocaleString()} removed</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Last cleanup breakdown</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map(([label, item]) => (
              <div key={label} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center', fontSize: 11 }}>
                <span style={{ color: '#94a3b8' }}>{label}</span>
                <strong style={{ color: '#e2e8f0' }}>{Number(item.deleted || 0).toLocaleString()} removed</strong>
                <span style={{ color: '#22c55e' }}>{Number(item.archived || 0).toLocaleString()} archived</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentChanges.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Recent removed or deleted posts</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {recentChanges.map((post, index) => (
              <div key={`${post.action}-${post.id}-${index}`} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', fontSize: 11 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{post.title || post.id}</div>
                  <div style={{ color: post.color, marginTop: 2 }}>{post.action} - {post.source || 'unknown'}{post.reason ? ` - ${post.reason.replace(/-/g, ' ')}` : ''}</div>
                </div>
                {post.sourceUrl && (
                  <a href={post.sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'none' }}>Open</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// The one genuinely per-user stage in this pipeline (see filterByUserTopics
// server-side) — everything upstream of it is shared/global, the same pool
// for every visitor. "Last run" is whichever request happened most
// recently across every user, not a global aggregate — same convention
// Sort & Rank's own detail card already uses for its own per-request calls.
// byTopic is a running total for the life of the process: which topics
// users have actually picked, and how much survives the filter for each.
function TopicFilterDetailCard({ topicFilterAgent }) {
  const input = topicFilterAgent?.lastInput ?? 0;
  const output = topicFilterAgent?.lastOutput ?? 0;
  const dropped = topicFilterAgent?.lastDropped ?? 0;
  const durationS = (topicFilterAgent?.lastDurationMs ?? 0) / 1000;
  const rate = durationS > 0 ? Math.round(input / durationS) : 0;
  const avgPerRun = topicFilterAgent?.totalRuns ? Math.round((topicFilterAgent.totalInput || 0) / topicFilterAgent.totalRuns) : 0;
  const byTopic = topicFilterAgent?.byTopic || [];

  return (
    <Card>
      <Label color="#f472b6">Topic Filter — detail</Label>
      <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 14px', lineHeight: 1.6 }}>
        Runs per request, after Sort &amp; Rank: hard-excludes anything that doesn't match one of this specific
        viewer's onboarding-selected topics (job listings are exempt, same spacing reasoning as everywhere else in
        the pipeline). Real numbers from the most recent request below, not averages.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(255,255,255,.04)', fontSize: 12, color: '#e2e8f0', fontWeight: 700 }}>
          {input.toLocaleString()} in
        </div>
        <span style={{ color: '#475569' }}>→</span>
        <div style={{ padding: '6px 12px', borderRadius: 8, background: dropped > 0 ? 'rgba(239,68,68,.1)' : 'rgba(255,255,255,.04)', fontSize: 12, color: dropped > 0 ? '#f87171' : '#64748b', fontWeight: 700 }}>
          −{dropped.toLocaleString()} off-topic
        </div>
        <span style={{ color: '#475569' }}>→</span>
        <div style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(74,222,128,.1)', fontSize: 12, color: '#4ade80', fontWeight: 700 }}>
          {output.toLocaleString()} shown
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 12, marginBottom: 14 }}>
        <DetailStat label="items / sec" value={rate ? rate.toLocaleString() : '—'} color="#f472b6" />
        <DetailStat label="last run" value={`${topicFilterAgent?.lastDurationMs ?? 0}ms`} />
        <DetailStat label="total runs" value={(topicFilterAgent?.totalRuns ?? 0).toLocaleString()} />
        <DetailStat label="avg items/run" value={avgPerRun.toLocaleString()} />
      </div>

      <div style={{ fontSize: 11, color: '#475569', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 10 }}>
        Last viewer's topics: <span style={{ color: '#94a3b8' }}>{topicFilterAgent?.lastTopics?.length ? topicFilterAgent.lastTopics.join(', ') : '—'}</span>
        {topicFilterAgent?.lastError && <div style={{ color: '#f87171', marginTop: 4 }}>! {topicFilterAgent.lastError}</div>}
      </div>

      {byTopic.length > 0 && (
        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>What users are actually filtering to</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 160, overflowY: 'auto' }}>
            {byTopic.map((t, i) => (
              <div key={t.topic} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length], flexShrink: 0 }} />
                <span style={{ color: '#94a3b8', flex: 1 }}>{t.topic}</span>
                <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{t.requests.toLocaleString()} requests</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// The real transfer, animated: exactly how many posts of each topic are
// sitting in the shared cache right after Sort & Rank (sortRankTopicComposition
// — a live, computed-on-read breakdown, same pattern feed.composition
// already uses for sources). Deliberately NOT counted from real per-user
// feed/Videos responses — that only updates when someone's actually
// logged in and loading a feed, so this panel could sit on "no data yet"
// for a long stretch even while the pipeline itself was fully healthy.
// This updates continuously, in step with every other stage in the
// Pipeline, regardless of live user traffic. One growing bar per topic,
// same grow-in-on-load treatment as the Topics view.
function TransferByTopicCard({ topicComposition }) {
  const [grown, setGrown] = useState(false);
  const byTopic = topicComposition || [];

  useEffect(() => {
    if (!byTopic.length) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    return () => cancelAnimationFrame(id);
  }, [byTopic.length]);

  const maxCount = Math.max(1, ...byTopic.map(t => t.count));
  const totalPosts = byTopic.reduce((sum, t) => sum + t.count, 0);

  return (
    <Card>
      <Label color="#a78bfa">Transfer — by topic</Label>
      <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 14px', lineHeight: 1.6 }}>
        Every post that survives Sort &amp; Rank has to actually land somewhere — this is that landing, counted per
        topic straight from the shared cache right now. Live, not a sample: every poll updates every bar below,
        whether or not anyone's actively browsing.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 12, marginBottom: 14 }}>
        <DetailStat label="total posts" value={totalPosts.toLocaleString()} color="#a78bfa" />
        <DetailStat label="topics represented" value={byTopic.length.toLocaleString()} />
        <DetailStat label="top topic" value={byTopic[0] ? `${byTopic[0].pct}%` : '—'} />
      </div>

      {byTopic.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
          {byTopic.map((t, i) => (
            <div key={t.topic}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3, gap: 10 }}>
                <span style={{ fontSize: 11.5, color: '#e2e8f0', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.topic}</span>
                <span style={{ fontSize: 10.5, color: '#64748b', flexShrink: 0 }}>{t.count.toLocaleString()} posts · {t.pct}%</span>
              </div>
              <div style={{
                height: 8, borderRadius: 3, background: 'rgba(255,255,255,.04)', overflow: 'hidden',
                width: grown ? `${Math.max(1.5, (t.count / maxCount) * 100)}%` : '0%',
                transition: `width .6s cubic-bezier(.16,1,.3,1) ${Math.min(i * 15, 400)}ms`,
              }}>
                <div style={{ width: '100%', height: '100%', background: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length] }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#475569' }}>No posts in the shared cache yet.</div>
      )}
    </Card>
  );
}

// Pageviews, in full — the compact pipeline node above only ever showed a
// single rolling-24h number labeled "today," which reads like a calendar-day
// count it isn't; this breaks the same data down by window, by day, and by
// path so an actual anomaly (a day that's suspiciously flat, one path
// swallowing everything) is something you can actually see instead of
// inferring from one number.
function ViewedDetailCard({ pageviews }) {
  if (!pageviews) {
    return <Card><Label color="#4ade80">Viewed — detail</Label><div style={{ fontSize: 12, color: '#475569', marginTop: 10 }}>Loading…</div></Card>;
  }
  if (pageviews.available === false) {
    return <Card><Label color="#4ade80">Viewed — detail</Label><div style={{ fontSize: 12, color: '#f59e0b', marginTop: 10 }}>Database not connected — pageview data unavailable right now.</div></Card>;
  }
  const daily = (pageviews.daily || []).slice(-14);
  const maxViews = Math.max(1, ...daily.map(d => d.views || 0));
  const topPaths = pageviews.topPaths || [];
  if (pageviews.mode !== 'aggregate') return <Card><Label>Viewed — detail</Label><p style={{ fontSize: 12, color: '#fbbf24' }}>Aggregate analytics requires the matching API release.</p></Card>;

  return (
    <Card>
      <Label color="#4ade80">Viewed — detail</Label>
      <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 14px', lineHeight: 1.6 }}>
        Aggregate counts for fixed page and app-screen categories. Repeat visits count again;
        no account, visitor, or IP identifiers are stored in these metrics. Dates use UTC calendar days.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 16 }}>
        <DetailStat label="views today · UTC" value={Number(pageviews.today || 0).toLocaleString()} color="#4ade80" />
        <DetailStat label="views · 7 days" value={Number(pageviews.last7 || 0).toLocaleString()} />
        <DetailStat label="views · 30 days" value={Number(pageviews.last30 || 0).toLocaleString()} />
      </div>

      {daily.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Last {daily.length} days</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 54 }}>
            {daily.map((d, i) => {
              const h = Math.max(2, Math.round((d.views / maxViews) * 54));
              const isFlat = d.views === 0;
              return (
                <div key={i} title={`${d.day} UTC: ${d.views} views`} style={{
                  flex: 1, height: h, borderRadius: '2px 2px 0 0',
                  background: isFlat ? 'rgba(239,68,68,.5)' : '#4ade80',
                  opacity: isFlat ? 1 : 0.55 + (0.45 * (d.views / maxViews)),
                  minWidth: 6,
                }} />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#334155', marginTop: 4 }}>
            <span>{daily[0].day}</span>
            <span>{daily[daily.length - 1].day}</span>
          </div>
        </div>
      )}

      {topPaths.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 12 }}>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Top paths · last 30d</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {topPaths.slice(0, 6).map(p => (
              <div key={p.path} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, gap: 8 }}>
                <span style={{ color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.path}</span>
                <span style={{ color: '#e2e8f0', fontWeight: 700, flexShrink: 0 }}>{p.views.toLocaleString()} views</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// Every one of the 69 FEED_TOPICS, live from the database (see GET
// /office/topics server-side) — not the capped 300-post in-memory global
// cache, so this always reflects true, complete volume regardless of what
// the shared cache is holding at this instant. Each bar's overall length is
// that topic's share of the single largest topic (so relative scale reads
// at a glance); the color segments within it are that topic's own real
// source breakdown. Source colors are assigned once across the whole
// dataset (first-seen order), not per-bar, so e.g. reddit is always the
// same color in every topic's bar and the shared legend above means the
// same thing everywhere.
function TopicsView() {
  const [data, setData] = useState(null);
  const [grown, setGrown] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoaded, setLastLoaded] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await officeFetch(`${API}/office/topics`);
      const j = await r.json();
      setData(j);
      setLastLoaded(Date.now());
    } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    // Re-run the grow-in animation on every manual refresh too, not just the
    // first load — a static bar that silently changed width wouldn't make
    // it obvious new counts actually came in, which is the whole point of
    // this button existing.
    setGrown(false);
    await load();
    setRefreshing(false);
  };

  // Bars start at 0 width and grow in once data actually arrives — a next
  // tick, not the same render, so the browser has something to transition
  // *from*.
  useEffect(() => {
    if (!data) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    return () => cancelAnimationFrame(id);
  }, [data]);

  const topics = data?.topics || [];
  const maxTotal = Math.max(1, ...topics.map(t => t.total));

  const sourceColor = useMemo(() => {
    const seen = [];
    for (const t of topics) for (const s of t.sources) if (!seen.includes(s.source)) seen.push(s.source);
    const map = new Map();
    seen.forEach((s, i) => map.set(s, COMPOSITION_COLORS[i % COMPOSITION_COLORS.length]));
    return map;
  }, [topics]);

  // "Where posts are coming from" — same per-topic source breakdown the
  // bars below already carry, just re-summed across every topic instead of
  // one at a time, so "32 sources feeding in" is a single glanceable number
  // instead of something you'd have to add up yourself from 200 bars.
  const bySourceTotal = useMemo(() => {
    const map = new Map();
    for (const t of topics) for (const s of t.sources) map.set(s.source, (map.get(s.source) || 0) + s.count);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [topics]);
  // "Where posts are ending" — every post counted here already has a topic
  // (see the SQL's WHERE topic IS NOT NULL), so this total *is* the count
  // of posts that made it all the way through to a final topic bucket.
  const grandTotal = topics.reduce((sum, t) => sum + t.total, 0);
  const filledTopics = topics.filter(t => t.total > 0).length;

  if (!data) {
    return (<><h1 style={H1}>Topics</h1><p style={SUBTITLE}>Loading…</p></>);
  }
  if (data.available === false) {
    return (<><h1 style={H1}>Topics</h1><p style={SUBTITLE}>Database not connected — topic breakdown unavailable right now.</p></>);
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={H1}>Topics</h1>
          <p style={SUBTITLE}>
            All {topics.length} topics UFIConnect fetches for, live from the database — how many posts each actually
            has, and exactly which platforms filled it. Real totals, not the capped in-memory pool.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>
              {grandTotal.toLocaleString()}
            </div>
            <div style={{ fontSize: 10.5, color: '#64748b' }}>total posts</div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: 'rgba(96,165,250,.12)', border: '1px solid rgba(96,165,250,.35)',
              color: '#60a5fa', cursor: refreshing ? 'default' : 'pointer', opacity: refreshing ? 0.6 : 1,
            }}
          >
            <span style={{ display: 'inline-block', animation: refreshing ? 'spin 0.9s linear infinite' : 'none' }}>⟳</span>
            Refresh
          </button>
        </div>
      </div>
      {lastLoaded && (
        <div style={{ textAlign: 'right', fontSize: 11, color: '#64748b', marginTop: 4 }}>
          {refreshing ? 'Refreshing…' : `Loaded ${fmtAgo(lastLoaded)}`}
        </div>
      )}

      {/* Coming from → ending: the same two numbers every bar below is built
          from, said in plain language up front instead of something you'd
          have to piece together yourself from 200 individual rows. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        margin: '18px 0', padding: '12px 16px', borderRadius: 10,
        background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)',
        fontSize: 12.5, color: '#94a3b8',
      }}>
        <span>In <strong style={{ color: '#e2e8f0' }}>{grandTotal.toLocaleString()}</strong> posts</span>
        <span style={{ color: '#475569' }}>from</span>
        <strong style={{ color: '#e2e8f0' }}>{bySourceTotal.length}</strong> sources
        <span style={{ color: '#475569' }}>→</span>
        <span>sorted into</span>
        <strong style={{ color: '#e2e8f0' }}>{filledTopics}</strong> of {topics.length} topics
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        {bySourceTotal.map(([source, count]) => (
          <span key={source} title={`${count.toLocaleString()} posts`} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: sourceColor.get(source) || '#475569', flexShrink: 0 }} />
            {source} <span style={{ color: '#475569' }}>{count.toLocaleString()}</span>
          </span>
        ))}
      </div>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {topics.map((t, i) => (
            <div key={t.topic}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, gap: 12 }}>
                <span style={{ fontSize: 12.5, color: '#e2e8f0', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.topic}</span>
                <span style={{ fontSize: 11, color: '#64748b', flexShrink: 0 }}>{t.total.toLocaleString()} posts</span>
              </div>
              <div style={{
                display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden',
                background: 'rgba(255,255,255,.04)',
                width: grown ? `${Math.max(t.total > 0 ? 1.5 : 0, (t.total / maxTotal) * 100)}%` : '0%',
                transition: `width .7s cubic-bezier(.16,1,.3,1) ${Math.min(i * 12, 500)}ms`,
              }}>
                {t.sources.map(s => (
                  <div
                    key={s.source}
                    title={`${s.source}: ${s.count.toLocaleString()}`}
                    style={{ width: `${(s.count / t.total) * 100}%`, minWidth: 1, background: sourceColor.get(s.source) || '#475569' }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

// ─── App (root) ───────────────────────────────────────────────────────────────

export default function App() {
  const officeViews = ['overview', 'city', 'local-web', 'setup', 'controls', 'sources', 'pipeline', 'post-pipeline', 'topics', 'agents', 'feed', 'analytics', 'reports', 'deploy', 'autofix', 'versions'];
  const [view, setView] = useState(() => {
    const requested = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    return officeViews.includes(requested) ? requested : 'overview';
  });
  const [moreToolsOpen, setMoreToolsOpen] = useState(() => !PRIMARY_OFFICE_VIEWS.has(view));
  useEffect(() => {
    if (!PRIMARY_OFFICE_VIEWS.has(view)) setMoreToolsOpen(true);
  }, [view]);
  const needsOfficeTelemetry = !['local-web', 'setup', 'reports'].includes(view);
  const [status, setStatus] = useState(null);
  // Source-fetcher health (workerHealth/agentSourceCache) only ever has real
  // data on the pipeline role now — SourcesView/PipelineView read this
  // instead of `status`. Falls back to the same value as `status` when
  // PIPELINE_API isn't configured yet (see its own comment).
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [agents, setAgents] = useState({});
  const [log, setLog] = useState([]);
  const [deploying, setDeploying] = useState({});
  const [triggering, setTriggering] = useState({});
  const [versions, setVersions] = useState(null);
  const [connected, setConnected] = useState(false);
  const [actionError, setActionError] = useState('');
  const [telemetry, setTelemetry] = useState({
    api: { updatedAt: null, loading: true, error: '' },
    pipeline: { updatedAt: null, loading: true, error: '' },
    agents: { updatedAt: null, error: '', byService: {} },
  });
  const polls = useRef({ api: false, pipeline: false, agents: false });
  const observedAgents = useRef({ api: {}, pipeline: {} });
  const navigateOffice = useCallback(id => {
    if (!officeViews.includes(id)) return;
    if (!window.dispatchEvent(new Event('office-before-navigate', { cancelable: true }))) return;
    setView(id);
    window.history.replaceState(null, '', `#${id}`);
  }, []);

  const fetchStatus = useCallback(async () => {
    if (polls.current.api) return;
    polls.current.api = true;
    setTelemetry(prev => ({ ...prev, api: { ...prev.api, loading: true } }));
    try {
      const r = await officeFetch(`${API}/office/status`);
      if (!r.ok) throw new Error('Status unavailable');
      const data = await r.json();
      if (!data?.server || typeof data.server !== 'object' || Array.isArray(data.server)) throw new Error('Status unavailable');
      setStatus(data);
      setTelemetry(prev => ({ ...prev, api: { updatedAt: Date.now(), loading: false,
        error: data.server.serviceRole === 'pipeline' ? 'The API address returned pipeline process telemetry' : '',
      } }));
    } catch {
      setStatus(null);
      setTelemetry(prev => ({ ...prev, api: { ...prev.api, loading: false, error: 'API telemetry unavailable' } }));
    } finally { polls.current.api = false; }
  }, []);

  // Always a real fetch, even when PIPELINE_API === API (the fallback case,
  // e.g. before uficonnect-pipeline is configured) — hitting the same URL
  // twice on that fallback path is a trivial extra request, and avoids
  // needing to read `status` from inside this closure (a stale-closure risk
  // otherwise, since this callback is deliberately deps-stable for its own
  // setInterval below).
  const fetchPipelineStatus = useCallback(async () => {
    if (polls.current.pipeline) return;
    polls.current.pipeline = true;
    setTelemetry(prev => ({ ...prev, pipeline: { ...prev.pipeline, loading: true } }));
    try {
      const r = await officeFetch(`${PIPELINE_API}/office/status`);
      if (!r.ok) throw new Error('Status unavailable');
      const data = await r.json();
      if (!data?.server || typeof data.server !== 'object' || Array.isArray(data.server)) throw new Error('Status unavailable');
      setPipelineStatus(data);
      setTelemetry(prev => ({ ...prev, pipeline: { updatedAt: Date.now(), loading: false,
        error: data.server.serviceRole === 'api'
          ? PIPELINE_API === API ? 'A separate pipeline service is not configured' : 'The pipeline address returned API process telemetry'
          : '',
      } }));
    } catch {
      setPipelineStatus(null);
      setTelemetry(prev => ({ ...prev, pipeline: { ...prev.pipeline, loading: false, error: 'Pipeline telemetry unavailable' } }));
    } finally { polls.current.pipeline = false; }
  }, []);

  const fetchAgents = useCallback(async () => {
    if (polls.current.agents) return;
    polls.current.agents = true;
    try {
      const targets = PIPELINE_API === API ? [['api', API]] : [['api', API], ['pipeline', PIPELINE_API]];
      await Promise.allSettled(targets.map(async ([role, base]) => {
        try {
          const response = await officeFetch(`${base}/office/agents`);
          if (!response.ok) throw new Error('Agent telemetry unavailable');
          const data = await response.json();
          const updatedAt = Date.now();
          observedAgents.current[role] = observeAgentPayload(data, role, updatedAt);
          setTelemetry(prev => ({ ...prev, agents: { ...prev.agents,
            updatedAt, byService: { ...prev.agents.byService, [role]: { updatedAt, error: '' } },
          } }));
        } catch {
          setTelemetry(prev => ({ ...prev, agents: { ...prev.agents,
            byService: { ...prev.agents.byService, [role]: { ...prev.agents.byService[role], error: 'Agent telemetry unavailable' } },
          } }));
        }
      }));
      setAgents(mergeObservedAgents(observedAgents.current.api, observedAgents.current.pipeline));
    } finally { polls.current.agents = false; }
  }, []);

  const fetchVersions = useCallback(async () => {
    try {
      const r = await officeFetch(`${API}/office/versions`);
      if (r.ok) setVersions(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (!needsOfficeTelemetry) return undefined;
    fetchStatus();
    fetchPipelineStatus();
    fetchAgents();
    fetchVersions();
    const t1 = setInterval(fetchStatus,  8000);
    const t2 = setInterval(fetchPipelineStatus, 8000);
    const t3 = setInterval(fetchAgents, 15000);
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); };
  }, [fetchStatus, fetchPipelineStatus, fetchAgents, fetchVersions, needsOfficeTelemetry]);

  // SSE: real-time agent activity pushed from backend. Connects to both
  // services when PIPELINE_API is actually configured as a distinct URL —
  // each stream only ever carries that service's own activity (source
  // fetchers exclusively on pipeline, operational agents exclusively on
  // api, a handful like crash_guard/stability on both), and both funnel
  // into the same log/agents state via the shared handler below so
  // OverviewView's activity feed and Agents view show one unified picture
  // instead of a dashboard split in two.
  useEffect(() => {
    if (!needsOfficeTelemetry) return undefined;
    return connectOfficeStreams({
      bases: [...new Set([API, PIPELINE_API])],
      urlFor: base => officeStreamUrl('/office/agents/stream', base),
      EventSourceClass: OfficeEventSource,
      onConnection: setConnected,
      subscribeToken: listener => {
        window.addEventListener('office-token-changed', listener);
        return () => window.removeEventListener('office-token-changed', listener);
      },
      onData: entries => {
        setLog(prev => mergeOfficeLog(prev, entries));
        let changed = false;
        for (const entry of entries) {
          const entryRole = entry.service === PIPELINE_API && PIPELINE_API !== API ? 'pipeline' : 'api';
          const agent = observedAgents.current[entryRole]?.[entry.agentId];
          if (!agent) continue;
          // Stream activity updates only its own process instance. It does
          // not refresh measured health or the registry observation time.
          observedAgents.current[entryRole][entry.agentId] = { ...agent,
            lastAction: !agent.lastAction || Date.parse(entry.ts) > Date.parse(agent.lastAction.ts) ? entry : agent.lastAction,
            logs: mergeOfficeLog(agent.logs || [], [entry]).slice(0, 15),
          };
          changed = true;
        }
        if (changed) setAgents(mergeObservedAgents(observedAgents.current.api, observedAgents.current.pipeline));
      },
    });
  }, [needsOfficeTelemetry]);

  // Fires at both services and lets whichever one actually owns this id's
  // trigger key handle it (the office UI has no reliable client-side way to
  // know in advance whether a given id is a source-fetcher — pipeline-only
  // post-split — or an operational agent — api-only — without duplicating
  // AGENT_DEFS' own categorization here). The other side 404s harmlessly,
  // same as an unknown id already did before this split existed.
  const triggerAgent = async (id) => {
    setActionError('');
    setTriggering(prev => ({ ...prev, [id]: true }));
    const targets = PIPELINE_API === API ? [API] : [API, PIPELINE_API];
    const results = await Promise.all(targets.map(base =>
      officeFetch(`${base}/office/agents/${id}/trigger`, { method: 'POST' }).catch(() => null)
    ));
    if (!results.some(r => r?.ok)) {
      setActionError(`Could not run ${id}. No service accepted the request.`);
    }
    setTimeout(() => setTriggering(prev => ({ ...prev, [id]: false })), 2000);
  };

  const triggerDeploy = async (service) => {
    setActionError('');
    setDeploying(prev => ({ ...prev, [service]: true }));
    try {
      const response = await officeFetch(`${API}/office/deploy/${service}`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.msg || payload.error || `Deploy request failed (${response.status}).`);
    } catch (error) { setActionError(error.message); }
    setTimeout(() => setDeploying(prev => ({ ...prev, [service]: false })), 5000);
  };

  const nav = [
    { id: 'overview', label: 'Overview' },
    { id: 'city', label: 'Live City' },
    { id: 'local-web', label: 'Local web' },
    { id: 'setup', label: 'Setup' },
    { id: 'controls', label: 'Controls' },
    { id: 'sources',  label: 'Live Sources' },
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'post-pipeline', label: 'Post Pipeline' },
    { id: 'topics',   label: 'Topics' },
    { id: 'agents',   label: 'Agents' },
    { id: 'feed',     label: 'Feed Manager' },
    { id: 'analytics',label: 'Analytics' },
    { id: 'reports', label: 'Reports' },
    { id: 'deploy',   label: 'Deploy Center' },
    { id: 'autofix',  label: 'Autofix' },
    { id: 'versions', label: 'Versions' },
  ];
  const apiDbFailover = !!status?.server?.dbReadFailoverActive;
  const pipelineDbFailover = !!pipelineStatus?.server?.dbReadFailoverActive;
  const isMobile = useMediaQuery('(max-width: 760px)');
  const shellStyle = {
    display: 'flex',
    flexDirection: isMobile ? 'column' : 'row',
    minHeight: '100vh',
    background: '#080810',
    color: '#e2e8f0',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  };
  const asideStyle = {
    width: isMobile ? '100%' : 224,
    flexShrink: 0,
    background: '#08080f',
    borderRight: isMobile ? 'none' : '1px solid rgba(255,255,255,.06)',
    borderBottom: isMobile ? '1px solid rgba(255,255,255,.08)' : 'none',
    display: 'flex',
    flexDirection: 'column',
    // Local web scrolls the header away so phone editing keeps the whole screen.
    position: isMobile && view !== 'local-web' ? 'sticky' : 'static',
    top: 0,
    zIndex: 20,
  };
  const navStyle = {
    flex: isMobile ? '0 0 auto' : 1,
    display: isMobile ? 'grid' : 'block',
    gridTemplateColumns: isMobile ? 'minmax(0, 1fr) auto' : undefined,
    padding: isMobile ? '0 14px 12px' : 0,
    scrollbarWidth: 'thin',
  };
  const statusRowsStyle = {
    display: isMobile ? 'grid' : 'flex',
    gridTemplateColumns: isMobile ? 'repeat(auto-fit, minmax(142px, 1fr))' : undefined,
    flexDirection: isMobile ? undefined : 'column',
    gap: isMobile ? 6 : 4,
    marginBottom: 8,
  };
  const mainStyle = {
    flex: 1,
    minWidth: 0,
    padding: isMobile ? '20px 14px 32px' : '36px 40px',
    overflowY: 'auto',
    maxHeight: isMobile ? 'none' : '100vh',
  };

  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #080810; color: #e2e8f0; }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 3px; }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
        @keyframes flowRight { 0% { transform: translateX(-10px); opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { transform: translateX(62px); opacity: 0; } }
        @keyframes glowPulse { 0%,100% { transform: scale(1); filter: brightness(1); } 50% { transform: scale(1.06); filter: brightness(1.3); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        a { text-decoration: none; }
        .office-nav-section { display: contents; }
        .office-nav-primary, .office-nav-more { display: flex; flex-direction: column; }
        .office-nav-toggle { width: 100%; padding: 12px 20px; border: 0; background: transparent; color: #94a3b8; text-align: left; cursor: pointer; font: inherit; font-size: 12px; }
        .office-nav-more { border-top: 1px solid rgba(255,255,255,.06); }
        .office-nav-more[hidden] { display: none; }
        .office-overview-detail { margin: 12px 0; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 0 16px; }
        .office-overview-detail > summary { padding: 16px 0; color: #cbd5e1; font-size: 13px; font-weight: 600; cursor: pointer; }
        .office-overview-detail > summary span { margin-left: 10px; color: #64748b; font-size: 11px; font-weight: 400; }
        .office-overview-detail[open] { padding-bottom: 16px; }
        @media (max-width: 760px) {
          .office-nav-primary { grid-column: 1; grid-row: 1; min-width: 0; flex-direction: row; gap: 6px; overflow-x: auto; scrollbar-width: thin; }
          .office-nav-toggle { grid-column: 2; grid-row: 1; align-self: start; min-height: 44px; width: auto; margin-left: 8px; padding: 10px 12px; border: 1px solid #334155; border-radius: 8px; background: #142238; color: #dbeafe; font-weight: 600; white-space: nowrap; }
          .office-nav-toggle[aria-expanded="true"] { background: #1d4ed8; border-color: #60a5fa; color: white; }
          .office-nav-more { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; gap: 4px; max-height: 30vh; overflow-y: auto; margin-top: 10px; padding-top: 8px; }
        }
      `}</style>

      <div style={shellStyle}>
        {/* ── Sidebar ── */}
        <aside style={asideStyle}>
          <div style={{ padding: isMobile ? '16px 14px 12px' : '26px 20px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: -0.5 }}>
              <img src="/icon.svg" alt="" width="33" height="33" style={{ borderRadius: 8 }} />UFIConnect
            </div>
            <div style={{ fontSize: 10, color: '#334155', marginTop: 2, textTransform: 'uppercase', letterSpacing: 1.2 }}>
              Operations Office
            </div>
          </div>

          <nav style={navStyle} aria-label="Office sections">
          {['primary', 'more'].map(section => <div key={section} className="office-nav-section">
          {section === 'more' && <button className="office-nav-toggle" aria-expanded={moreToolsOpen} aria-controls="office-more-tools" onClick={() => setMoreToolsOpen(open => !open)}>
            More tools <span aria-hidden="true">{moreToolsOpen ? '▴' : '▾'}</span>
          </button>}
          <div className={`office-nav-${section}`} id={section === 'more' ? 'office-more-tools' : undefined} hidden={section === 'more' && !moreToolsOpen}>
          {nav.filter(({ id }) => PRIMARY_OFFICE_VIEWS.has(id) === (section === 'primary')).map(({ id, label }) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => navigateOffice(id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, width: isMobile ? 'auto' : '100%',
                    flex: isMobile ? '0 0 auto' : undefined,
                    padding: isMobile ? '9px 11px' : '11px 20px',
                    border: 'none', cursor: 'pointer', textAlign: 'left',
                    borderRadius: isMobile ? 8 : 0,
                    fontSize: 13, fontWeight: active ? 700 : 400,
                    background: active ? 'rgba(59,130,246,.1)' : 'transparent',
                    color: active ? '#60a5fa' : '#64748b',
                    borderRight: isMobile ? 'none' : `2px solid ${active ? '#3b82f6' : 'transparent'}`,
                    borderBottom: isMobile ? `2px solid ${active ? '#3b82f6' : 'transparent'}` : 'none',
                    transition: 'color .15s, background .15s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          </div>)}
          </nav>

          <div style={{ padding: isMobile ? '10px 14px 12px' : '16px 20px', borderTop: '1px solid rgba(255,255,255,.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10 }}>
              {needsOfficeTelemetry && <Dot ok={connected} pulse={connected} />}
              <span style={{ fontSize: 11, color: '#475569' }}>
                {!needsOfficeTelemetry ? 'Telemetry paused for this view' : connected ? 'Live stream active' : 'Reconnecting...'}
              </span>
            </div>
            {/* Both services' own health, always visible regardless of which
                view is open — not just a single merged dot. Pipeline ran on
                an 8+ day stale build with nothing surfacing that anywhere;
                its uptime reads here now specifically so that's obvious at
                a glance next time, not just in the Pipeline detail view. */}
            <div style={{ ...statusRowsStyle, ...(!needsOfficeTelemetry ? { display: 'none' } : {}) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Dot ok={!!status?.server} pulse={false} />
                <span style={{ fontSize: 10.5, color: apiDbFailover ? '#fbbf24' : '#64748b' }}>
                  API{status?.server ? ` · up ${formatUptime(status.server.uptime)}${apiDbFailover ? ' · db failover' : ''}` : ' · unreachable'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Dot ok={!!pipelineStatus?.server} pulse={false} />
                <span style={{ fontSize: 10.5, color: pipelineDbFailover ? '#fbbf24' : '#64748b' }}>
                  Pipeline{pipelineStatus?.server ? ` · up ${formatUptime(pipelineStatus.server.uptime)}${pipelineDbFailover ? ' · db failover' : ''}` : ' · unreachable'}
                </span>
              </div>
              {status?.staging && (
                <div style={{ fontSize: 10.5, color: (status.staging.pendingCount ?? 0) > STAGING_BACKLOG_WARN ? '#f87171' : '#64748b' }}>
                  Staging · {status.staging.pendingCount ?? '—'} pending
                  {(status.staging.pendingCount ?? 0) > STAGING_BACKLOG_WARN ? ' !' : ''}
                </div>
              )}
              {status?.dbSize && (
                <div style={{ fontSize: 10.5, color: storageColor(status.dbSize) }}>
                  API storage · {fmtStorage(status.dbSize)}
                </div>
              )}
            </div>
            <a
              href="https://uficonnect.org"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 10, color: '#334155', display: isMobile ? 'inline-block' : 'block', marginRight: isMobile ? 10 : 0, marginBottom: 2 }}
            >
              uficonnect.org open
            </a>
            <a
              href="https://api.uficonnect.org/health"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 10, color: '#334155', display: isMobile ? 'inline-block' : 'block', marginRight: isMobile ? 10 : 0, marginBottom: 2 }}
            >
              api health open
            </a>
            <a
              href="https://uficonnect-pipeline-708r.onrender.com/health"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 10, color: '#334155', display: isMobile ? 'inline-block' : 'block' }}
            >
              pipeline health open
            </a>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main style={mainStyle}>
          {actionError && <div role="alert" style={{ color: '#fca5a5', paddingBottom: 16 }}>{actionError}</div>}
          {view === 'city' && <Suspense fallback={<p style={{ color: '#64748b' }}>Opening Live City…</p>}><LiveCity status={status} pipelineStatus={pipelineStatus} agents={agents} log={log}
            telemetry={{ ...telemetry, streamConnected: connected }} officeFetch={officeFetch}
            apiBase={API} pipelineBase={PIPELINE_API} onNavigate={navigateOffice} /></Suspense>}
          {view === 'post-pipeline' && <PostPipeline apiBase={API} request={officeFetch} pipelineStatus={pipelineStatus} />}
          {view === 'local-web' && <LocalWeb apiBase={API} request={officeFetch} />}
          {view === 'overview' && <OverviewView status={status} pipelineStatus={pipelineStatus} log={log} agents={agents} triggerAgent={triggerAgent} triggering={triggering} />}
          {view === 'controls' && <Controls apiBase={API} pipelineBase={PIPELINE_API} request={officeFetch} />}
          {/* Source health (workerHealth/agentSourceCache) only has real
              data on the pipeline role now — see pipelineStatus above. */}
          {view === 'sources'  && <SourcesView status={pipelineStatus} triggerAgent={triggerAgent} triggering={triggering} />}
          {/* Genuinely spans both roles internally now — see PipelineView's
              own top-of-function comment for exactly which stage reads
              from which status object (Sources/Equalizer/Filter/Sort&Rank/
              Refetch Queue from pipelineStatus; the new Staging→Cache stage
              and Topic Filter from status). */}
          {view === 'pipeline' && <PipelineView status={status} pipelineStatus={pipelineStatus} compact={isMobile} />}
          {view === 'topics'   && <TopicsView />}
          {view === 'agents'   && <AgentsView agents={agents} triggerAgent={triggerAgent} triggering={triggering} />}
          {/* Sort/refetch-queue state is pipeline-only real data (see
              FeedManagerView's own top-of-function comment) — same reason
              SourcesView reads pipelineStatus, not status. */}
          {view === 'feed'     && <FeedManagerView pipelineStatus={pipelineStatus} triggerAgent={triggerAgent} triggering={triggering} />}
          {view === 'analytics'&& <AnalyticsView />}
          {view === 'reports' && <Reports apiBase={API} request={officeFetch} />}
          {view === 'setup' && <Setup apiBase={API} pipelineBase={PIPELINE_API} request={officeFetch} />}
          {view === 'deploy'   && <DeployView triggerDeploy={triggerDeploy} deploying={deploying} log={log} />}
          {view === 'autofix'  && <AutofixView />}
          {view === 'versions' && <VersionsView versions={versions} status={status} pipelineStatus={pipelineStatus} />}
        </main>
      </div>
    </>
  );
}
