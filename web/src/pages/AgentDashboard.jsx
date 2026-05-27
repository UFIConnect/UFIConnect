import { useState, useEffect, useRef, useCallback } from 'react';
import Layout from '../components/Layout';

/* ─── Agent Definitions ───────────────────────────────────────────────────── */
const AGENT_DEFS = [
  {
    id: 'feed', name: 'Feed Curator', emoji: '🤖',
    color: '#2563EB', bg: '#EFF6FF', role: 'Content Intelligence',
    homeX: 13, homeY: 16,
    tasks: ['Fetching Reddit posts…', 'Scoring DEV.to articles…', 'Pulling GitHub trending…', 'Deduplicating feed…'],
    permissions: [
      { label: 'Reduce feed refresh: 15 min → 5 min', risk: 'medium', detail: 'Increases server load ~3×, much fresher content' },
      { label: 'Enable AI content relevance scoring', risk: 'low',    detail: 'ML model ranks posts by user interest graph' },
      { label: 'Add X/Twitter as new feed source',   risk: 'low',    detail: 'Pull trending professional threads via search API' },
    ],
  },
  {
    id: 'seo', name: 'SEO Agent', emoji: '🔍',
    color: '#7C3AED', bg: '#F3EEFF', role: 'Search Optimisation',
    homeX: 46, homeY: 16,
    tasks: ['Auditing meta tags…', 'Checking OG images…', 'Validating sitemap.xml…', 'Monitoring Core Web Vitals…'],
    permissions: [
      { label: 'Rewrite meta description on /landing', risk: 'low',    detail: 'Current 140 chars; optimal is 155. Improves CTR.' },
      { label: 'Add Schema.org markup to 2 pages',    risk: 'low',    detail: 'Enables Google rich snippets for /groups & /feed' },
      { label: 'Regenerate sitemap.xml with /agents', risk: 'low',    detail: 'Newly added route missing from current sitemap' },
    ],
  },
  {
    id: 'security', name: 'Security Agent', emoji: '🛡️',
    color: '#DC2626', bg: '#FEF2F2', role: 'Threat Monitoring',
    homeX: 79, homeY: 16,
    tasks: ['Scanning JWT tokens…', 'Monitoring failed logins…', 'Auditing CORS…', 'Checking CVE database…'],
    permissions: [
      { label: 'Add CSP upgrade-insecure-requests header', risk: 'medium', detail: 'Forces HTTPS for mixed content — may break old links' },
      { label: 'Rotate JWT signing secret',                risk: 'high',   detail: '⚠️ Logs ALL users out immediately. Refresh tokens invalidated.' },
      { label: 'Rate-limit 192.168.x.x IP range',         risk: 'medium', detail: '3 failed login attempts in 2 hours — may be probing' },
    ],
  },
  {
    id: 'perf', name: 'Perf Agent', emoji: '⚡',
    color: '#D97706', bg: '#FFFBEB', role: 'Speed & Optimisation',
    homeX: 13, homeY: 64,
    tasks: ['Measuring TTFB…', 'Auditing JS bundle…', 'Profiling React renders…', 'Running Lighthouse…'],
    permissions: [
      { label: 'Remove 28 unused CSS rules',    risk: 'medium', detail: 'Saves ~3KB; could affect edge-case styles. Preview attached.' },
      { label: 'Convert og-image.png → WebP',   risk: 'low',    detail: 'Saves ~180KB on landing page. All modern browsers supported.' },
      { label: 'Enable CDN caching on /public', risk: 'low',    detail: 'Reduces TTFB by ~40ms globally via edge caching' },
    ],
  },
  {
    id: 'community', name: 'Community Agent', emoji: '🌐',
    color: '#059669', bg: '#ECFDF5', role: 'Community Health',
    homeX: 46, homeY: 64,
    tasks: ['Reviewing flagged posts…', 'Checking member growth…', 'Drafting weekly digest…', 'Scoring engagement…'],
    permissions: [
      { label: 'Archive 2 groups inactive 31+ days', risk: 'medium', detail: '"FinTech 2023" (0 posts/45d) & "Crypto Devs" (0 posts/38d)' },
      { label: 'Send weekly digest to 1,200 members', risk: 'low',   detail: '8 community highlights, unsubscribe footer included' },
      { label: 'Promote @alexkim to Moderator',       risk: 'medium', detail: '47 posts, 94% upvote rate — top contributor this month' },
    ],
  },
  {
    id: 'opps', name: 'Opps Agent', emoji: '💼',
    color: '#0284C7', bg: '#F0F9FF', role: 'Listings & Jobs',
    homeX: 79, homeY: 64,
    tasks: ['Validating listing URLs…', 'Checking expired posts…', 'Categorising new listings…', 'Ranking by user fit…'],
    permissions: [
      { label: 'Remove 7 expired listings (>30 days)', risk: 'low',    detail: 'All returning 404 or "position closed" — safe to remove' },
      { label: 'Feature 3 sponsor listings at top',    risk: 'medium', detail: 'Paid placements received — verify contract IDs?' },
      { label: 'Add salary range filter to /opps UI',  risk: 'low',    detail: '76% of listings now have salary data — filter is ready' },
    ],
  },
];

const CORRIDOR_Y  = 42;
const USER_OFFICE = { x: 50, y: 81 };

const RISK_STYLE = {
  low:    { bg: '#ECFDF5', text: '#059669', label: '🟢 Low Risk'    },
  medium: { bg: '#FFFBEB', text: '#D97706', label: '🟡 Medium Risk' },
  high:   { bg: '#FEF2F2', text: '#DC2626', label: '🔴 High Risk'   },
};

/* ─── Office Floor Plan ───────────────────────────────────────────────────── */
function OfficeFloorPlan({ agentStates, pendingAgentId }) {
  return (
    <div style={{
      position: 'relative',
      background: '#F1F5F9',
      borderRadius: 16,
      border: '1px solid #E2E8F0',
      overflow: 'hidden',
      paddingBottom: '68%',  // maintains aspect ratio
      boxShadow: '0 4px 20px rgba(0,0,0,0.07)',
    }}>
      <div style={{ position: 'absolute', inset: 0 }}>

        {/* Grid lines (floor tiles) */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(203,213,225,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(203,213,225,0.3) 1px, transparent 1px)',
          backgroundSize: '5% 5%',
        }} />

        {/* Room labels */}
        {AGENT_DEFS.map(agent => (
          <AgentRoom key={agent.id} agent={agent} agentState={agentStates[agent.id]} />
        ))}

        {/* Corridor strip */}
        <div style={{
          position: 'absolute',
          left: '1%', right: '1%',
          top: `${CORRIDOR_Y - 3}%`,
          height: '8%',
          background: 'rgba(226,232,240,0.6)',
          borderTop: '1px dashed #CBD5E1',
          borderBottom: '1px dashed #CBD5E1',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: '.6rem', color: '#94A3B8', fontWeight: 600, letterSpacing: '2px' }}>
            MAIN CORRIDOR
          </span>
        </div>

        {/* Your Office */}
        <YourOffice pendingAgentId={pendingAgentId} />

        {/* Agent sprites */}
        {AGENT_DEFS.map(agent => (
          <AgentSprite key={agent.id} agent={agent} state={agentStates[agent.id]} />
        ))}

        {/* HQ label */}
        <div style={{
          position: 'absolute', top: 10, left: 14,
          fontSize: '.65rem', fontWeight: 800, color: '#94A3B8', letterSpacing: '2px',
        }}>
          UFICONNECT HQ
        </div>
      </div>
    </div>
  );
}

function AgentRoom({ agent, agentState }) {
  const isAgentHome = agentState.status === 'idle';
  return (
    <div style={{
      position: 'absolute',
      left: `${agent.homeX - 11}%`,
      top: `${agent.homeY - 8}%`,
      width: '22%',
      height: '24%',
      background: isAgentHome ? agent.bg : '#fff',
      border: `1.5px solid ${isAgentHome ? agent.color + '44' : '#E2E8F0'}`,
      borderRadius: 10,
      padding: '6% 8%',
      transition: 'all 0.5s ease',
      boxShadow: isAgentHome ? `0 2px 12px ${agent.color}18` : 'none',
    }}>
      <div style={{ fontSize: '.6rem', fontWeight: 800, color: agent.color, opacity: 0.7, marginBottom: 2, letterSpacing: '.5px' }}>
        {agent.role.toUpperCase()}
      </div>
      <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#0F172A' }}>{agent.name}</div>
      {isAgentHome && (
        <div style={{
          fontSize: '.58rem', color: '#64748B', marginTop: 4,
          animation: 'agentTaskFade 0.4s ease',
          lineHeight: 1.4,
        }}>
          {agent.tasks[agentState.taskIdx]}
        </div>
      )}
      {/* Desk decoration */}
      <div style={{
        position: 'absolute', bottom: '12%', right: '10%',
        width: 18, height: 12,
        background: isAgentHome ? `${agent.color}22` : '#F1F5F9',
        borderRadius: 3,
        border: `1px solid ${isAgentHome ? agent.color + '33' : '#E2E8F0'}`,
        transition: 'all 0.5s',
      }} />
    </div>
  );
}

function YourOffice({ pendingAgentId }) {
  const hasVisitor = !!pendingAgentId;
  return (
    <div style={{
      position: 'absolute',
      left: '35%', top: '72%',
      width: '30%', height: '24%',
      background: hasVisitor
        ? 'linear-gradient(135deg, #EFF6FF, #F3EEFF)'
        : 'linear-gradient(135deg, #F8FAFC, #EFF6FF)',
      border: `2px solid ${hasVisitor ? '#2563EB' : '#CBD5E1'}`,
      borderRadius: 12,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 4,
      transition: 'all 0.4s ease',
      animation: hasVisitor ? 'officePulse 2s ease infinite' : 'none',
      boxShadow: hasVisitor ? '0 0 0 3px #2563EB22' : 'none',
    }}>
      <div style={{ fontSize: '1.4rem' }}>👤</div>
      <div style={{ fontSize: '.62rem', fontWeight: 800, color: '#2563EB', letterSpacing: '1px' }}>YOUR OFFICE</div>
      {hasVisitor && (
        <div style={{
          fontSize: '.58rem', color: '#7C3AED', fontWeight: 600,
          animation: 'agentBlink 1.2s step-end infinite',
        }}>
          🔔 Agent waiting…
        </div>
      )}
      {/* Door */}
      <div style={{
        position: 'absolute', bottom: -1, left: '50%',
        transform: 'translateX(-50%)',
        width: '20%', height: 6,
        background: hasVisitor ? '#2563EB' : '#CBD5E1',
        borderRadius: '3px 3px 0 0',
        transition: 'background 0.4s',
      }} />
    </div>
  );
}

function AgentSprite({ agent, state }) {
  const isWalking   = state.status === 'walking' || state.status === 'returning';
  const isAtOffice  = state.status === 'at_office';
  const isIdle      = state.status === 'idle';

  return (
    <div style={{
      position: 'absolute',
      left: `${state.x}%`,
      top:  `${state.y}%`,
      transform: 'translate(-50%, -50%)',
      transition: 'left 1.8s cubic-bezier(0.4,0,0.2,1), top 1.8s cubic-bezier(0.4,0,0.2,1)',
      zIndex: 10,
      pointerEvents: 'none',
    }}>
      {/* Request badge above head */}
      {(state.status === 'walking') && (
        <div style={{
          position: 'absolute', top: -20, left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '.75rem',
          animation: 'requestBadge 0.8s ease infinite',
        }}>❗</div>
      )}
      {isAtOffice && (
        <div style={{
          position: 'absolute', top: -20, left: '50%',
          transform: 'translateX(-50%)',
          fontSize: '.7rem',
          animation: 'requestBadge 0.6s ease infinite',
        }}>⏳</div>
      )}

      {/* Agent body */}
      <div style={{
        width: 36, height: 36,
        borderRadius: '50%',
        background: isAtOffice ? agent.color : agent.bg,
        border: `2.5px solid ${agent.color}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.05rem',
        boxShadow: isAtOffice
          ? `0 0 0 4px ${agent.color}33, 0 4px 12px ${agent.color}44`
          : `0 2px 6px ${agent.color}28`,
        animation: isIdle    ? 'agentIdle 2.5s ease-in-out infinite'
                 : isWalking ? 'agentWalk 0.5s ease infinite'
                 : isAtOffice ? 'agentArrive 0.4s ease'
                 : 'none',
        transition: 'background 0.4s, box-shadow 0.4s',
      }}>
        {agent.emoji}
      </div>

      {/* Name tag */}
      <div style={{
        position: 'absolute', top: '100%', left: '50%',
        transform: 'translateX(-50%)',
        marginTop: 3,
        background: 'rgba(15,23,42,0.8)',
        color: '#fff',
        fontSize: '.55rem',
        fontWeight: 700,
        padding: '1px 5px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        opacity: isWalking || isAtOffice ? 1 : 0,
        transition: 'opacity 0.3s',
      }}>
        {agent.name}
      </div>
    </div>
  );
}

/* ─── Permission Card ─────────────────────────────────────────────────────── */
function PermissionCard({ request, onGrant, onDeny }) {
  const agent = AGENT_DEFS.find(a => a.id === request.agentId);
  const perm  = agent.permissions[request.permIdx];
  const risk  = RISK_STYLE[perm.risk];

  return (
    <div style={{
      background: '#fff',
      border: `2px solid ${agent.color}`,
      borderRadius: 14,
      padding: '18px',
      marginBottom: 14,
      boxShadow: `0 8px 32px ${agent.color}22`,
      animation: 'permissionSlideIn 0.35s ease',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: agent.bg, border: `2px solid ${agent.color}44`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.2rem',
          animation: 'agentArrive 0.5s ease',
        }}>
          {agent.emoji}
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: '.88rem', color: agent.color }}>{agent.name}</div>
          <div style={{ fontSize: '.68rem', color: '#64748B' }}>is at your office requesting permission</div>
        </div>
      </div>

      {/* Request */}
      <div style={{
        background: '#F8FAFC', borderRadius: 8,
        padding: '10px 12px', marginBottom: 10,
        border: '1px solid #E2E8F0',
      }}>
        <div style={{ fontWeight: 700, fontSize: '.83rem', color: '#0F172A', marginBottom: 4 }}>
          📋 {perm.label}
        </div>
        <div style={{ fontSize: '.75rem', color: '#64748B', lineHeight: 1.5 }}>{perm.detail}</div>
      </div>

      {/* Risk badge */}
      <div style={{
        background: risk.bg, color: risk.text,
        borderRadius: 6, padding: '4px 10px',
        fontSize: '.7rem', fontWeight: 700,
        display: 'inline-block', marginBottom: 12,
      }}>
        {risk.label}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onGrant}
          style={{
            flex: 1, padding: '10px', borderRadius: 8,
            background: '#10B981', color: '#fff',
            border: 'none', fontWeight: 700, fontSize: '.82rem',
            cursor: 'pointer',
            transition: 'all .15s',
          }}
          onMouseEnter={e => e.target.style.background = '#059669'}
          onMouseLeave={e => e.target.style.background = '#10B981'}
        >
          ✅ Grant Permission
        </button>
        <button
          onClick={onDeny}
          style={{
            flex: 1, padding: '10px', borderRadius: 8,
            background: '#fff', color: '#DC2626',
            border: '1.5px solid #DC2626', fontWeight: 700, fontSize: '.82rem',
            cursor: 'pointer',
            transition: 'all .15s',
          }}
          onMouseEnter={e => { e.target.style.background = '#FEF2F2'; }}
          onMouseLeave={e => { e.target.style.background = '#fff'; }}
        >
          🚫 Deny
        </button>
      </div>
    </div>
  );
}

/* ─── Activity Log ────────────────────────────────────────────────────────── */
function ActivityLog({ log }) {
  return (
    <div style={{
      background: '#0F172A',
      borderRadius: 12,
      padding: '14px',
      maxHeight: 320,
      overflowY: 'auto',
    }}>
      <div style={{ fontSize: '.65rem', color: '#475569', fontWeight: 700, letterSpacing: '1px', marginBottom: 8 }}>
        ▸ ACTIVITY LOG
      </div>
      {log.length === 0 && (
        <div style={{ color: '#475569', fontSize: '.75rem' }}>Waiting for agent events…</div>
      )}
      {log.map((entry, i) => (
        <div key={entry.id} style={{
          display: 'flex', gap: 8,
          marginBottom: 4,
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

/* ─── Status Header ───────────────────────────────────────────────────────── */
function StatusHeader({ sessionTime, agentsActive, eventsCount }) {
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
          { label: 'Status',  value: '🟢 All Systems Live', color: '#4ADE80' },
          { label: 'Agents',  value: `${agentsActive} / 6 active`,  color: '#60A5FA' },
          { label: 'Events',  value: eventsCount.toLocaleString(), color: '#A78BFA' },
          { label: 'Session', value: sessionTime, color: '#34D399' },
        ].map(s => (
          <div key={s.label}>
            <div style={{ fontSize: '.6rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '.5px' }}>{s.label}</div>
            <div style={{ fontSize: '.82rem', fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* LIVE pill */}
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

/* ─── Main Page ───────────────────────────────────────────────────────────── */
export default function AgentDashboard() {
  const [agentStates, setAgentStates] = useState(
    () => Object.fromEntries(
      AGENT_DEFS.map(a => [a.id, { x: a.homeX, y: a.homeY, status: 'idle', taskIdx: 0 }])
    )
  );
  const [pendingRequest, setPendingRequest]   = useState(null);
  const [activityLog, setActivityLog]         = useState([]);
  const [sessionSeconds, setSessionSeconds]   = useState(0);
  const [eventsCount, setEventsCount]         = useState(0);

  const busyRef      = useRef(false);
  const timeoutsRef  = useRef([]);
  const requestQueue = useRef([]);

  /* ── Helpers ──────────────────────────────────────────────────────────── */
  const addTimeout = useCallback((fn, delay) => {
    const t = setTimeout(fn, delay);
    timeoutsRef.current.push(t);
    return t;
  }, []);

  const addLog = useCallback((icon, msg, color = '#CBD5E1') => {
    const ts = new Date().toLocaleTimeString();
    setActivityLog(prev => [{ id: Math.random(), icon, msg, ts, color }, ...prev.slice(0, 39)]);
    setEventsCount(c => c + 1);
  }, []);

  const updateAgent = useCallback((id, patch) => {
    setAgentStates(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  /* ── Walk sequence ────────────────────────────────────────────────────── */
  const walkBack = useCallback((agentId, outcome) => {
    const agent   = AGENT_DEFS.find(a => a.id === agentId);
    const homePos = { x: agent.homeX, y: agent.homeY };

    updateAgent(agentId, { status: 'returning' });

    addTimeout(() => updateAgent(agentId, { x: USER_OFFICE.x, y: CORRIDOR_Y }),  200);
    addTimeout(() => updateAgent(agentId, { x: homePos.x,     y: CORRIDOR_Y }), 2200);
    addTimeout(() => {
      updateAgent(agentId, { x: homePos.x, y: homePos.y, status: 'idle' });
      busyRef.current = false;
      addLog(
        outcome === 'granted' ? '✅' : '🚫',
        outcome === 'granted'
          ? `${agent.name} returned — task executing`
          : `${agent.name} returned — task cancelled`,
        outcome === 'granted' ? '#4ADE80' : '#F87171',
      );
      // Process queued request if any
      if (requestQueue.current.length > 0) {
        const next = requestQueue.current.shift();
        addTimeout(() => next(), 3000);
      }
    }, 4200);
  }, [addTimeout, addLog, updateAgent]);

  const walkToOffice = useCallback((agentId, permIdx) => {
    const agent   = AGENT_DEFS.find(a => a.id === agentId);
    const homePos = { x: agent.homeX, y: agent.homeY };

    addLog('🚶', `${agent.name} is walking to your office…`, agent.color);
    updateAgent(agentId, { status: 'walking', x: homePos.x, y: homePos.y });

    // L-shaped path: desk → corridor → center corridor → office
    addTimeout(() => updateAgent(agentId, { x: homePos.x,     y: CORRIDOR_Y }),  300);
    addTimeout(() => updateAgent(agentId, { x: USER_OFFICE.x, y: CORRIDOR_Y }), 2300);
    addTimeout(() => {
      updateAgent(agentId, { x: USER_OFFICE.x, y: USER_OFFICE.y, status: 'at_office' });
      addLog('🏃', `${agent.name} arrived — requesting permission`, agent.color);
      setPendingRequest({ agentId, permIdx });
    }, 4300);
  }, [addTimeout, addLog, updateAgent]);

  /* ── Permission handlers ──────────────────────────────────────────────── */
  const handleGrant = useCallback(() => {
    if (!pendingRequest) return;
    const { agentId, permIdx } = pendingRequest;
    const agent = AGENT_DEFS.find(a => a.id === agentId);
    addLog('✅', `GRANTED: "${agent.permissions[permIdx].label}"`, '#4ADE80');
    setPendingRequest(null);
    walkBack(agentId, 'granted');
  }, [pendingRequest, addLog, walkBack]);

  const handleDeny = useCallback(() => {
    if (!pendingRequest) return;
    const { agentId, permIdx } = pendingRequest;
    const agent = AGENT_DEFS.find(a => a.id === agentId);
    addLog('🚫', `DENIED: "${agent.permissions[permIdx].label}"`, '#F87171');
    setPendingRequest(null);
    walkBack(agentId, 'denied');
  }, [pendingRequest, addLog, walkBack]);

  /* ── Schedule random permission visits ────────────────────────────────── */
  useEffect(() => {
    // Seed initial log
    addLog('🚀', 'UFIConnect Agent System initialized', '#60A5FA');
    addLog('✅', 'All 6 agents online and monitoring', '#4ADE80');
    addLog('🔒', 'Security Agent: scan complete, 0 threats', '#4ADE80');

    function scheduleAgent(agent, initialDelay) {
      addTimeout(() => {
        const permIdx = Math.floor(Math.random() * agent.permissions.length);

        const doWalk = () => {
          if (busyRef.current) {
            // Office is occupied — queue it
            requestQueue.current.push(doWalk);
            addLog('⏳', `${agent.name} is waiting for the office to be free`, '#94A3B8');
            return;
          }
          busyRef.current = true;
          walkToOffice(agent.id, permIdx);
        };

        doWalk();

        // Schedule next visit
        scheduleAgent(agent, 35000 + Math.random() * 45000);
      }, initialDelay);
    }

    // Stagger agents so they don't all arrive at once
    AGENT_DEFS.forEach((agent, i) => {
      scheduleAgent(agent, 10000 + i * 8000 + Math.random() * 6000);
    });

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Task ticker ──────────────────────────────────────────────────────── */
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

  /* ── Session clock ────────────────────────────────────────────────────── */
  useEffect(() => {
    const t = setInterval(() => setSessionSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const sessionTime = `${String(Math.floor(sessionSeconds / 60)).padStart(2, '0')}:${String(sessionSeconds % 60).padStart(2, '0')}`;
  const agentsActive = Object.values(agentStates).filter(s => s.status !== 'idle').length + 6;

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <Layout>
      <style>{`
        @keyframes agentIdle {
          0%,100% { transform: translate(-50%,-50%) scale(1);      }
          50%      { transform: translate(-50%,-54%) scale(1.06);   }
        }
        @keyframes agentWalk {
          0%,100% { transform: translate(-50%,-50%);  }
          25%      { transform: translate(-50%,-56%);  }
          75%      { transform: translate(-50%,-44%);  }
        }
        @keyframes agentArrive {
          0%   { transform: translate(-50%,-50%) scale(0.7); opacity: 0; }
          60%  { transform: translate(-50%,-54%) scale(1.15); }
          100% { transform: translate(-50%,-50%) scale(1);   opacity: 1; }
        }
        @keyframes agentTaskFade {
          from { opacity: 0; transform: translateY(3px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes agentPulse {
          0%   { box-shadow: 0 0 0 0 currentColor; }
          70%  { box-shadow: 0 0 0 8px transparent; }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
        @keyframes agentLogIn {
          from { opacity: 0; transform: translateX(-6px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes permissionSlideIn {
          from { opacity: 0; transform: translateY(10px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes officePulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(37,99,235,0.25); }
          50%      { box-shadow: 0 0 0 10px rgba(37,99,235,0); }
        }
        @keyframes agentBlink {
          0%,100% { opacity: 1; } 50% { opacity: 0; }
        }
        @keyframes requestBadge {
          0%,100% { transform: translateX(-50%) scale(1);    }
          50%      { transform: translateX(-50%) scale(1.3);  }
        }
      `}</style>

      <div className="page-header">
        <h1 className="page-title">🏢 UFIConnect HQ</h1>
        <p className="page-subtitle">
          6 AI agents maintain your platform — they walk to your office when they need your approval
        </p>
      </div>

      <StatusHeader
        sessionTime={sessionTime}
        agentsActive={6}
        eventsCount={eventsCount}
      />

      {/* Main layout: office left, sidebar right */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 300px',
        gap: 18,
        alignItems: 'start',
      }}>
        {/* Left: Office */}
        <OfficeFloorPlan
          agentStates={agentStates}
          pendingAgentId={pendingRequest?.agentId}
        />

        {/* Right: Permission + Log */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {pendingRequest ? (
            <PermissionCard
              request={pendingRequest}
              onGrant={handleGrant}
              onDeny={handleDeny}
            />
          ) : (
            <div style={{
              background: '#F8FAFC',
              border: '1.5px dashed #CBD5E1',
              borderRadius: 12, padding: '18px',
              textAlign: 'center', color: '#94A3B8',
              fontSize: '.8rem',
            }}>
              <div style={{ fontSize: '1.6rem', marginBottom: 8 }}>🪑</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Your office is empty</div>
              <div style={{ fontSize: '.72rem' }}>Agents will walk here when they need your approval</div>
            </div>
          )}

          {/* Agent roster */}
          <div style={{
            background: '#fff',
            border: '1px solid #E2E8F0',
            borderRadius: 12, padding: '14px',
          }}>
            <div style={{ fontWeight: 800, fontSize: '.82rem', marginBottom: 10, color: '#0F172A' }}>
              🤖 Agent Roster
            </div>
            {AGENT_DEFS.map(agent => {
              const s = agentStates[agent.id];
              const statusLabel =
                s.status === 'idle'      ? '● Working'  :
                s.status === 'walking'   ? '🚶 Walking' :
                s.status === 'at_office' ? '🏃 At your office' :
                s.status === 'returning' ? '↩ Returning' : '●';
              const statusColor =
                s.status === 'idle'      ? agent.color :
                s.status === 'walking'   ? '#D97706'   :
                s.status === 'at_office' ? '#DC2626'   :
                '#059669';
              return (
                <div key={agent.id} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 0',
                  borderBottom: '1px solid #F1F5F9',
                }}>
                  <span style={{ fontSize: '1rem' }}>{agent.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '.75rem', fontWeight: 700 }}>{agent.name}</div>
                    <div style={{ fontSize: '.63rem', color: '#94A3B8' }}>{agent.role}</div>
                  </div>
                  <span style={{
                    fontSize: '.62rem', fontWeight: 700,
                    color: statusColor,
                    whiteSpace: 'nowrap',
                  }}>{statusLabel}</span>
                </div>
              );
            })}
          </div>

          <ActivityLog log={activityLog} />
        </div>
      </div>

      {/* Info footer */}
      <div style={{
        marginTop: 18, padding: '12px 16px',
        background: '#F8FAFC', borderRadius: 10,
        border: '1px solid #E2E8F0',
        fontSize: '.75rem', color: '#64748B',
        display: 'flex', gap: 8, alignItems: 'center',
      }}>
        <span>ℹ️</span>
        <span>
          Agents autonomously monitor the platform. When they need your approval for a significant change
          (security updates, archiving content, publishing to users), they walk to your office and wait.
          High-risk actions are flagged in red.
        </span>
      </div>
    </Layout>
  );
}
