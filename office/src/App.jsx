import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const API = import.meta.env.VITE_API_URL || '';
const OFFICE_TOKEN_KEY = 'ufi_office_token';

// ─── office auth ────────────────────────────────────────────────────────────
// The API accepts requests with no token until OFFICE_TOKEN is set server-side
// (Render dashboard), so this stays a no-op until that's configured — nothing
// changes here until then. Once it is, requests need a matching x-office-token
// header (or ?token= for the EventSource, which can't set custom headers).
function getOfficeToken() {
  try { return localStorage.getItem(OFFICE_TOKEN_KEY) || ''; } catch { return ''; }
}
function setOfficeToken(token) {
  try {
    if (token) localStorage.setItem(OFFICE_TOKEN_KEY, token);
    else localStorage.removeItem(OFFICE_TOKEN_KEY);
  } catch {}
}
async function officeFetch(url, opts = {}) {
  const token = getOfficeToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers['x-office-token'] = token;
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) {
    const entered = window.prompt('Office access token required (set in Render as OFFICE_TOKEN):');
    if (entered) {
      setOfficeToken(entered);
      const retryHeaders = { ...(opts.headers || {}), 'x-office-token': entered };
      return fetch(url, { ...opts, headers: retryHeaders });
    }
  }
  return res;
}
function officeStreamUrl(path) {
  const token = getOfficeToken();
  return token ? `${API}${path}?token=${encodeURIComponent(token)}` : `${API}${path}`;
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

// ─── shared style constants ───────────────────────────────────────────────────

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
      <span style={{ fontSize: 14, lineHeight: 1.5, flexShrink: 0 }}>{entry.emoji}</span>
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
  web_storage: 'Storage', web_api: 'API', web_office: 'Office', web_pwa: 'PWA',
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

  const ttfbColor = !web.lastTtfbMs  ? '#64748b'
    : web.lastTtfbMs  > 800  ? '#f87171'
    : web.lastTtfbMs  > 400  ? '#fbbf24' : '#4ade80';
  const loadColor = !web.lastTotalMs ? '#64748b'
    : web.lastTotalMs > 2500 ? '#f87171' : '#4ade80';
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
          <span style={{ fontSize: 20 }}>🌐</span>
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
          { label: 'TTFB',   value: web.lastTtfbMs  != null ? `${web.lastTtfbMs}ms`  : '—', color: ttfbColor },
          { label: 'Load',   value: web.lastTotalMs != null ? `${web.lastTotalMs}ms` : '—', color: loadColor },
          { label: 'Size',   value: sizeKb           != null ? `${sizeKb} KB`         : '—', color: sizeColor },
          { label: 'Status', value: web.lastStatus   ?? '—',
            color: !web.lastStatus ? '#64748b' : web.lastStatus < 400 ? '#4ade80' : '#f87171' },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: '#475569', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Findings */}
      <div style={{ marginBottom: 16 }}>
        <Label>Findings</Label>
        {!web.findings || web.findings.length === 0 ? (
          <div style={{ fontSize: 12, color: '#4ade80', marginTop: 8 }}>✓ No issues found</div>
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
                  <span style={{ fontSize: 12, color: '#fbbf24' }}>⚠ {f}</span>
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

function OverviewView({ status, log, agents, triggerAgent, triggering }) {
  const s = status?.server;
  const f = status?.feed;
  const a = status?.agents;
  const src = status?.sources;
  const web = status?.websiteOptimizer;
  const pausedWorkers = src?.workers?.filter(w => w.paused) || [];

  return (
    <>
      <h1 style={H1}>Command Center</h1>
      <p style={SUBTITLE}>Real-time status of all services and autonomous agents</p>

      {pausedWorkers.length > 0 && (
        <div style={{
          marginBottom: 20, padding: '10px 16px', borderRadius: 8,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 14 }}>⚠️</span>
          <span style={{ fontSize: 12, color: '#fca5a5' }}>
            <strong>{pausedWorkers.length}</strong> source worker{pausedWorkers.length !== 1 ? 's' : ''} paused by circuit breaker
            {' — '}{pausedWorkers.map(w => w.emoji + ' ' + (w.name?.replace(' Agent','') || w.id)).join(', ')}
            {'. Will auto-resume in ~5min.'}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <StatCard icon="⏱" label="Uptime"        value={s ? fmtUptime(s.uptime) : '—'}           sub={s?.env}                                                     color="#60a5fa" />
        <StatCard icon="📰" label="Feed Posts"    value={f?.postCount?.toLocaleString() ?? '—'}    sub={f?.refreshedAt ? `refreshed ${fmtAgo(f.refreshedAt)}` : null} color="#4ade80" />
        <StatCard icon="🤖" label="Agents"        value={a?.active ?? '—'}                         sub={`${a?.logSize || 0} log entries`}                            color="#fbbf24" />
        <StatCard icon="🗄️" label="Database"     value={s?.db === 'connected' ? 'Live' : s?.db === 'fallback' ? 'Memory' : '—'} sub={s?.db}                        color={s?.db === 'connected' ? '#4ade80' : '#f97316'} />
        <StatCard icon="📡" label="SSE Clients"   value={f?.sseClients ?? '—'}                     sub="feed subscribers"                                            color="#a78bfa" />
        <StatCard
          icon="🌐"
          label="Sources"
          value={src ? `${src.healthy}/${src.total}` : '—'}
          sub={src?.paused ? `${src.paused} paused` : src?.starting ? `${src.starting} starting` : 'all healthy'}
          color={src?.paused ? '#f97316' : src?.starting ? '#94a3b8' : '#4ade80'}
        />
      </div>

      <WebOptimizerPanel web={web} triggerAgent={triggerAgent} triggering={triggering} />

      <Label color="#475569">Agent Status</Label>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
        gap: 10, margin: '12px 0 28px',
      }}>
        {Object.entries(agents).map(([id, ag]) => (
          <Card key={id} style={{ padding: '13px 15px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 20, lineHeight: 1.3, flexShrink: 0 }}>{ag.emoji}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: ag.color }}>{ag.name}</div>
              <div style={{
                fontSize: 11, color: '#64748b', marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {ag.lastAction?.msg || 'Standby...'}
              </div>
            </div>
            <Dot ok pulse />
          </Card>
        ))}
      </div>

      <Label color="#475569">Live Activity Stream</Label>
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
      <p style={SUBTITLE}>Monitor and manually trigger each autonomous agent. All agents run continuously on their own schedules.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 18 }}>
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
                  <Dot ok={!isPaused} pulse={!isPaused} />
                  <Btn size="sm" variant={isPaused ? 'danger' : 'ghost'} onClick={() => triggerAgent(id)} disabled={triggering[id]}>
                    {triggering[id] ? '...' : isPaused ? '↺ Reset' : '▶ Run'}
                  </Btn>
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
                  <span>Fetches: <strong style={{ color: '#94a3b8' }}>{ag.health.fetchCount?.toLocaleString() ?? 0}</strong></span>
                  <span>Errors: <strong style={{ color: ag.health.totalErrors ? '#f87171' : '#4ade80' }}>{ag.health.totalErrors ?? 0}</strong></span>
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
                    <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>No recent activity — click Run to trigger</div>
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
      url: 'https://uficonnect-api-708r.onrender.com',
      health: 'https://uficonnect-api-708r.onrender.com/health',
      icon: '⚙️',
      hook: 'RENDER_HOOK_API',
    },
    {
      slug: 'web',
      name: 'Web Frontend',
      desc: 'React SPA — main user-facing app',
      url: 'https://uficonnect.org',
      icon: '🌐',
      hook: 'RENDER_HOOK_WEB',
    },
    {
      slug: 'office',
      name: 'Office',
      desc: 'This dashboard — operations & monitoring',
      url: 'https://office.uficonnect.org',
      icon: '🏢',
      hook: 'RENDER_HOOK_OFFICE',
    },
  ];

  const deployLogs = log.filter(e => e.agentId === 'deploy').slice(0, 8);

  return (
    <>
      <h1 style={H1}>Deploy Center</h1>
      <p style={SUBTITLE}>
        Push to <strong style={{ color: '#e2e8f0' }}>main</strong> for automatic deploys, or trigger a manual redeploy here.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 13, maxWidth: 680, marginBottom: 30 }}>
        {services.map(({ slug, name, desc, url, icon, hook }) => (
          <Card key={slug} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 30, flexShrink: 0 }}>{icon}</span>
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
          Auto-Deploy is Active
        </div>
        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.8 }}>
          Every push to <code style={CODE}>main</code> automatically triggers a rebuild and deploy via Render's GitHub integration — typically live within 2–3 minutes.
          <br />
          For the <em>Deploy Now</em> buttons to work, add deploy hooks or Render API credentials to the backend env vars:
          <br />
          <code style={CODE}>RENDER_HOOK_API</code> · <code style={CODE}>RENDER_HOOK_WEB</code> · <code style={CODE}>RENDER_HOOK_OFFICE</code>
          <br />
          Find your deploy hooks under each service → <em>Settings → Deploy Hook</em> in the Render dashboard.
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

// ─── Analytics view ───────────────────────────────────────────────────────────

function AnalyticsView() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [users, setUsers] = useState(null);
  const [usersError, setUsersError] = useState(false);
  const [deletingId, setDeletingId] = useState(null);

  const loadUsers = useCallback(() => {
    officeFetch(`${API}/office/users`)
      .then(r => r.json())
      .then(j => setUsers(j))
      .catch(() => setUsersError(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    officeFetch(`${API}/office/analytics/pageviews`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setData(j); })
      .catch(() => { if (!cancelled) setError(true); });
    officeFetch(`${API}/office/users`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setUsers(j); })
      .catch(() => { if (!cancelled) setUsersError(true); });
    return () => { cancelled = true; };
  }, []);

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
      <p style={SUBTITLE}>First-party pageview counts, logged straight from the site — no external account required. See also GA4 at analytics.google.com.</p>

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
              <Label>Total signups</Label>
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
                  {deletingId === u.id ? '…' : '🗑'}
                </button>
              </Card>
            ))}
          </div>
        </>
      )}

      {data && data.available && (
        <>
          <Label color="#475569">Pageviews (anonymous)</Label>
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
          </div>

          <Label color="#475569">Top Pages (30d)</Label>
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
                <div style={{ width: 90 }}>{new Date(d.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                <div style={{ flex: 1, background: 'rgba(255,255,255,.05)', borderRadius: 4, height: 14, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, (d.views / Math.max(...data.daily.map(x => x.views), 1)) * 100)}%`,
                    background: '#3b82f6', height: '100%',
                  }} />
                </div>
                <div style={{ width: 40, textAlign: 'right', color: '#e2e8f0', fontWeight: 600 }}>{d.views}</div>
                <div style={{ width: 60, textAlign: 'right' }}>{d.visitors} uniq</div>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ─── Versions view ────────────────────────────────────────────────────────────

function VersionsView({ versions }) {
  const repos = [
    {
      name: 'UFconnect Monorepo',
      desc: 'Backend (Node.js) · Web (React) · Mobile (Expo) · Office (React)',
      url: 'https://github.com/yosufkaka99-alt/UFConnect',
      icon: '📦',
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
            {versions.services.map(svc => (
              <Card key={svc.slug} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px' }}>
                <Dot ok pulse />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{svc.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>{svc.domain}</div>
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
            ))}
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
          <li>Render detects the push and auto-deploys within ~2 minutes</li>
          <li>Or use the Deploy Center tab for an instant manual redeploy</li>
        </ol>
        <div style={{ marginTop: 12, fontSize: 11, color: '#334155' }}>
          Each service (API, Web, Office) has its own Render build — pushing once redeploys all three simultaneously.
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
        <StatCard icon="🌐" label="Total Sources"   value={src?.total ?? '—'}    sub="active workers"            color="#60a5fa" />
        <StatCard icon="✅" label="Healthy"          value={src?.healthy ?? '—'}  sub="fetching or fallback-backed" color="#4ade80" />
        <StatCard icon="⏳" label="Starting"         value={src?.starting ?? '—'} sub="awaiting first fetch"       color="#94a3b8" />
        <StatCard icon="⚠️" label="Degraded"        value={src?.degraded ?? '—'} sub="≥3 consecutive errors"     color="#fbbf24" />
        <StatCard icon="🔴" label="Paused"           value={src?.paused ?? '—'}   sub="circuit breaker tripped"   color="#f87171" />
        <StatCard icon="📰" label="Total Seen"
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
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{w.emoji}</span>
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
                  <span>📥 <strong style={{ color: '#e2e8f0' }}>{(w.postCount || 0).toLocaleString()}</strong> posts</span>
                  <span>🔄 <strong style={{ color: '#e2e8f0' }}>{(w.fetchCount || 0).toLocaleString()}</strong> fetches</span>
                  <span>❌ <strong style={{ color: w.totalErrors ? '#f87171' : '#4ade80' }}>{errorRate}%</strong> err</span>
                </div>

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
                        {triggering[w.id] ? '...' : w.paused ? '↺ Reset' : '▶ Run'}
                      </button>
                    </div>
                    {w.paused && (
                      <div style={{ fontSize: 10, color: '#f87171', padding: '4px 8px', background: 'rgba(239,68,68,.06)', borderRadius: 4 }}>
                        ⏸ Paused — {w.consecutiveErrors} consecutive errors. Auto-resumes in ~5 min.
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
            {triggering.sort_agent ? '...' : '🧮 Re-sort now'}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => triggerAgent('sort_distrib')} disabled={triggering.sort_distrib}>
            {triggering.sort_distrib ? '...' : '🔀 Re-diversify now'}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => triggerAgent('mix_optimizer')} disabled={triggering.mix_optimizer}>
            {triggering.mix_optimizer ? '...' : '🎛️ Audit mix now'}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => triggerAgent('sort_optimizer')} disabled={triggering.sort_optimizer}>
            {triggering.sort_optimizer ? '...' : '🧭 Audit ranking now'}
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

function TransferHelperPanel({ status, triggerAgent, triggering }) {
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
        <Label color="#38bdf8">Transfer Helper</Label>
        <Btn size="sm" onClick={() => triggerAgent('feed')} disabled={triggering.feed || running}>
          {running ? 'Transferring...' : '⇪ Transfer content to website'}
        </Btn>
      </div>
      <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 16px' }}>
        Queues every source worker to refetch, then drains the queue one at a time (paced — this is
        the same mechanism a full refresh always used, just now with visible progress instead of firing blind).
      </p>

      <div style={{
        background: running ? 'rgba(56,189,248,.06)' : 'rgba(255,255,255,.02)',
        border: `1px solid ${running ? 'rgba(56,189,248,.2)' : 'rgba(255,255,255,.06)'}`,
        borderRadius: 8, padding: '12px 14px', marginBottom: 14,
      }}>
        {running ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
              <span style={{ color: '#e2e8f0' }}>
                Transferring <strong>{q.currentId || '…'}</strong>
              </span>
              <span style={{ color: '#60a5fa' }}>{q.batchDone}/{q.batchTotal} done · {q.pending} queued</span>
            </div>
            <div style={{ height: 6, borderRadius: 4, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: '#38bdf8', transition: 'width .3s' }} />
            </div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: '#64748b' }}>
            Idle — {q?.lastFinished ? `last transfer finished ${fmtAgo(q.lastFinished)}` : 'no transfer run yet'}
            {q?.lastReason ? ` (${q.lastReason})` : ''}
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 14, marginBottom: outage?.active ? 14 : 0 }}>
        <Label color="#60a5fa">Transfer to a specific filter</Label>
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
              <option key={w.id} value={w.id}>{w.emoji} {(w.name || w.id).replace(' Agent', '')}</option>
            ))}
          </select>
          <Btn
            size="sm"
            onClick={() => targetSource && triggerAgent(targetSource)}
            disabled={!targetSource || targetBusy}
          >
            {targetBusy ? 'Transferring...' : '⇪ Transfer to filter'}
          </Btn>
        </div>
        {targetWorker && (
          <div style={{ fontSize: 11, color: '#475569', marginTop: 8 }}>
            {targetWorker.lastSuccess ? `Last transferred ${fmtAgo(targetWorker.lastSuccess)}` : 'Never transferred yet'}
            {' · '}{(targetWorker.postCount || 0).toLocaleString()} posts seen
          </div>
        )}
      </div>

      {outage?.active && (
        <div style={{ fontSize: 11, color: '#fbbf24', padding: '8px 10px', background: 'rgba(251,191,36,.08)', borderRadius: 6, marginBottom: 4 }}>
          🟠 Reddit is in a protective backoff right now — its anonymous endpoints are being rate-limited
          by Reddit, so it's standing down rather than retrying (until {fmtTime(outage.until)}). This is
          expected behavior, not a broken source.
        </div>
      )}
    </Card>
  );
}

function FeedManagerView({ status, triggerAgent, triggering }) {
  return (
    <>
      <h1 style={H1}>Feed Manager</h1>
      <p style={SUBTITLE}>Manage how the shared feed is sorted and how content moves from the office's source workers to the live site.</p>
      <SortHelperPanel status={status} triggerAgent={triggerAgent} triggering={triggering} />
      <TransferHelperPanel status={status} triggerAgent={triggerAgent} triggering={triggering} />
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

function FlowConnector({ colors, fast }) {
  const dur = fast ? 1.1 : 2.6;
  return (
    <div style={{
      position: 'relative', height: 4, flex: '0 0 56px', margin: '0 2px',
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
      <text x={32} y={38} textAnchor="middle" fontSize={18} fill="#e2e8f0">⇪</text>
    </svg>
  );
}

function PipelineView({ status }) {
  const [pageviews, setPageviews] = useState(null);
  useEffect(() => {
    let cancelled = false;
    officeFetch(`${API}/office/analytics/pageviews`).then(r => r.json())
      .then(j => { if (!cancelled) setPageviews(j); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const workers = (status?.sources?.workers || []).slice().sort((a, b) => (b.postCount || 0) - (a.postCount || 0));
  const healthyCount = workers.filter(w => ['healthy', 'ready', 'fallback', 'pro'].includes(w.status)).length;
  const composition  = status?.feed?.composition || [];
  const filterAgent  = status?.filterAgent;
  const sortAgent    = status?.sortAgent;
  const topicFilterAgent = status?.topicFilterAgent;
  const twoPhaseMixAgent = status?.twoPhaseMixAgent;
  const q            = status?.refreshQueue;
  const running      = !!q?.running;
  const pct          = q?.batchTotal ? Math.round((q.batchDone / q.batchTotal) * 100) : 0;

  return (
    <>
      <h1 style={H1}>Pipeline</h1>
      <p style={SUBTITLE}>
        Every platform, live — from fetch through filtering, sorting, transfer, per-user topic narrowing, and onto the site. Moves in real time as it actually happens, nothing staged for the screenshot.
      </p>

      <Card style={{ overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'stretch', minWidth: 1400 }}>
          {/* Stage 1 — Sources */}
          <PipelineNode style={{ flex: '1 1 360px', minWidth: 320 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Label color="#60a5fa">Sources</Label>
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
                      <span style={{ fontSize: 12, lineHeight: 1 }}>{w.emoji}</span>
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

          <FlowConnector colors={['#60a5fa', '#fbbf24']} />

          {/* Stage 2 — Filter: every fetched post's first checkpoint, before
              it's even eligible for sorting — see filterAgentState/
              addAndBroadcast server-side. Two independent drops happen
              here: invalid (no id, or a fallback/placeholder post) and
              duplicate (already broadcast by this or another source, within
              the rolling seenPostIds window). */}
          <PipelineNode glow="#fbbf24" style={{ flex: '0 0 200px', textAlign: 'center', alignItems: 'center' }}>
            <Label color="#fbbf24">Filter</Label>
            <div style={{
              width: 62, height: 62, borderRadius: '50%', margin: '14px 0',
              background: 'radial-gradient(circle, rgba(251,191,36,.28), rgba(251,191,36,.03))',
              border: '1px solid rgba(251,191,36,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              animation: 'glowPulse 2.4s ease-in-out infinite',
            }}>🧹</div>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, marginBottom: 8, fontWeight: 700 }}>
              <span style={{ color: '#f87171' }}>−{((filterAgent?.lastDroppedInvalid ?? 0) + (filterAgent?.lastDroppedDuplicate ?? 0)).toLocaleString()}</span>
              <span style={{ color: '#4ade80' }}>+{(filterAgent?.lastOutput ?? 0).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {filterAgent?.lastRun ? `Filtered ${fmtAgo(filterAgent.lastRun)}` : 'Not run yet'}
            </div>
          </PipelineNode>

          <FlowConnector colors={['#fbbf24', '#a78bfa']} />

          {/* Stage 3 — Sort & Rank */}
          <PipelineNode glow="#a78bfa" style={{ flex: '0 0 200px', textAlign: 'center', alignItems: 'center' }}>
            <Label color="#a78bfa">Sort &amp; Rank</Label>
            <div style={{
              width: 62, height: 62, borderRadius: '50%', margin: '14px 0',
              background: 'radial-gradient(circle, rgba(167,139,250,.28), rgba(167,139,250,.03))',
              border: '1px solid rgba(167,139,250,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              animation: 'glowPulse 2.4s ease-in-out infinite',
            }}>🧮</div>
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

          <FlowConnector colors={['#a78bfa', '#38bdf8']} fast={running} />

          {/* Stage 4 — Transfer */}
          <PipelineNode glow={running ? '#38bdf8' : undefined} style={{ flex: '0 0 200px', textAlign: 'center', alignItems: 'center' }}>
            <Label color="#38bdf8">Transfer</Label>
            <div style={{ margin: '14px 0' }}>
              <TransferRing pct={pct} active={running} />
            </div>
            <div style={{ fontSize: 11, color: running ? '#38bdf8' : '#64748b' }}>
              {running
                ? `${q.currentId || '…'} · ${q.batchDone}/${q.batchTotal}`
                : (q?.lastFinished ? `Idle · last ${fmtAgo(q.lastFinished)}` : 'Idle — no transfer run yet')}
            </div>
          </PipelineNode>

          <FlowConnector colors={['#38bdf8', '#f472b6']} />

          {/* Stage 5 — Topic Filter: the one genuinely per-user step in this
              pipeline — every stage before this is shared/global, the same
              for every visitor. Hard-excludes anything not matching
              whichever topics this specific viewer picked at signup (see
              filterByUserTopics server-side). "Last run" reflects whichever
              request happened most recently, same live-motion convention
              Sort & Rank's own node already uses for its own per-request
              calls — not a global aggregate. */}
          <PipelineNode glow="#f472b6" style={{ flex: '0 0 200px', textAlign: 'center', alignItems: 'center' }}>
            <Label color="#f472b6">Topic Filter</Label>
            <div style={{
              width: 62, height: 62, borderRadius: '50%', margin: '14px 0',
              background: 'radial-gradient(circle, rgba(244,114,182,.28), rgba(244,114,182,.03))',
              border: '1px solid rgba(244,114,182,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              animation: 'glowPulse 2.4s ease-in-out infinite',
            }}>🎯</div>
            <div style={{ display: 'flex', gap: 8, fontSize: 11, marginBottom: 8, fontWeight: 700 }}>
              <span style={{ color: '#f87171' }}>−{(topicFilterAgent?.lastDropped ?? 0).toLocaleString()}</span>
              <span style={{ color: '#4ade80' }}>+{(topicFilterAgent?.lastOutput ?? 0).toLocaleString()}</span>
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {topicFilterAgent?.lastRun ? `Filtered ${fmtAgo(topicFilterAgent.lastRun)}` : 'Not run yet'}
            </div>
          </PipelineNode>

          <FlowConnector colors={['#f472b6', '#4ade80']} />

          {/* Stage 6 — Viewed (live site) */}
          <PipelineNode glow="#4ade80" style={{ flex: '1 1 200px', textAlign: 'center', alignItems: 'center' }}>
            <Label color="#4ade80">Viewed</Label>
            <div style={{
              width: 62, height: 62, borderRadius: '50%', margin: '14px 0',
              background: 'radial-gradient(circle, rgba(74,222,128,.24), rgba(74,222,128,.03))',
              border: '1px solid rgba(74,222,128,.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
              animation: 'glowPulse 2.4s ease-in-out infinite',
            }}>🌐</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', lineHeight: 1 }}>
              {pageviews?.available === false ? '—' : (pageviews?.today ?? '—')}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>views · last 24h</div>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginTop: 20 }}>
        <FilterDetailCard filterAgent={filterAgent} />
        <SortRankDetailCard sortAgent={sortAgent} distrib={status?.sortDistributionAgent} composition={composition} />
        <TransferDetailCard q={q} />
        <TopicFilterDetailCard topicFilterAgent={topicFilterAgent} />
        <TransferByTopicCard twoPhaseMixAgent={twoPhaseMixAgent} />
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
        {filterAgent?.lastError && <div style={{ color: '#f87171', marginTop: 4 }}>⚠ {filterAgent.lastError}</div>}
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
        {sortAgent?.lastError && <div style={{ color: '#f87171', marginTop: 4 }}>⚠ {sortAgent.lastError}</div>}
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
function TransferDetailCard({ q }) {
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
      <Label color="#38bdf8">Transfer — detail</Label>
      <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 14px', lineHeight: 1.6 }}>
        Queues every source worker, then drains one at a time — paced deliberately so a full refresh can't spike
        load the way firing every source at once used to.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 12, marginBottom: 14 }}>
        <DetailStat label="status" value={running ? 'Running' : 'Idle'} color={running ? '#38bdf8' : '#64748b'} />
        <DetailStat label="sources / sec" value={rate ? rate.toFixed(2) : (running ? 'measuring…' : '—')} color="#38bdf8" />
        <DetailStat label="pending" value={(q?.pending ?? 0).toLocaleString()} />
        <DetailStat label="ETA" value={etaS != null ? `~${etaS}s` : '—'} />
      </div>

      <div style={{ fontSize: 11, color: '#475569', borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 10, lineHeight: 1.8 }}>
        <div>Total transfer runs: <span style={{ color: '#94a3b8' }}>{(q?.totalRuns ?? 0).toLocaleString()}</span></div>
        <div>Last full run took: <span style={{ color: '#94a3b8' }}>{lastFullRunS != null ? `${lastFullRunS}s` : '—'}</span></div>
        <div>Reason: <span style={{ color: '#94a3b8' }}>{q?.lastReason || '—'}</span></div>
        {q?.lastError && <div style={{ color: '#f87171' }}>⚠ {q.lastError}</div>}
      </div>
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
        {topicFilterAgent?.lastError && <div style={{ color: '#f87171', marginTop: 4 }}>⚠ {topicFilterAgent.lastError}</div>}
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

// The real transfer, animated: exactly how many posts of each topic have
// actually landed in a genuine viewer's feed or Videos (buildTwoPhaseMix's
// phase 2 — see twoPhaseMixAgent's own comment server-side), not just how
// big the candidate pool was before filtering (that's TopicFilterDetailCard
// above). One growing bar per topic, same grow-in-on-load treatment as the
// Topics view, so it's visibly obvious this is live data landing in real
// feeds and not a static table.
function TransferByTopicCard({ twoPhaseMixAgent }) {
  const [grown, setGrown] = useState(false);
  const byTopic = twoPhaseMixAgent?.byTopic || [];

  useEffect(() => {
    if (!byTopic.length) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true)));
    return () => cancelAnimationFrame(id);
  }, [byTopic.length]);

  const maxPosts = Math.max(1, ...byTopic.map(t => t.posts));

  return (
    <Card>
      <Label color="#a78bfa">Transfer — by topic</Label>
      <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 14px', lineHeight: 1.6 }}>
        Every post that survives Sort &amp; Rank and the Topic Filter still has to actually land somewhere — this is
        that landing, counted per topic, straight from real feed/Videos responses. Not a sample: every run updates
        every bar below.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 12, marginBottom: 14 }}>
        <DetailStat label="total runs" value={(twoPhaseMixAgent?.totalRuns ?? 0).toLocaleString()} color="#a78bfa" />
        <DetailStat label="last intro size" value={(twoPhaseMixAgent?.lastIntroCount ?? 0).toLocaleString()} />
        <DetailStat label="topics seen" value={byTopic.length.toLocaleString()} />
        <DetailStat label="last run" value={twoPhaseMixAgent?.lastRun ? fmtAgo(twoPhaseMixAgent.lastRun) : '—'} />
      </div>

      {byTopic.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
          {byTopic.map((t, i) => (
            <div key={t.topic}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3, gap: 10 }}>
                <span style={{ fontSize: 11.5, color: '#e2e8f0', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.topic}</span>
                <span style={{ fontSize: 10.5, color: '#64748b', flexShrink: 0 }}>{t.posts.toLocaleString()} posts · {t.runs.toLocaleString()} runs</span>
              </div>
              <div style={{
                height: 8, borderRadius: 3, background: 'rgba(255,255,255,.04)', overflow: 'hidden',
                width: grown ? `${Math.max(1.5, (t.posts / maxPosts) * 100)}%` : '0%',
                transition: `width .6s cubic-bezier(.16,1,.3,1) ${Math.min(i * 15, 400)}ms`,
              }}>
                <div style={{ width: '100%', height: '100%', background: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length] }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: '#475569' }}>No transfers recorded yet — waits for a real logged-in viewer to load their feed.</div>
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

  return (
    <Card>
      <Label color="#4ade80">Viewed — detail</Label>
      <p style={{ fontSize: 11.5, color: '#64748b', margin: '6px 0 14px', lineHeight: 1.6 }}>
        First-party pageview log, one row per route change on the live site — a rolling window, not calendar days
        (so "last 24h" won't match a GA-style "today" bucket lined up on midnight).
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        <DetailStat label="last 24h" value={pageviews.today.toLocaleString()} color="#4ade80" />
        <DetailStat label="last 7d" value={pageviews.last7.toLocaleString()} />
        <DetailStat label="last 30d" value={pageviews.last30.toLocaleString()} />
      </div>

      {daily.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Last {daily.length} days</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 54 }}>
            {daily.map((d, i) => {
              const h = Math.max(2, Math.round((d.views / maxViews) * 54));
              const isFlat = d.views === 0;
              return (
                <div key={i} title={`${new Date(d.day).toLocaleDateString()}: ${d.views} views, ${d.visitors} visitors`} style={{
                  flex: 1, height: h, borderRadius: '2px 2px 0 0',
                  background: isFlat ? 'rgba(239,68,68,.5)' : '#4ade80',
                  opacity: isFlat ? 1 : 0.55 + (0.45 * (d.views / maxViews)),
                  minWidth: 6,
                }} />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#334155', marginTop: 4 }}>
            <span>{new Date(daily[0].day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            <span>{new Date(daily[daily.length - 1].day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
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
                <span style={{ color: '#e2e8f0', fontWeight: 700, flexShrink: 0 }}>{p.views.toLocaleString()}</span>
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
            All {topics.length} topics UFconnect fetches for, live from the database — how many posts each actually
            has, and exactly which platforms filled it. Real totals, not the capped in-memory pool.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {lastLoaded && (
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {refreshing ? 'Refreshing…' : `Loaded ${fmtAgo(lastLoaded)}`}
            </span>
          )}
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

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18, marginTop: 18 }}>
        {[...sourceColor.entries()].map(([source, color]) => (
          <span key={source} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
            {source}
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
  const [view, setView] = useState('overview');
  const [status, setStatus] = useState(null);
  const [agents, setAgents] = useState({});
  const [log, setLog] = useState([]);
  const [deploying, setDeploying] = useState({});
  const [triggering, setTriggering] = useState({});
  const [versions, setVersions] = useState(null);
  const [connected, setConnected] = useState(false);
  const sseRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await officeFetch(`${API}/office/status`);
      if (r.ok) setStatus(await r.json());
    } catch {}
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const r = await officeFetch(`${API}/office/agents`);
      if (r.ok) { const d = await r.json(); setAgents(d.agents); }
    } catch {}
  }, []);

  const fetchVersions = useCallback(async () => {
    try {
      const r = await officeFetch(`${API}/office/versions`);
      if (r.ok) setVersions(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchAgents();
    fetchVersions();
    const t1 = setInterval(fetchStatus,  8000);
    const t2 = setInterval(fetchAgents, 15000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchStatus, fetchAgents, fetchVersions]);

  // SSE: real-time agent activity pushed from backend
  useEffect(() => {
    let retryTimeout;
    const connect = () => {
      const es = new EventSource(officeStreamUrl('/office/agents/stream'));
      sseRef.current = es;
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es.close();
        retryTimeout = setTimeout(connect, 4000);
      };
      es.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        if (data.backlog) {
          setLog(data.backlog);
          // Seed each agent's lastAction from backlog
          setAgents(prev => {
            const next = { ...prev };
            for (const entry of data.backlog) {
              if (next[entry.agentId] && !next[entry.agentId].lastAction) {
                next[entry.agentId] = { ...next[entry.agentId], lastAction: entry };
              }
            }
            return next;
          });
        } else {
          setLog(prev => [data, ...prev].slice(0, 300));
          setAgents(prev => {
            if (!prev[data.agentId]) return prev;
            return {
              ...prev,
              [data.agentId]: {
                ...prev[data.agentId],
                lastAction: data,
                logs: [data, ...(prev[data.agentId].logs || [])].slice(0, 15),
              },
            };
          });
        }
      };
    };
    connect();
    return () => { clearTimeout(retryTimeout); sseRef.current?.close(); };
  }, []);

  const triggerAgent = async (id) => {
    setTriggering(prev => ({ ...prev, [id]: true }));
    try {
      const r = await officeFetch(`${API}/office/agents/${id}/trigger`, { method: 'POST' });
      // A 404 here means this id isn't a key in the backend's trigger map (or
      // a live SOURCE_FETCHERS entry) — a silent no-op otherwise. Surface it
      // in the console so a future button/id mismatch like this is visible
      // to whoever's driving the dashboard, instead of just looking like the
      // agent quietly did nothing.
      if (!r.ok) console.error(`Trigger failed for "${id}": HTTP ${r.status}`);
    } catch (e) { console.error(`Trigger failed for "${id}":`, e); }
    setTimeout(() => setTriggering(prev => ({ ...prev, [id]: false })), 2000);
  };

  const triggerDeploy = async (service) => {
    setDeploying(prev => ({ ...prev, [service]: true }));
    try { await officeFetch(`${API}/office/deploy/${service}`, { method: 'POST' }); } catch {}
    setTimeout(() => setDeploying(prev => ({ ...prev, [service]: false })), 5000);
  };

  const nav = [
    { id: 'overview', label: 'Overview',     icon: '◉' },
    { id: 'sources',  label: 'Live Sources', icon: '🌐' },
    { id: 'pipeline', label: 'Pipeline',      icon: '⚡' },
    { id: 'topics',   label: 'Topics',        icon: '🏷️' },
    { id: 'agents',   label: 'Agents',        icon: '⬡' },
    { id: 'feed',     label: 'Feed Manager', icon: '🧮' },
    { id: 'analytics',label: 'Analytics',    icon: '📈' },
    { id: 'deploy',   label: 'Deploy Center', icon: '↑' },
    { id: 'versions', label: 'Versions',      icon: '≡' },
  ];

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
      `}</style>

      <div style={{
        display: 'flex', minHeight: '100vh',
        background: '#080810', color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}>
        {/* ── Sidebar ── */}
        <aside style={{
          width: 224, flexShrink: 0,
          background: '#08080f',
          borderRight: '1px solid rgba(255,255,255,.06)',
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '26px 20px 18px' }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', letterSpacing: -0.5 }}>
              UFconnect
            </div>
            <div style={{ fontSize: 10, color: '#334155', marginTop: 2, textTransform: 'uppercase', letterSpacing: 1.2 }}>
              Operations Office
            </div>
          </div>

          <nav style={{ flex: 1 }}>
            {nav.map(({ id, label, icon }) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                    padding: '11px 20px', border: 'none', cursor: 'pointer', textAlign: 'left',
                    fontSize: 13, fontWeight: active ? 700 : 400,
                    background: active ? 'rgba(59,130,246,.1)' : 'transparent',
                    color: active ? '#60a5fa' : '#64748b',
                    borderRight: `2px solid ${active ? '#3b82f6' : 'transparent'}`,
                    transition: 'color .15s, background .15s',
                  }}
                >
                  <span style={{ fontSize: 16, opacity: active ? 1 : 0.7 }}>{icon}</span>
                  {label}
                </button>
              );
            })}
          </nav>

          <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <Dot ok={connected} pulse={connected} />
              <span style={{ fontSize: 11, color: '#475569' }}>
                {connected ? 'Live stream active' : 'Reconnecting...'}
              </span>
            </div>
            <a
              href="https://uficonnect.org"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 10, color: '#334155', display: 'block', marginBottom: 2 }}
            >
              uficonnect.org ↗
            </a>
            <a
              href="https://uficonnect-api-708r.onrender.com/health"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 10, color: '#334155', display: 'block' }}
            >
              api health ↗
            </a>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main style={{ flex: 1, padding: '36px 40px', overflowY: 'auto', maxHeight: '100vh' }}>
          {view === 'overview' && <OverviewView status={status} log={log} agents={agents} triggerAgent={triggerAgent} triggering={triggering} />}
          {view === 'sources'  && <SourcesView status={status} triggerAgent={triggerAgent} triggering={triggering} />}
          {view === 'pipeline' && <PipelineView status={status} />}
          {view === 'topics'   && <TopicsView />}
          {view === 'agents'   && <AgentsView agents={agents} triggerAgent={triggerAgent} triggering={triggering} />}
          {view === 'feed'     && <FeedManagerView status={status} triggerAgent={triggerAgent} triggering={triggering} />}
          {view === 'analytics'&& <AnalyticsView />}
          {view === 'deploy'   && <DeployView triggerDeploy={triggerDeploy} deploying={deploying} log={log} />}
          {view === 'versions' && <VersionsView versions={versions} />}
        </main>
      </div>
    </>
  );
}
