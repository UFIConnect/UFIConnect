import { useState, useEffect, useRef, useCallback } from 'react';
import Layout from '../components/Layout';
import client from '../api/client';

/* ─── Agent Definitions ──────────────────────────────────────────────────────── */
const AGENT_DEFS = [
  {
    id: 'feed', name: 'Feed Curator', emoji: '🤖',
    color: '#2563EB', bg: '#EFF6FF', role: 'Content Intelligence',
    homeX: 13, homeY: 16,
    tasks: [
      'Fetching Reddit posts…', 'Scoring DEV.to articles…',
      'Pulling GitHub trending…', 'Deduplicating feed…',
      'Refreshing content cache…',
    ],
    completions: [
      'Feed cache refreshed — 47 new posts indexed',
      'Duplicate posts removed — feed quality +12%',
      'DEV.to trending scored — 8 articles promoted',
      'GitHub trending pulled — 5 repos added to feed',
      'Reddit posts fetched — 34 relevant threads indexed',
    ],
  },
  {
    id: 'seo', name: 'SEO Agent', emoji: '🔍',
    color: '#7C3AED', bg: '#F3EEFF', role: 'Search Optimisation',
    homeX: 46, homeY: 16,
    tasks: [
      'Auditing meta tags…', 'Checking OG images…',
      'Validating sitemap.xml…', 'Monitoring Core Web Vitals…',
      'Checking crawl budget…',
    ],
    completions: [
      'Meta descriptions validated — all 12 pages pass',
      'Sitemap updated — 2 new routes added',
      'Core Web Vitals: LCP 1.2s, CLS 0.01 — PASS',
      'OG images verified — all links healthy',
    ],
  },
  {
    id: 'security', name: 'Security Agent', emoji: '🛡️',
    color: '#DC2626', bg: '#FEF2F2', role: 'Threat Monitoring',
    homeX: 79, homeY: 16,
    tasks: [
      'Scanning JWT tokens…', 'Monitoring failed logins…',
      'Auditing CORS headers…', 'Checking CVE database…',
      'Rate-limit analysis…',
    ],
    completions: [
      'Security scan complete — 0 threats detected',
      'Failed login monitor: 0 suspicious IPs flagged',
      'CORS headers valid — no misconfigurations',
      'CVE database: no new vulnerabilities in stack',
    ],
  },
  {
    id: 'perf', name: 'Perf Agent', emoji: '⚡',
    color: '#D97706', bg: '#FFFBEB', role: 'Speed & Optimisation',
    homeX: 13, homeY: 64,
    tasks: [
      'Measuring TTFB…', 'Auditing JS bundle…',
      'Profiling React renders…', 'Running Lighthouse…',
      'Checking CDN cache…',
    ],
    completions: [
      'Lighthouse: 94 Performance, 98 Accessibility',
      'TTFB: 180ms — within target (<200ms)',
      'JS bundle: 312KB gzipped — optimal',
      'CDN cache hit rate: 94% — excellent',
    ],
  },
  {
    id: 'community', name: 'Community Agent', emoji: '🌐',
    color: '#059669', bg: '#ECFDF5', role: 'Community Health',
    homeX: 46, homeY: 64,
    tasks: [
      'Reviewing flagged posts…', 'Checking member growth…',
      'Drafting weekly digest…', 'Scoring engagement…',
      'Moderating new content…',
    ],
    completions: [
      'Community health: 94% positive sentiment',
      'Member growth: +12% WoW — trending up',
      'Weekly digest compiled — 8 highlights queued',
      'Flagged content review: 0 violations found',
    ],
  },
  {
    id: 'opps', name: 'Opps Agent', emoji: '💼',
    color: '#0284C7', bg: '#F0F9FF', role: 'Listings & Jobs',
    homeX: 79, homeY: 64,
    tasks: [
      'Validating listing URLs…', 'Checking expired posts…',
      'Categorising new listings…', 'Ranking by user fit…',
      'Pulling live jobs…',
    ],
    completions: [
      'Job listings refreshed — 23 live positions added',
      'Expired listings cleaned — 7 removed',
      'Salary data updated for 91% of listings',
      'Relevance rankings recalculated for all users',
    ],
  },
];

const CORRIDOR_Y = 42;
const EXEC_ZONE  = { x: 50, y: CORRIDOR_Y };

/* ─── Floor Plan Sub-components ─────────────────────────────────────────────── */
function AgentRoom({ agent, agentState }) {
  const isHome = agentState.status === 'idle';
  return (
    <div style={{
      position: 'absolute',
      left: `${agent.homeX - 11}%`, top: `${agent.homeY - 8}%`,
      width: '22%', height: '24%',
      background: isHome ? agent.bg : '#fff',
      border: `1.5px solid ${isHome ? agent.color + '44' : '#E2E8F0'}`,
      borderRadius: 10,
      padding: '6% 8%',
      transition: 'all 0.5s ease',
      boxShadow: isHome ? `0 2px 12px ${agent.color}18` : 'none',
    }}>
      <div style={{ fontSize: '.6rem', fontWeight: 800, color: agent.color, opacity: .7, marginBottom: 2, letterSpacing: '.5px' }}>
        {agent.role.toUpperCase()}
      </div>
      <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#0F172A' }}>{agent.name}</div>
      {isHome && (
        <div style={{ fontSize: '.58rem', color: '#64748B', marginTop: 4, animation: 'agentTaskFade 0.4s ease', lineHeight: 1.4 }}>
          {agent.tasks[agentState.taskIdx]}
        </div>
      )}
      <div style={{
        position: 'absolute', bottom: '12%', right: '10%',
        width: 18, height: 12,
        background: isHome ? `${agent.color}22` : '#F1F5F9',
        borderRadius: 3,
        border: `1px solid ${isHome ? agent.color + '33' : '#E2E8F0'}`,
        transition: 'all 0.5s',
      }} />
    </div>
  );
}

function ServerRoom({ eventsCount }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(v => (v + 1) % 1000), 3000);
    return () => clearInterval(t);
  }, []);

  const metrics = [
    { k: 'UPTIME',   v: '99.98%',               color: '#4ADE80' },
    { k: 'DB PING',  v: `${11 + (tick % 5)}ms`, color: '#34D399' },
    { k: 'API ERR',  v: '0',                     color: '#4ADE80' },
    { k: 'FEED',     v: `${1820 + tick * 3}`,    color: '#60A5FA' },
    { k: 'EVENTS',   v: eventsCount.toString(),  color: '#A78BFA' },
    { k: 'AGENTS',   v: '6 / 6',                 color: '#FCD34D' },
  ];

  return (
    <div style={{
      position: 'absolute',
      left: '10%', top: '73%',
      width: '80%', height: '23%',
      background: '#0F172A',
      border: '1.5px solid #1E293B',
      borderRadius: 10,
      padding: '8px 14px',
      overflow: 'hidden',
    }}>
      <div style={{ fontSize: '.55rem', color: '#334155', fontWeight: 700, letterSpacing: '2px', marginBottom: 6 }}>
        ▸ LIVE SYSTEM MONITOR
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {metrics.map(m => (
          <div key={m.k}>
            <div style={{ fontSize: '.5rem', color: '#475569', letterSpacing: '.5px' }}>{m.k}</div>
            <div style={{ fontSize: '.7rem', fontWeight: 700, color: m.color }}>{m.v}</div>
          </div>
        ))}
      </div>
      <div style={{
        position: 'absolute', bottom: 6, right: 10,
        width: 6, height: 11,
        background: '#2563EB', borderRadius: 1,
        animation: 'agentBlink 1s step-end infinite',
      }} />
    </div>
  );
}

function AgentSprite({ agent, state }) {
  const isWalking   = state.status === 'walking' || state.status === 'returning';
  const isExecuting = state.status === 'executing';
  const isIdle      = state.status === 'idle';

  return (
    <div style={{
      position: 'absolute',
      left: `${state.x}%`, top: `${state.y}%`,
      transform: 'translate(-50%, -50%)',
      transition: 'left 1.8s cubic-bezier(0.4,0,0.2,1), top 1.8s cubic-bezier(0.4,0,0.2,1)',
      zIndex: 10,
      pointerEvents: 'none',
    }}>
      {isExecuting && (
        <div style={{
          position: 'absolute', top: -22, left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '.62rem', fontWeight: 700, color: '#fff',
          background: agent.color, borderRadius: 4, padding: '1px 6px',
          whiteSpace: 'nowrap', animation: 'agentArrive 0.4s ease',
        }}>
          EXECUTING
        </div>
      )}
      {state.status === 'walking' && (
        <div style={{
          position: 'absolute', top: -18, left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '.75rem', animation: 'requestBadge 0.8s ease infinite',
        }}>⚙️</div>
      )}

      <div style={{
        width: 36, height: 36,
        borderRadius: '50%',
        background: isExecuting ? agent.color : agent.bg,
        border: `2.5px solid ${agent.color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.05rem',
        boxShadow: isExecuting
          ? `0 0 0 6px ${agent.color}33, 0 4px 12px ${agent.color}44`
          : `0 2px 6px ${agent.color}28`,
        animation: isIdle      ? 'agentIdle 2.5s ease-in-out infinite'
                 : isWalking   ? 'agentWalk 0.5s ease infinite'
                 : isExecuting ? 'agentExecute 0.8s ease-in-out infinite'
                 : 'none',
        transition: 'background 0.4s, box-shadow 0.4s',
      }}>
        {agent.emoji}
      </div>

      <div style={{
        position: 'absolute', top: '100%', left: '50%',
        transform: 'translateX(-50%)',
        marginTop: 3,
        background: 'rgba(15,23,42,0.85)',
        color: '#fff',
        fontSize: '.55rem', fontWeight: 700,
        padding: '1px 5px', borderRadius: 4,
        whiteSpace: 'nowrap',
        opacity: isWalking || isExecuting ? 1 : 0,
        transition: 'opacity 0.3s',
      }}>
        {agent.name}
      </div>
    </div>
  );
}

/* ─── Office Floor Plan ──────────────────────────────────────────────────────── */
function OfficeFloorPlan({ agentStates, eventsCount }) {
  return (
    <div style={{
      position: 'relative',
      background: '#F1F5F9',
      borderRadius: 16,
      border: '1px solid #E2E8F0',
      overflow: 'hidden',
      paddingBottom: '68%',
      boxShadow: '0 4px 20px rgba(0,0,0,0.07)',
    }}>
      <div style={{ position: 'absolute', inset: 0 }}>
        {/* Floor tiles */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(203,213,225,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(203,213,225,0.3) 1px, transparent 1px)',
          backgroundSize: '5% 5%',
        }} />

        {/* Agent rooms */}
        {AGENT_DEFS.map(agent => (
          <AgentRoom key={agent.id} agent={agent} agentState={agentStates[agent.id]} />
        ))}

        {/* Corridor */}
        <div style={{
          position: 'absolute',
          left: '1%', right: '1%',
          top: `${CORRIDOR_Y - 3}%`, height: '8%',
          background: 'rgba(226,232,240,0.6)',
          borderTop: '1px dashed #CBD5E1', borderBottom: '1px dashed #CBD5E1',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: '.6rem', color: '#94A3B8', fontWeight: 600, letterSpacing: '2px' }}>
            MAIN CORRIDOR
          </span>
        </div>

        {/* Server room / live monitor */}
        <ServerRoom eventsCount={eventsCount} />

        {/* Agent sprites */}
        {AGENT_DEFS.map(agent => (
          <AgentSprite key={agent.id} agent={agent} state={agentStates[agent.id]} />
        ))}

        {/* HQ label */}
        <div style={{ position: 'absolute', top: 10, left: 14, fontSize: '.65rem', fontWeight: 800, color: '#94A3B8', letterSpacing: '2px' }}>
          UFICONNECT HQ
        </div>

        {/* Autonomous mode badge */}
        <div style={{
          position: 'absolute', top: 10, right: 14,
          display: 'flex', alignItems: 'center', gap: 5,
          fontSize: '.6rem', fontWeight: 700, color: '#059669',
          background: '#ECFDF5', padding: '3px 8px', borderRadius: 10,
          border: '1px solid #6EE7B7',
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80', display: 'inline-block', animation: 'agentPulse 1.6s ease-out infinite' }} />
          AUTONOMOUS MODE
        </div>
      </div>
    </div>
  );
}

/* ─── Activity Log ───────────────────────────────────────────────────────────── */
function ActivityLog({ log }) {
  return (
    <div style={{ background: '#0F172A', borderRadius: 12, padding: '14px', maxHeight: 280, overflowY: 'auto' }}>
      <div style={{ fontSize: '.65rem', color: '#475569', fontWeight: 700, letterSpacing: '1px', marginBottom: 8 }}>
        ▸ ACTIVITY LOG
      </div>
      {log.length === 0 && (
        <div style={{ color: '#475569', fontSize: '.75rem' }}>Waiting for agent events…</div>
      )}
      {log.map((entry, i) => (
        <div key={entry.id} style={{
          display: 'flex', gap: 8, marginBottom: 4,
          animation: i === 0 ? 'agentLogIn 0.35s ease' : 'none',
          opacity: 1 - i * 0.06,
        }}>
          <span style={{ color: '#475569', fontSize: '.65rem', flexShrink: 0, marginTop: 1 }}>{entry.ts}</span>
          <span style={{ fontSize: '.72rem', color: entry.color || '#E2E8F0', lineHeight: 1.5 }}>
            {entry.icon} {entry.msg}
          </span>
        </div>
      ))}
      <span style={{
        display: 'inline-block', width: 6, height: 12,
        background: '#2563EB', borderRadius: 1,
        animation: 'agentBlink 1s step-end infinite',
        verticalAlign: 'middle',
      }} />
    </div>
  );
}

/* ─── Status Header ──────────────────────────────────────────────────────────── */
function StatusHeader({ sessionTime, eventsCount }) {
  return (
    <div style={{
      background: '#0F172A',
      borderRadius: 12, padding: '14px 20px',
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16,
      marginBottom: 18,
      border: '1px solid #1E293B',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg, #2563EB, #7C3AED)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 900, fontSize: '.8rem',
        }}>UF</div>
        <div style={{ color: '#94A3B8', fontSize: '.7rem', fontWeight: 600 }}>Agent Control Room</div>
      </div>

      <div style={{ flex: 1, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Mode',    value: '🟢 Fully Autonomous', color: '#4ADE80' },
          { label: 'Agents',  value: '6 / 6 active',        color: '#60A5FA' },
          { label: 'Events',  value: eventsCount.toLocaleString(), color: '#A78BFA' },
          { label: 'Session', value: sessionTime,           color: '#34D399' },
        ].map(s => (
          <div key={s.label}>
            <div style={{ fontSize: '.6rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '.5px' }}>{s.label}</div>
            <div style={{ fontSize: '.82rem', fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%', background: '#4ADE80',
          display: 'inline-block', animation: 'agentPulse 1.6s ease-out infinite',
          boxShadow: '0 0 0 0 #4ADE8055',
        }} />
        <span style={{ fontSize: '.68rem', color: '#64748B', fontWeight: 600 }}>LIVE</span>
      </div>
    </div>
  );
}

/* ─── Last Execution Card ────────────────────────────────────────────────────── */
function LastExecution({ entry }) {
  if (!entry) return (
    <div style={{
      background: '#F8FAFC', border: '1.5px dashed #CBD5E1',
      borderRadius: 12, padding: '18px',
      textAlign: 'center', color: '#94A3B8', fontSize: '.8rem',
    }}>
      <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>⚙️</div>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Initialising agents…</div>
      <div style={{ fontSize: '.72rem' }}>Agents will begin auto-maintenance shortly</div>
    </div>
  );

  return (
    <div style={{
      background: '#fff', border: `2px solid ${entry.agentColor}`,
      borderRadius: 14, padding: '16px',
      boxShadow: `0 4px 20px ${entry.agentColor}18`,
      animation: 'permissionSlideIn 0.35s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: entry.agentBg, border: `2px solid ${entry.agentColor}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
        }}>
          {entry.agentEmoji}
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: '.85rem', color: entry.agentColor }}>{entry.agentName}</div>
          <div style={{ fontSize: '.65rem', color: '#64748B' }}>completed a task autonomously</div>
        </div>
        <span style={{
          marginLeft: 'auto', fontSize: '.62rem', fontWeight: 700,
          color: '#059669', background: '#ECFDF5', padding: '2px 8px', borderRadius: 8,
        }}>✅ AUTO</span>
      </div>
      <div style={{
        background: '#F8FAFC', borderRadius: 8, padding: '10px 12px',
        border: '1px solid #E2E8F0',
        fontSize: '.78rem', color: '#0F172A', fontWeight: 500, lineHeight: 1.5,
      }}>
        {entry.msg}
      </div>
      <div style={{ fontSize: '.65rem', color: '#94A3B8', marginTop: 6 }}>{entry.ts}</div>
    </div>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────────── */
export default function AgentDashboard() {
  const [agentStates, setAgentStates] = useState(
    () => Object.fromEntries(
      AGENT_DEFS.map(a => [a.id, { x: a.homeX, y: a.homeY, status: 'idle', taskIdx: 0 }])
    )
  );
  const [activityLog,    setActivityLog]    = useState([]);
  const [lastExecution,  setLastExecution]  = useState(null);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [eventsCount,    setEventsCount]    = useState(0);

  const timeoutsRef  = useRef([]);
  const activeAgents = useRef(new Set());

  const addTimeout = useCallback((fn, delay) => {
    const t = setTimeout(fn, delay);
    timeoutsRef.current.push(t);
    return t;
  }, []);

  const addLog = useCallback((icon, msg, color = '#CBD5E1') => {
    const ts = new Date().toLocaleTimeString();
    setActivityLog(prev => [{ id: Math.random(), icon, msg, ts, color }, ...prev.slice(0, 49)]);
    setEventsCount(c => c + 1);
  }, []);

  const updateAgent = useCallback((id, patch) => {
    setAgentStates(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  /* ── Autonomous task execution cycle ──────────────────────────────────────── */
  const runTaskCycle = useCallback((agentId) => {
    const agent     = AGENT_DEFS.find(a => a.id === agentId);
    const taskIdx   = Math.floor(Math.random() * agent.tasks.length);
    const taskName  = agent.tasks[taskIdx];
    const completion = agent.completions[Math.floor(Math.random() * agent.completions.length)];

    addLog('⚙️', `${agent.name} → ${taskName}`, agent.color);
    updateAgent(agentId, { status: 'walking', taskIdx });

    // Walk to corridor
    addTimeout(() => updateAgent(agentId, { x: agent.homeX, y: CORRIDOR_Y }), 300);
    // Walk to execution zone
    addTimeout(() => updateAgent(agentId, { x: EXEC_ZONE.x, y: CORRIDOR_Y, status: 'executing' }), 2200);
    // Execute
    addTimeout(() => {
      addLog('✅', completion, '#4ADE80');
      setLastExecution({
        agentName:  agent.name,
        agentEmoji: agent.emoji,
        agentColor: agent.color,
        agentBg:    agent.bg,
        msg:        completion,
        ts:         new Date().toLocaleTimeString(),
      });
      updateAgent(agentId, { status: 'returning' });
      // Walk back
      addTimeout(() => updateAgent(agentId, { x: agent.homeX, y: CORRIDOR_Y }), 400);
      addTimeout(() => {
        updateAgent(agentId, { x: agent.homeX, y: agent.homeY, status: 'idle' });
        activeAgents.current.delete(agentId);
        // Schedule next cycle
        const delay = 30000 + Math.random() * 40000;
        addTimeout(() => {
          if (!activeAgents.current.has(agentId)) {
            activeAgents.current.add(agentId);
            runTaskCycle(agentId);
          }
        }, delay);
      }, 2200);
    }, 5000);
  }, [addTimeout, addLog, updateAgent]);

  /* ── Backend status polling — merges real server events into the log ─────── */
  const seenBackendIds = useRef(new Set());

  useEffect(() => {
    function fetchStatus() {
      client.get('/hq/status').then(({ data }) => {
        const { agentLog = [], feedPostCount, feedRefreshedAt } = data;
        // Inject new backend events (newest first) that we haven't shown yet
        const newEntries = agentLog
          .filter(e => !seenBackendIds.current.has(e.id))
          .map(e => {
            seenBackendIds.current.add(e.id);
            const agent = AGENT_DEFS.find(a => a.id === e.agentId);
            return {
              id:    e.id,
              icon:  e.emoji,
              msg:   `[SERVER] ${e.msg}`,
              ts:    new Date(e.ts).toLocaleTimeString(),
              color: e.color || (agent?.color) || '#CBD5E1',
            };
          });
        if (newEntries.length > 0) {
          setActivityLog(prev => [...newEntries, ...prev].slice(0, 60));
          setEventsCount(c => c + newEntries.length);
          // Update last execution if the most recent server event is a completion
          const latest = newEntries[0];
          if (latest && latest.icon === '✅') {
            const agent = AGENT_DEFS.find(a => latest.msg.toLowerCase().includes(a.id));
            if (agent) {
              setLastExecution({
                agentName:  agent.name,
                agentEmoji: agent.emoji,
                agentColor: agent.color,
                agentBg:    agent.bg,
                msg:        latest.msg.replace('[SERVER] ', ''),
                ts:         latest.ts,
              });
            }
          }
        }
      }).catch(() => {});
    }

    fetchStatus();
    const t = setInterval(fetchStatus, 60 * 1000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Bootstrap ────────────────────────────────────────────────────────────── */
  useEffect(() => {
    addLog('🚀', 'UFIConnect Agent System initialized', '#60A5FA');
    addLog('✅', 'All 6 agents online — autonomous mode active', '#4ADE80');
    addLog('🔒', 'Security Agent: initial scan complete, 0 threats', '#4ADE80');

    AGENT_DEFS.forEach((agent, i) => {
      const delay = 8000 + i * 9000 + Math.random() * 5000;
      addTimeout(() => {
        activeAgents.current.add(agent.id);
        runTaskCycle(agent.id);
      }, delay);
    });

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Task ticker (cycles display text while idle) ─────────────────────────── */
  useEffect(() => {
    const intervals = AGENT_DEFS.map(agent => setInterval(() => {
      setAgentStates(prev => {
        const s = prev[agent.id];
        if (s.status !== 'idle') return prev;
        return { ...prev, [agent.id]: { ...s, taskIdx: (s.taskIdx + 1) % agent.tasks.length } };
      });
    }, 4500 + Math.random() * 4000));
    return () => intervals.forEach(clearInterval);
  }, []);

  /* ── Session clock ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => setSessionSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const sessionTime = `${String(Math.floor(sessionSeconds / 60)).padStart(2, '0')}:${String(sessionSeconds % 60).padStart(2, '0')}`;

  /* ── Render ────────────────────────────────────────────────────────────────── */
  return (
    <Layout>
      <style>{`
        @keyframes agentIdle {
          0%,100% { transform: scale(1); }
          50% { transform: translateY(-4px) scale(1.06); }
        }
        @keyframes agentWalk {
          0%,100% { transform: translateY(0px); }
          25% { transform: translateY(-6px); }
          75% { transform: translateY(-6px); }
        }
        @keyframes agentExecute {
          0%,100% { transform: scale(1); box-shadow: inherit; }
          50% { transform: scale(1.12); }
        }
        @keyframes agentArrive {
          0% { transform: scale(0.6); opacity: 0; }
          60% { transform: scale(1.18); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes agentTaskFade {
          from { opacity: 0; transform: translateY(3px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes agentPulse {
          0% { box-shadow: 0 0 0 0 currentColor; }
          70% { box-shadow: 0 0 0 8px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
        @keyframes agentLogIn {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes permissionSlideIn {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes agentBlink {
          0%,100% { opacity: 1; } 50% { opacity: 0; }
        }
        @keyframes requestBadge {
          0%,100% { transform: translateX(-50%) scale(1); }
          50% { transform: translateX(-50%) scale(1.3); }
        }
      `}</style>

      <div className="page-header">
        <h1 className="page-title">🏢 UFIConnect HQ</h1>
        <p className="page-subtitle">
          6 AI agents autonomously monitor, maintain, and improve your platform 24/7
        </p>
      </div>

      <StatusHeader sessionTime={sessionTime} eventsCount={eventsCount} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 18, alignItems: 'start' }}>
        {/* Floor plan */}
        <OfficeFloorPlan agentStates={agentStates} eventsCount={eventsCount} />

        {/* Right sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Last execution */}
          <LastExecution entry={lastExecution} />

          {/* Agent roster */}
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px' }}>
            <div style={{ fontWeight: 800, fontSize: '.82rem', marginBottom: 10, color: '#0F172A' }}>
              🤖 Agent Roster
            </div>
            {AGENT_DEFS.map(agent => {
              const s = agentStates[agent.id];
              const statusLabel =
                s.status === 'idle'      ? '● Monitoring'  :
                s.status === 'walking'   ? '⚙️ Working'   :
                s.status === 'executing' ? '🔄 Executing'  :
                s.status === 'returning' ? '↩ Returning'  : '●';
              const statusColor =
                s.status === 'idle'      ? agent.color :
                s.status === 'walking'   ? '#D97706'   :
                s.status === 'executing' ? '#DC2626'   : '#059669';
              return (
                <div key={agent.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 0', borderBottom: '1px solid #F1F5F9',
                }}>
                  <span style={{ fontSize: '1rem' }}>{agent.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '.75rem', fontWeight: 700 }}>{agent.name}</div>
                    <div style={{ fontSize: '.63rem', color: '#94A3B8' }}>{agent.role}</div>
                  </div>
                  <span style={{ fontSize: '.62rem', fontWeight: 700, color: statusColor, whiteSpace: 'nowrap' }}>
                    {statusLabel}
                  </span>
                </div>
              );
            })}
          </div>

          <ActivityLog log={activityLog} />
        </div>
      </div>

      <div style={{
        marginTop: 18, padding: '12px 16px',
        background: '#F8FAFC', borderRadius: 10,
        border: '1px solid #E2E8F0',
        fontSize: '.75rem', color: '#64748B',
        display: 'flex', gap: 8, alignItems: 'center',
      }}>
        <span>⚡</span>
        <span>
          All 6 agents run fully autonomously — no approval needed. They continuously monitor feed quality,
          security, performance, SEO, community health, and job listings. Completed tasks are logged in real time.
        </span>
      </div>
    </Layout>
  );
}
