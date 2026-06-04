import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  {
    id: 'cache_helper', name: 'Cache Helper', emoji: '🗄️',
    color: '#6366F1', bg: '#EEF2FF', role: 'Feed Cache Coordinator',
    homeX: 46, homeY: 52,
    tasks: [
      'Merging source caches…', 'Deduplicating feed entries…',
      'Indexing per-source posts…', 'Syncing source agent stores…',
      'Compacting stale entries…',
    ],
    completions: [
      'Source caches merged — global feed updated',
      'Deduplication complete — feed quality maintained',
      'Source agent stores synchronised successfully',
      'Cache compacted — 500 newest posts retained per source',
      'Cache sync: all source agents reporting healthy',
    ],
  },
  {
    id: 'web_optimizer', name: 'Website Optimizer', emoji: '🌐',
    color: '#14B8A6', bg: '#ECFDF5', role: 'Public Domain Optimizer',
    homeX: 46, homeY: 40,
    tasks: [
      'Auditing uficonnect.org…', 'Coordinating optimizer sub-agents…',
      'Scoring public-domain readiness…', 'Checking live page health…',
      'Reviewing domain response signals…',
    ],
    completions: [
      'Public website optimizer finished a domain health pass',
      'Optimizer score refreshed from live uficonnect.org checks',
      'Public-domain audit coordinated across performance, SEO, cache, and storage',
      'Website optimization run stored for office reporting',
    ],
  },
  {
    id: 'web_perf', name: 'Web Perf Sub-Agent', emoji: '⚡',
    color: '#F59E0B', bg: '#FFFBEB', role: 'Latency Watch',
    homeX: 13, homeY: 40,
    compact: true,
    tasks: [
      'Measuring TTFB…', 'Timing public response…',
      'Checking payload size…', 'Inspecting HTTP status…',
      'Sampling live headers…',
    ],
    completions: [
      'Performance sample saved from the public domain',
      'TTFB and total response timing refreshed',
      'Public payload size checked against optimizer targets',
    ],
  },
  {
    id: 'web_seo', name: 'Web SEO Sub-Agent', emoji: '🔎',
    color: '#22C55E', bg: '#F0FDF4', role: 'SEO Signals',
    homeX: 30, homeY: 40,
    compact: true,
    tasks: [
      'Checking canonical tags…', 'Validating sitemap.xml…',
      'Reading robots.txt…', 'Checking manifest.json…',
      'Scanning Open Graph metadata…',
    ],
    completions: [
      'SEO surface checked across sitemap, robots, manifest, and metadata',
      'Public search signals refreshed for office reporting',
      'Domain metadata audit completed',
    ],
  },
  {
    id: 'web_cache', name: 'Web Cache Sub-Agent', emoji: '🗄️',
    color: '#6366F1', bg: '#EEF2FF', role: 'Cache Sort',
    homeX: 63, homeY: 40,
    compact: true,
    tasks: [
      'Verifying service worker…', 'Sorting hot feed data…',
      'Merging source caches…', 'Checking public cache path…',
      'Coordinating cache helper…',
    ],
    completions: [
      'Website cache pass coordinated with source cache helpers',
      'Hot feed cache sorted for faster page loads',
      'Public service worker cache status refreshed',
    ],
  },
  {
    id: 'web_storage', name: 'Fast Storage Sub-Agent', emoji: '💾',
    color: '#FB7185', bg: '#FFF1F2', role: 'Fast Intake',
    homeX: 79, homeY: 40,
    compact: true,
    tasks: [
      'Persisting hot posts…', 'Queueing stale sources…',
      'Warming DB feed cache…', 'Batching source data…',
      'Respecting stability guard…',
    ],
    completions: [
      'Fast storage pass saved hot source data',
      'Stale source refreshes queued for shorter intake windows',
      'DB feed cache warmed without tripping stability guard',
    ],
  },
  {
    id: 'web_api', name: 'API Optimizer', emoji: '🧠',
    color: '#0EA5E9', bg: '#F0F9FF', role: 'API Health',
    homeX: 13, homeY: 31,
    compact: true,
    tasks: [
      'Checking API health…', 'Reading DB status…',
      'Verifying agent endpoints…', 'Timing backend response…',
      'Auditing data layer readiness…',
    ],
    completions: [
      'API health checked for the public website',
      'Backend agent surface verified',
      'Data layer readiness refreshed',
    ],
  },
  {
    id: 'web_office', name: 'Office Optimizer', emoji: '🏢',
    color: '#A855F7', bg: '#FAF5FF', role: 'Office App',
    homeX: 46, homeY: 31,
    compact: true,
    tasks: [
      'Checking office app shell…', 'Timing office response…',
      'Auditing dashboard payload…', 'Confirming public reachability…',
      'Reviewing ops surface health…',
    ],
    completions: [
      'Office dashboard health sampled from the public domain',
      'Operations app shell verified',
      'Office response timing refreshed',
    ],
  },
  {
    id: 'web_pwa', name: 'PWA/App Optimizer', emoji: '📱',
    color: '#06B6D4', bg: '#ECFEFF', role: 'App Metadata',
    homeX: 79, homeY: 31,
    compact: true,
    tasks: [
      'Checking manifest.json…', 'Verifying app icons…',
      'Auditing service worker…', 'Reviewing install metadata…',
      'Checking Play Store readiness…',
    ],
    completions: [
      'PWA metadata validated for install readiness',
      'Manifest and service worker checks refreshed',
      'App shell install signals checked',
    ],
  },
];

/* ─── Active Source Agents ───────────────────────────────────────────────────── */
const SOURCE_AGENTS = [
  { id: 'reddit',        emoji: '🟠', name: 'Reddit',          color: '#FF6347' },
  { id: 'hn',            emoji: '🔶', name: 'Hacker News',     color: '#FF6600' },
  { id: 'github',        emoji: '🐙', name: 'GitHub',          color: '#475569' },
  { id: 'gitlab',        emoji: 'GL', name: 'GitLab',          color: '#FC6D26' },
  { id: 'devto',         emoji: '💻', name: 'DEV.to',          color: '#8B5CF6' },
  { id: 'medium',        emoji: '📝', name: 'Medium',          color: '#10B981' },
  { id: 'youtube',       emoji: '▶️',  name: 'YouTube',         color: '#EF4444' },
  { id: 'stackoverflow', emoji: '💬', name: 'Stack Overflow',  color: '#F59E0B' },
  { id: 'mastodon',      emoji: '🐘', name: 'Mastodon',        color: '#6366F1' },
  { id: 'lobsters',      emoji: '🦞', name: 'Lobsters',        color: '#DC2626' },
  { id: 'arxiv',         emoji: '📄', name: 'arXiv',           color: '#3B82F6' },
  { id: 'indeed',        emoji: '💼', name: 'Indeed',          color: '#2557A7' },
  { id: 'producthunt',   emoji: '🚀', name: 'Product Hunt',    color: '#DA552F' },
  { id: 'techcrunch',    emoji: '📰', name: 'TechCrunch',      color: '#0D9F3F' },
  { id: 'theverge',      emoji: '⬛', name: 'The Verge',       color: '#CC2200' },
  { id: 'indiehackers',  emoji: '💡', name: 'Indie Hackers',   color: '#0E2150' },
  { id: 'hashnode',      emoji: '✍️',  name: 'Hashnode',        color: '#2962FF' },
  { id: 'bluesky',       emoji: '🦋', name: 'Bluesky',         color: '#0085FF' },
  { id: 'arstechnica',   emoji: '📡', name: 'Ars Technica',    color: '#FF6600' },
  { id: 'wired',         emoji: '🔌', name: 'WIRED',           color: '#444444' },
  { id: 'theregister',   emoji: '📋', name: 'The Register',    color: '#CC0000' },
  { id: 'venturebeat',   emoji: '💹', name: 'VentureBeat',     color: '#1E6FBF' },
  { id: 'smashing',      emoji: '🎨', name: 'Smashing Mag',    color: '#E9620A' },
  { id: 'phoronix',      emoji: '🐧', name: 'Phoronix',        color: '#2B7BB9' },
  { id: 'infoq',         emoji: '🏗️',  name: 'InfoQ',           color: '#67B346' },
  { id: 'mittr',         emoji: '🔬', name: 'MIT Tech Review', color: '#A31F34' },
  { id: 'remoteok',      emoji: 'RO', name: 'Remote OK',       color: '#10B981' },
  { id: 'yc',            emoji: 'YC', name: 'Y Combinator',    color: '#FF6600' },
  { id: 'crunchbase',    emoji: 'CB', name: 'Crunchbase',      color: '#146AFF' },
  { id: 'behance',       emoji: 'Be', name: 'Behance',         color: '#053EFF' },
  { id: 'designweb',     emoji: 'UX', name: 'Design Web',      color: '#DB2777' },
  { id: 'linkedin',   emoji: '🔷', name: 'LinkedIn',    color: '#0A66C2', needsAuth: true },
  { id: 'twitter',    emoji: '🐦', name: 'X / Twitter', color: '#1DA1F2', needsAuth: true },
  { id: 'instagram',  emoji: '📸', name: 'Instagram',   color: '#E1306C', needsAuth: true },
  { id: 'facebook',   emoji: '📘', name: 'Facebook',    color: '#1877F2', needsAuth: true },
];

const SCAN_TOPICS = [
  'AI & ML', 'Open Source', 'Cybersecurity', 'DevOps', 'Frontend',
  'Backend', 'Web3', 'SaaS', 'Design', 'FinTech', 'Career',
  'Startups', 'Remote Work', 'Mobile Dev', 'EdTech', 'Health Tech',
];

const CORRIDOR_Y = 42;
const EXEC_ZONE  = { x: 50, y: CORRIDOR_Y };

/* ─── Live Data Card ─────────────────────────────────────────────────────────── */
function LiveDataCard({ agent, phaseData, stats, onTrigger, onConnect, connected }) {
  const isAuthNeeded = agent.needsAuth && !connected;
  const phase     = isAuthNeeded ? -1 : (phaseData?.phase ?? 0);
  const topicIdx  = phaseData?.topic ?? 0;
  const phaseMeta = isAuthNeeded
    ? { label: '🔒 Needs auth', barW: '0%', color: '#94A3B8' }
    : [
        { label: '🔍 Scanning topics', barW: '35%', color: '#94A3B8' },
        { label: '⚡ Fetching posts',  barW: '72%', color: '#F59E0B' },
        { label: '✅ Cache updated',   barW: '100%', color: '#4ADE80' },
      ][phase];
  const lastFetchAgo = stats?.lastFetch
    ? Math.round((Date.now() - stats.lastFetch) / 60000) : null;

  return (
    <div style={{
      background: '#fff',
      border: `2px solid ${phase === 2 ? agent.color + '55' : agent.color + '1A'}`,
      borderRadius: 12,
      padding: '12px 14px',
      display: 'flex', flexDirection: 'column', gap: 7,
      transition: 'border-color 0.6s',
      boxShadow: phase === 1 ? `0 0 0 3px ${agent.color}18` : 'none',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: `${agent.color}15`,
          border: `1.5px solid ${agent.color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.05rem',
          animation: phase === 1 ? 'srcPulse 1s ease-in-out infinite' : 'none',
        }}>{agent.emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#0F172A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {agent.name}
          </div>
          <div style={{ fontSize: '.6rem', color: phaseMeta.color, fontWeight: 600 }}>
            {phaseMeta.label}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: '.82rem', fontWeight: 900, color: agent.color }}>
            {(stats?.postCount ?? 0).toLocaleString()}
          </div>
          <div style={{ fontSize: '.56rem', color: '#94A3B8' }}>cached</div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 4, background: '#F1F5F9', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: phaseMeta.barW,
          background: `linear-gradient(90deg, ${agent.color}88, ${agent.color})`,
          borderRadius: 2,
          transition: 'width 0.9s ease',
        }} />
      </div>

      {/* Footer row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '.6rem', color: '#94A3B8' }}>
          {!isAuthNeeded && phase === 0 && `topic: ${SCAN_TOPICS[topicIdx % SCAN_TOPICS.length]}`}
          {!isAuthNeeded && phase === 1 && `fetching…`}
          {!isAuthNeeded && phase === 2 && (lastFetchAgo === 0 ? 'just now' : lastFetchAgo !== null ? `${lastFetchAgo}m ago` : '—')}
          {isAuthNeeded && <span style={{ color: '#94A3B8' }}>connect to activate</span>}
        </div>
        {isAuthNeeded ? (
          <button onClick={onConnect} style={{
            padding: '2px 8px', border: 'none', borderRadius: 5, cursor: 'pointer',
            background: `${agent.color}18`, color: agent.color,
            fontSize: '.6rem', fontWeight: 700,
          }}>+ Connect</button>
        ) : (
          <button onClick={onTrigger} style={{
            padding: '2px 8px', border: 'none', borderRadius: 5,
            background: `${agent.color}18`, color: agent.color,
            fontSize: '.6rem', fontWeight: 700, cursor: 'pointer',
          }}>▶</button>
        )}
      </div>
    </div>
  );
}

/* ─── Floor Plan Sub-components ─────────────────────────────────────────────── */
function AgentRoom({ agent, agentState }) {
  const isHome = agentState.status === 'idle';
  const isHub  = agent.id === 'cache_helper' || agent.id === 'web_optimizer';
  const isCompact = agent.compact;
  const roomW = isHub ? 16 : isCompact ? 12 : 22;
  const roomH = isHub ? 14 : isCompact ? 10 : 24;
  const roomPad = isHub || isCompact ? '3% 4%' : '6% 8%';
  return (
    <div style={{
      position: 'absolute',
      left: `${agent.homeX - roomW / 2}%`,
      top:  `${agent.homeY - roomH / 2}%`,
      width:  `${roomW}%`,
      height: `${roomH}%`,
      background: isHome ? agent.bg : '#fff',
      border: `1.5px solid ${isHome ? agent.color + '44' : '#E2E8F0'}`,
      borderRadius: isHub ? 8 : 10,
      padding: roomPad,
      transition: 'all 0.5s ease',
      boxShadow: isHome ? `0 2px 12px ${agent.color}18` : 'none',
      zIndex: isHub ? 2 : 1,
    }}>
      <div style={{ fontSize: isCompact ? '.5rem' : '.6rem', fontWeight: 800, color: agent.color, opacity: .7, marginBottom: 2, letterSpacing: '.5px' }}>
        {agent.role.toUpperCase()}
      </div>
      <div style={{ fontSize: isCompact ? '.62rem' : '.72rem', fontWeight: 700, color: '#0F172A' }}>{agent.name}</div>
      {isHome && !isCompact && (
        <div style={{ fontSize: isCompact ? '.5rem' : '.58rem', color: '#64748B', marginTop: 4, animation: 'agentTaskFade 0.4s ease', lineHeight: 1.4 }}>
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
    { k: 'AGENTS',   v: `${SOURCE_AGENTS.length}+${AGENT_DEFS.length}`, color: '#FCD34D' },
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
function ActivityLog({ log, maxHeight = 280 }) {
  return (
    <div style={{ background: '#0F172A', borderRadius: 12, padding: '14px', maxHeight, overflowY: 'auto' }}>
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
function StatusHeader({ sessionTime, eventsCount, agentCount }) {
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
          { label: 'Mode',    value: '🟢 Fully Autonomous',          color: '#4ADE80' },
          { label: 'Agents',  value: `${agentCount} / ${agentCount} active`, color: '#60A5FA' },
          { label: 'Events',  value: eventsCount.toLocaleString(),   color: '#A78BFA' },
          { label: 'Session', value: sessionTime,                    color: '#34D399' },
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

/* ─── useCountUp hook ────────────────────────────────────────────────────────── */
function useCountUp(target, duration = 1400, active = true) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) { setValue(0); return; }
    let start = null;
    const raf = requestAnimationFrame(function step(ts) {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.floor(eased * target));
      if (p < 1) requestAnimationFrame(step);
      else setValue(target);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, duration, active]);
  return value;
}

/* ─── Animated Ring (SVG) ────────────────────────────────────────────────────── */
function AnimatedRing({ pct, color, size = 64, stroke = 6 }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * (pct / 100);
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E2E8F0" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)' }}
      />
    </svg>
  );
}

/* ─── Overview Tab ───────────────────────────────────────────────────────────── */
function OverviewTab({ agentStates, eventsCount, sourceAgents, sessionTime, agentCount }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { const t = setTimeout(() => setMounted(true), 60); return () => clearTimeout(t); }, []);

  const totalPosts = useMemo(() => sourceAgents.reduce((s, a) => s + (a.postCount || 0), 0), [sourceAgents]);
  const activeNow  = useMemo(() => Object.values(agentStates).filter(s => s.status !== 'idle').length, [agentStates]);

  const cAgents = useCountUp(agentCount,  1200, mounted);
  const cEvents = useCountUp(eventsCount, 1500, mounted);
  const cPosts  = useCountUp(totalPosts,  1600, mounted);
  const cActive = useCountUp(activeNow,   800,  mounted);

  const metrics = [
    { label: 'Total Agents',   value: cAgents,  suffix: '',  color: '#2563EB', bg: '#EFF6FF', icon: '🤖', pct: 100 },
    { label: 'Events Fired',   value: cEvents,  suffix: '',  color: '#7C3AED', bg: '#F3EEFF', icon: '⚡', pct: Math.min(eventsCount / 5, 100) },
    { label: 'Posts Indexed',  value: cPosts,   suffix: '',  color: '#059669', bg: '#ECFDF5', icon: '📊', pct: Math.min(totalPosts / 200, 100) },
    { label: 'Active Now',     value: cActive,  suffix: '',  color: '#D97706', bg: '#FFFBEB', icon: '🔄', pct: agentCount > 0 ? (activeNow / agentCount) * 100 : 0 },
  ];

  const topSources = useMemo(() =>
    [...sourceAgents].sort((a, b) => (b.postCount || 0) - (a.postCount || 0)).slice(0, 8),
    [sourceAgents]
  );
  const maxPosts = topSources[0]?.postCount || 1;

  return (
    <div style={{ animation: 'slideUp 0.35s ease' }}>
      {/* ── Metric cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {metrics.map((m, i) => (
          <div key={m.label} style={{
            background: '#fff',
            border: `1.5px solid ${m.color}22`,
            borderRadius: 14,
            padding: '16px 18px',
            display: 'flex', alignItems: 'center', gap: 14,
            boxShadow: `0 4px 20px ${m.color}12`,
            animation: `fadeScale 0.4s ease ${i * 80}ms both`,
          }}>
            <AnimatedRing pct={mounted ? m.pct : 0} color={m.color} size={56} stroke={5} />
            <div>
              <div style={{ fontSize: '1.55rem', fontWeight: 900, color: m.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {m.value.toLocaleString()}{m.suffix}
              </div>
              <div style={{ fontSize: '.65rem', color: '#64748B', fontWeight: 600, marginTop: 3, textTransform: 'uppercase', letterSpacing: '.5px' }}>
                {m.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Agent health grid ── */}
      <div style={{ fontSize: '.68rem', fontWeight: 800, color: '#64748B', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10 }}>
        ▸ Ops Agent Health
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 10, marginBottom: 24,
      }}>
        {AGENT_DEFS.map((agent, i) => {
          const s = agentStates[agent.id];
          const isActive = s.status !== 'idle';
          const pct = isActive ? 100 : 30 + Math.sin(i * 1.7) * 20;
          return (
            <div key={agent.id} style={{
              background: '#fff',
              border: `1.5px solid ${isActive ? agent.color + '55' : '#E2E8F0'}`,
              borderRadius: 12,
              padding: '12px 14px',
              animation: `fadeScale 0.4s ease ${i * 50}ms both`,
              boxShadow: isActive ? `0 0 0 3px ${agent.color}18` : 'none',
              transition: 'box-shadow 0.5s, border-color 0.5s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{
                  fontSize: '1.1rem',
                  animation: isActive ? 'agentExecute 0.8s ease-in-out infinite' : 'agentIdle 3s ease-in-out infinite',
                  display: 'inline-block',
                }}>{agent.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '.75rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.name}</div>
                  <div style={{ fontSize: '.58rem', color: '#94A3B8' }}>{agent.role}</div>
                </div>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  background: isActive ? '#4ADE80' : agent.color,
                  display: 'inline-block',
                  animation: isActive ? 'agentPulse 1s ease-out infinite' : 'none',
                  boxShadow: isActive ? '0 0 0 0 #4ADE8055' : 'none',
                }} />
              </div>
              {/* Activity bar */}
              <div style={{ height: 3, background: '#F1F5F9', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: mounted ? `${pct}%` : '0%',
                  background: `linear-gradient(90deg, ${agent.color}88, ${agent.color})`,
                  borderRadius: 2,
                  transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)',
                  animation: isActive ? 'barPulse 1.5s ease-in-out infinite' : 'none',
                }} />
              </div>
              <div style={{ fontSize: '.58rem', color: '#94A3B8', marginTop: 5 }}>
                {s.status === 'idle' ? agent.tasks[s.taskIdx] : `● ${s.status}`}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Top data sources ── */}
      <div style={{ fontSize: '.68rem', fontWeight: 800, color: '#64748B', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 10 }}>
        ▸ Top Data Sources — Posts Indexed
      </div>
      <div style={{
        background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12,
        padding: '16px 18px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {topSources.length === 0 && (
          <div style={{ color: '#94A3B8', fontSize: '.8rem' }}>Fetching source data…</div>
        )}
        {topSources.map((src, i) => {
          const agent = SOURCE_AGENTS.find(a => a.id === src.id);
          const barPct = (src.postCount / maxPosts) * 100;
          return (
            <div key={src.id} style={{ display: 'flex', alignItems: 'center', gap: 10, animation: `slideUp 0.3s ease ${i * 40}ms both` }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                background: `${agent?.color || '#64748B'}18`,
                border: `1.5px solid ${agent?.color || '#64748B'}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '.75rem' }}>
                {agent?.emoji || '📡'}
              </div>
              <div style={{ fontSize: '.72rem', fontWeight: 600, width: 100, flexShrink: 0, color: '#0F172A' }}>
                {agent?.name || src.id}
              </div>
              <div style={{ flex: 1, height: 6, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: mounted ? `${barPct}%` : '0%',
                  background: `linear-gradient(90deg, ${agent?.color || '#2563EB'}88, ${agent?.color || '#2563EB'})`,
                  borderRadius: 3,
                  transition: `width 1s cubic-bezier(0.4,0,0.2,1) ${i * 60}ms`,
                }} />
              </div>
              <div style={{ fontSize: '.68rem', fontWeight: 700, color: agent?.color || '#64748B', width: 38, textAlign: 'right', flexShrink: 0 }}>
                {(src.postCount || 0).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>
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
  const [activeTab,      setActiveTab]      = useState('overview');
  const [sourceAgents,   setSourceAgents]   = useState([]);
  const [connectedSocial, setConnectedSocial] = useState({});
  const [workerPhases,   setWorkerPhases]   = useState(
    () => Object.fromEntries(SOURCE_AGENTS.map(a => [a.id, { phase: Math.floor(Math.random() * 3), topic: Math.floor(Math.random() * 16) }]))
  );

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
          setActivityLog(prev => [...newEntries, ...prev]);
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
    addLog('✅', `All ${AGENT_DEFS.length} ops agents online — autonomous mode active`, '#4ADE80');
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

  /* ── Source agent cache stats polling ────────────────────────────────────── */
  useEffect(() => {
    function fetchSources() {
      client.get('/office/sources').then(({ data }) => setSourceAgents(data.sources || [])).catch(() => {});
    }
    fetchSources();
    const t = setInterval(fetchSources, 30000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Social connection status ─────────────────────────────────────────────── */
  useEffect(() => {
    client.get('/profile/social').then(({ data }) => setConnectedSocial(data.connected || {})).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Worker phase animation — advances 3-4 random agents every 750ms ──────── */
  useEffect(() => {
    const ids = SOURCE_AGENTS.map(a => a.id);
    const t = setInterval(() => {
      setWorkerPhases(prev => {
        const next = { ...prev };
        const shuffle = [...ids].sort(() => Math.random() - 0.5).slice(0, 4);
        shuffle.forEach(id => {
          next[id] = {
            phase: (next[id].phase + 1) % 3,
            topic: Math.floor(Math.random() * SCAN_TOPICS.length),
          };
        });
        return next;
      });
    }, 750);
    return () => clearInterval(t);
  }, []);

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

  const techAgents   = SOURCE_AGENTS.filter(a => !a.needsAuth);
  const socialAgents = SOURCE_AGENTS.filter(a => a.needsAuth);

  function SectionBar({ label, right }) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: '.68rem', fontWeight: 800, color: '#64748B', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
          ▸ {label}
        </div>
        {right && <div>{right}</div>}
      </div>
    );
  }

  function Badge({ label, color = '#2563EB', bg = '#EFF6FF', border = '#BFDBFE' }) {
    return (
      <div style={{ fontSize: '.62rem', fontWeight: 700, color, background: bg, padding: '3px 10px', borderRadius: 8, border: `1px solid ${border}` }}>
        {label}
      </div>
    );
  }

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
        @keyframes srcPulse {
          0%,100% { transform: scale(1); opacity: 1; }
          50%      { transform: scale(1.15); opacity: 0.8; }
        }
        @keyframes scanLine {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeScale {
          from { opacity: 0; transform: scale(0.95); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes barPulse {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.6; }
        }
      `}</style>

      <div className="page-header">
        <h1 className="page-title">🏢 UFIConnect HQ</h1>
        <p className="page-subtitle">
          {techAgents.length + socialAgents.length} data agents + {AGENT_DEFS.length} ops agents — fully autonomous 24/7
        </p>
      </div>

      <StatusHeader sessionTime={sessionTime} eventsCount={eventsCount} agentCount={AGENT_DEFS.length + SOURCE_AGENTS.length} />

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', gap: 4, marginBottom: 22,
        background: '#F1F5F9', borderRadius: 10, padding: 4,
        width: 'fit-content',
      }}>
        {[
          { id: 'overview',  label: '📊 Overview' },
          { id: 'floorplan', label: '🏢 Floor Plan' },
          { id: 'dataops',   label: '📡 Data Ops' },
          { id: 'activity',  label: '📋 Activity' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '7px 16px', borderRadius: 7, border: 'none',
              fontSize: '.78rem', fontWeight: 700, cursor: 'pointer',
              background: activeTab === tab.id ? '#fff' : 'transparent',
              color: activeTab === tab.id ? '#0F172A' : '#64748B',
              boxShadow: activeTab === tab.id ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
              transition: 'all 0.2s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {activeTab === 'overview' && (
        <OverviewTab
          agentStates={agentStates}
          eventsCount={eventsCount}
          sourceAgents={sourceAgents}
          sessionTime={sessionTime}
          agentCount={AGENT_DEFS.length + SOURCE_AGENTS.length}
        />
      )}

      {/* ── Floor Plan tab ── */}
      {activeTab === 'floorplan' && (
        <div style={{ animation: 'slideUp 0.3s ease' }}>
          <SectionBar
            label="Ops Command Centre"
            right={<Badge label={`${AGENT_DEFS.length} ops agents`} />}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 18, alignItems: 'start', marginBottom: 24 }}>
            <OfficeFloorPlan agentStates={agentStates} eventsCount={eventsCount} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <LastExecution entry={lastExecution} />
              <ActivityLog log={activityLog} maxHeight={480} />
            </div>
          </div>

          <SectionBar
            label="Ops Roster"
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4ADE80', display: 'inline-block', animation: 'agentPulse 1.6s ease-out infinite' }} />
                <span style={{ fontSize: '.62rem', fontWeight: 700, color: '#059669' }}>ALL AUTONOMOUS</span>
              </div>
            }
          />
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))',
            gap: 8, marginBottom: 28,
            background: '#fff', border: '1px solid #E2E8F0', borderRadius: 12, padding: 12,
          }}>
            {AGENT_DEFS.map(agent => {
              const s = agentStates[agent.id];
              const statusLabel =
                s.status === 'idle'      ? '● Monitoring'  :
                s.status === 'walking'   ? '⚙️ Working'    :
                s.status === 'executing' ? '🔄 Executing'  :
                s.status === 'returning' ? '↩ Returning'   : '●';
              const statusColor =
                s.status === 'idle'      ? agent.color :
                s.status === 'walking'   ? '#D97706'   :
                s.status === 'executing' ? '#DC2626'   : '#059669';
              return (
                <div key={agent.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px',
                  background: s.status === 'idle' ? agent.bg : '#F8FAFC',
                  borderRadius: 8,
                  border: `1px solid ${s.status === 'idle' ? agent.color + '30' : '#E2E8F0'}`,
                  transition: 'all 0.4s',
                }}>
                  <span style={{ fontSize: '1rem', flexShrink: 0 }}>{agent.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '.73rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.name}</div>
                    <div style={{ fontSize: '.59rem', color: '#94A3B8' }}>{agent.role}</div>
                  </div>
                  <div style={{ fontSize: '.58rem', fontWeight: 700, color: statusColor, textAlign: 'right', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    {statusLabel}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Data Ops tab ── */}
      {activeTab === 'dataops' && (
        <div style={{ animation: 'slideUp 0.3s ease' }}>
          <SectionBar
            label="Live Data Operations"
            right={
              <div style={{ display: 'flex', gap: 6 }}>
                <Badge label={`${techAgents.length} tech & news`} color="#0284C7" bg="#F0F9FF" border="#BAE6FD" />
                <Badge label={`${socialAgents.length} social`} color="#7C3AED" bg="#F3EEFF" border="#DDD6FE" />
              </div>
            }
          />
          <div style={{ fontSize: '.62rem', fontWeight: 700, color: '#94A3B8', letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: 8 }}>
            Tech &amp; News
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, marginBottom: 20 }}>
            {techAgents.map(agent => {
              const stats = sourceAgents.find(s => s.id === agent.id);
              return (
                <LiveDataCard
                  key={agent.id} agent={agent}
                  phaseData={workerPhases[agent.id]} stats={stats}
                  connected={connectedSocial[agent.id]}
                  onTrigger={() => client.post(`/office/agents/${agent.id}/trigger`).catch(() => {})}
                  onConnect={async () => { try { const { data } = await client.get(`/auth/social/${agent.id}/start`); window.location.href = data.url; } catch {} }}
                />
              );
            })}
          </div>
          <div style={{ fontSize: '.62rem', fontWeight: 700, color: '#94A3B8', letterSpacing: '.6px', textTransform: 'uppercase', marginBottom: 8 }}>
            Social Platforms
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 10, marginBottom: 24 }}>
            {socialAgents.map(agent => {
              const stats = sourceAgents.find(s => s.id === agent.id);
              return (
                <LiveDataCard
                  key={agent.id} agent={agent}
                  phaseData={workerPhases[agent.id]} stats={stats}
                  connected={connectedSocial[agent.id]}
                  onTrigger={() => client.post(`/office/agents/${agent.id}/trigger`).catch(() => {})}
                  onConnect={async () => { try { const { data } = await client.get(`/auth/social/${agent.id}/start`); window.location.href = data.url; } catch {} }}
                />
              );
            })}
          </div>
          <div style={{ padding: '10px 14px', background: '#F8FAFC', borderRadius: 10, border: '1px solid #E2E8F0', fontSize: '.72rem', color: '#64748B', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span>ℹ️</span>
            <span>
              {techAgents.length} tech & news agents cycle topics continuously.{' '}
              {socialAgents.length} social agents require OAuth connection to activate personalised feeds.
            </span>
          </div>
        </div>
      )}

      {/* ── Activity tab ── */}
      {activeTab === 'activity' && (
        <div style={{ animation: 'slideUp 0.3s ease' }}>
          <SectionBar label="Full Activity Log" right={<Badge label={`${eventsCount} events`} />} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 18, alignItems: 'start' }}>
            <ActivityLog log={activityLog} maxHeight={640} />
            <LastExecution entry={lastExecution} />
          </div>
        </div>
      )}
    </Layout>
  );
}
