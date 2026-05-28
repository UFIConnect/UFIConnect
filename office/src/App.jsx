import { useState, useEffect, useRef, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

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

// ─── Overview view ────────────────────────────────────────────────────────────

function OverviewView({ status, log, agents }) {
  const s = status?.server;
  const f = status?.feed;
  const a = status?.agents;

  return (
    <>
      <h1 style={H1}>Command Center</h1>
      <p style={SUBTITLE}>Real-time status of all services and autonomous agents</p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <StatCard icon="⏱" label="Uptime"      value={s ? fmtUptime(s.uptime) : '—'}           sub={s?.env}                                               color="#60a5fa" />
        <StatCard icon="📰" label="Feed Posts"  value={f?.postCount?.toLocaleString() ?? '—'}    sub={f?.refreshedAt ? `refreshed ${fmtAgo(f.refreshedAt)}` : null} color="#4ade80" />
        <StatCard icon="🤖" label="Agents"      value={a?.active ?? '—'}                         sub={`${a?.logSize || 0} log entries`}                      color="#fbbf24" />
        <StatCard icon="🗄️" label="Database"   value={s?.db === 'connected' ? 'Live' : s?.db === 'fallback' ? 'Memory' : '—'} sub={s?.db}                  color={s?.db === 'connected' ? '#4ade80' : '#f97316'} />
        <StatCard icon="📡" label="SSE Clients" value={f?.sseClients ?? '—'}                     sub="feed subscribers"                                      color="#a78bfa" />
        <StatCard icon="🏢" label="Office"      value={a?.officeConnections ?? '—'}              sub="office connections"                                     color="#38bdf8" />
      </div>

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

function AgentsView({ agents, triggerAgent, triggering }) {
  return (
    <>
      <h1 style={H1}>Agent Control</h1>
      <p style={SUBTITLE}>Monitor and manually trigger each autonomous agent. All agents run continuously on their own schedules.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 18 }}>
        {Object.entries(agents).map(([id, ag]) => (
          <Card key={id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ fontSize: 28, lineHeight: 1 }}>{ag.emoji}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: ag.color }}>{ag.name}</div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 1 }}>
                  id: <code style={{ ...CODE, padding: '1px 5px' }}>{id}</code>
                  {' · '}runs every {ag.interval}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Dot ok pulse />
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => triggerAgent(id)}
                  disabled={triggering[id]}
                >
                  {triggering[id] ? '...' : '▶ Run'}
                </Btn>
              </div>
            </div>
            <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.65, margin: '0 0 14px' }}>
              {ag.description}
            </p>
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
        ))}
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
      url: 'https://uficonnect-api.onrender.com',
      health: 'https://uficonnect-api.onrender.com/health',
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
          For the <em>Deploy Now</em> buttons to work, add these to your backend env vars on Render:
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

// ─── Versions view ────────────────────────────────────────────────────────────

function VersionsView({ versions }) {
  const repos = [
    {
      name: 'ProConnect Monorepo',
      desc: 'Backend (Node.js) · Web (React) · Mobile (Expo) · Office (React)',
      url: 'https://github.com/yosufkaka99-alt/proconnect',
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
      const r = await fetch(`${API}/office/status`);
      if (r.ok) setStatus(await r.json());
    } catch {}
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const r = await fetch(`${API}/office/agents`);
      if (r.ok) { const d = await r.json(); setAgents(d.agents); }
    } catch {}
  }, []);

  const fetchVersions = useCallback(async () => {
    try {
      const r = await fetch(`${API}/office/versions`);
      if (r.ok) setVersions(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchAgents();
    fetchVersions();
    const t1 = setInterval(fetchStatus, 10000);
    const t2 = setInterval(fetchAgents, 20000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchStatus, fetchAgents, fetchVersions]);

  // SSE: real-time agent activity pushed from backend
  useEffect(() => {
    let retryTimeout;
    const connect = () => {
      const es = new EventSource(`${API}/office/agents/stream`);
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
    try { await fetch(`${API}/office/agents/${id}/trigger`, { method: 'POST' }); } catch {}
    setTimeout(() => setTriggering(prev => ({ ...prev, [id]: false })), 2000);
  };

  const triggerDeploy = async (service) => {
    setDeploying(prev => ({ ...prev, [service]: true }));
    try { await fetch(`${API}/office/deploy/${service}`, { method: 'POST' }); } catch {}
    setTimeout(() => setDeploying(prev => ({ ...prev, [service]: false })), 5000);
  };

  const nav = [
    { id: 'overview', label: 'Overview',     icon: '◉' },
    { id: 'agents',   label: 'Agents',        icon: '⬡' },
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
              UFIConnect
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
              href="https://uficonnect-api.onrender.com/health"
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
          {view === 'overview' && <OverviewView status={status} log={log} agents={agents} />}
          {view === 'agents'   && <AgentsView agents={agents} triggerAgent={triggerAgent} triggering={triggering} />}
          {view === 'deploy'   && <DeployView triggerDeploy={triggerDeploy} deploying={deploying} log={log} />}
          {view === 'versions' && <VersionsView versions={versions} />}
        </main>
      </div>
    </>
  );
}
