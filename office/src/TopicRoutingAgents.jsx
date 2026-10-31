import { useEffect, useRef, useState } from 'react';
import { readOperation, operationDate as date, operationNumber as num } from './operations-runtime.mjs';

function elapsed(ms) {
  if (ms == null) return 'Not recorded';
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m`;
}

export default function TopicRoutingAgents({ agents = [], routing, apiBase, request, onUpdated }) {
  const [running, setRunning] = useState(''), [error, setError] = useState(''), [result, setResult] = useState(null);
  const generation = useRef(0), inFlight = useRef(false);
  useEffect(() => { const reset = () => { generation.current++; setError(''); setResult(null); }; window.addEventListener('office-token-changed', reset); return () => { generation.current++; window.removeEventListener('office-token-changed', reset); }; }, []);
  async function runAgent(agent) {
    if (inFlight.current) return;
    inFlight.current = true; const current = generation.current; setRunning(agent.id); setError(''); setResult(null);
    try {
      const body = await readOperation(await request(`${apiBase}/office/agents/${encodeURIComponent(agent.id)}/trigger`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) }));
      if (current === generation.current) { setResult({ name: agent.name, ...body }); onUpdated(); }
    } catch (e) { if (current === generation.current) setError(e.message); }
    finally { inFlight.current = false; setRunning(''); }
  }
  return <section className="op-card" aria-label="Automatic topic routing agents">
    <div className="op-heading"><div><h2>Automatic topic routing</h2><p>Posts are checked for a matching subtopic when they are saved. Assigned agents check for missed work{routing?.intervalMs ? ` every ${routing.intervalMs / 1000} seconds` : ''}, while older posts receive ongoing review.</p></div><span className={`op-tag ${routing?.enabled ? 'approved' : 'held'}`}>{routing ? routing.enabled ? 'Automatic routing enabled' : 'Automatic routing inactive' : 'Waiting for agent status'}</span></div>
    <p>Specific subject matches take priority over general labels such as tutorials. Competing matches remain Unclassified for review. Agent timing and backlog below are observed values; large backlogs can take longer to clear.</p>
    {error && <div className="op-error" role="alert">{error}</div>}
    {result && <div className="op-notice" role="status">{result.name}: {result.skipped ? 'Another worker already owns this check.' : 'Check completed.'}<details><summary>View routing result</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></div>}
    {!agents.length && <p>No routing agent observations are available yet.</p>}
    <div className="op-grid">{agents.map(agent => <article className="op-card" key={agent.id}>
      <div className="op-heading"><h3>{agent.name}</h3><span className={`op-tag ${agent.error || agent.status === 'degraded' ? 'rejected' : agent.running ? 'held' : ''}`}>{agent.status?.replaceAll('_', ' ') || 'Not observed'}</span></div>
      <p>{num(agent.topics?.length)} assigned topics · {agent.intervalMs ? `${agent.intervalMs / 1000}s checks` : 'Cadence pending'}</p>
      <dl className="op-agent-metrics"><div><dt>Waiting for review</dt><dd>{num(agent.pending)}</dd></div><div><dt>Oldest waiting</dt><dd>{agent.pending === 0 ? 'No backlog' : elapsed(agent.lagMs)}</dd></div><div><dt>Checked last run</dt><dd>{agent.lastRun ? num(agent.lastChecked) : '—'}</dd></div><div><dt>Posts checked in total</dt><dd>{num(agent.checked)}</dd></div><div><dt>Subtopics assigned in total</dt><dd>{num(agent.assigned)}</dd></div><div><dt>Unknown posts resolved</dt><dd>{num(agent.resolved)}</dd></div></dl>
      <p><small>Last run: {date(agent.lastRun)}<br />Next check: {date(agent.nextRun)}</small></p>
      {agent.error && <p role="alert" className="op-error">{agent.error}</p>}
      <button disabled={!!running || agent.running || !agent.enabled} onClick={() => runAgent(agent)}>{running === agent.id ? 'Checking…' : `Run ${agent.name} now`}</button>
      <details><summary>View assigned topics</summary><div className="op-subtopics">{agent.topics?.map(topic => <span className="op-tag" key={topic}>{topic}</span>)}</div></details>
    </article>)}</div>
    {routing?.observedAt && <p><small>Agent observations refreshed {date(routing.observedAt)}</small></p>}
  </section>;
}
