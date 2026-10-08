import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CITY_SOURCE_IDS } from '../local/citySources';
import { SOURCE_META } from './sourceMeta';
import { downloadText, useLocalWorkspace } from '../local/localWorkspace';
import { readImportText } from '../utils/importText.mjs';

const DEFAULT = { rows: [], source: 'uficonnect', notes: '', experiment: { objective: 'Rank relevant posts', model: 'Feed-forward neural network', training: 80, metric: 'Precision@10', epochs: 20 }, impressions: 10000, rpm: 3, cost: 0 };
const EMPTY_ROW = { source: 'uficonnect', date: '', views: 0, likes: 0, comments: 0, saves: 0, revenue: 0 };
const numbers = ['views', 'likes', 'comments', 'saves', 'revenue'];
function cleanRows(rows) {
  if (!Array.isArray(rows) || rows.length > 1000) throw new Error('Import up to 1,000 aggregate rows.');
  return rows.map(row => {
    if (!row || !CITY_SOURCE_IDS.includes(row.source) || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') || !Number.isFinite(Date.parse(row.date))) throw new Error('Each row needs a supported source and a date in YYYY-MM-DD format.');
    const out = { source: row.source, date: row.date };
    for (const key of numbers) { const n = Number(row[key] ?? 0); if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new Error('Metrics must be numbers between 0 and 1 trillion.'); out[key] = n; }
    return out;
  });
}
export default function SourceWorkspace({ kind, accountId }) {
  const saved = useLocalWorkspace(accountId, kind, DEFAULT);
  const value = { ...DEFAULT, ...saved.value, experiment: { ...DEFAULT.experiment, ...saved.value.experiment } };
  const latestValue = useRef(value);
  latestValue.current = value;
  const importEpoch = useRef(0);
  useEffect(() => () => { importEpoch.current += 1; }, [accountId, kind]);
  const [draft, setDraft] = useState({ ...EMPTY_ROW, date: new Date().toISOString().slice(0, 10) });
  const [notice, setNotice] = useState('');
  const [scope, setScope] = useState('all');
  const rows = Array.isArray(value.rows) ? value.rows : [];
  const filtered = rows.filter(row => scope === 'all' || row.source === scope);
  const totals = filtered.reduce((all, row) => Object.fromEntries(numbers.map(key => [key, all[key] + Number(row[key] || 0)])), Object.fromEntries(numbers.map(key => [key, 0])));
  const update = patch => {
    const next = { ...latestValue.current, ...patch, updatedAt: new Date().toISOString() };
    if (!saved.save(next)) return false;
    latestValue.current = next;
    return true;
  };
  const options = CITY_SOURCE_IDS.map(source => <option key={source} value={source}>{SOURCE_META[source]?.label || source}</option>);
  const exportData = () => downloadText(`ufi-${kind}.json`, JSON.stringify({ ...value, exportedAt: new Date().toISOString() }, null, 2), 'application/json');
  async function importRows(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const request = ++importEpoch.current;
    try {
      const text = await readImportText(file, 1024 * 1024, 'Choose a nonempty aggregate report up to 1 MB.');
      if (request !== importEpoch.current) return;
      const data = JSON.parse(text); const incoming = cleanRows(Array.isArray(data) ? data : data?.rows);
      const currentRows = Array.isArray(latestValue.current.rows) ? latestValue.current.rows : [];
      if (currentRows.length + incoming.length > 1000) throw new Error('This workspace holds up to 1,000 rows.');
      if (update({ rows: [...currentRows, ...incoming] })) setNotice(`${incoming.length} rows imported. Only aggregate metric fields were retained.`);
    } catch (error) { if (request === importEpoch.current) setNotice(error.message); }
  }
  const engagement = totals.views ? ((totals.likes + totals.comments + totals.saves) / totals.views * 100).toFixed(2) : '0.00';
  const experiment = value.experiment;
  return <section className="card source-lab">
    <div className="local-workspace-heading"><div><h2>UFI & source workspace</h2><p className="local-muted">Your own aggregate reports, saved in this browser. No provider data is connected automatically.</p></div><Link className="btn btn-ghost btn-sm" to="/connected-accounts">Connected accounts</Link></div>
    <div className="local-chip-row"><Link className="btn btn-ghost btn-sm" to={kind === 'deep-learning' ? '/analytics#analytics-learning-title' : kind === 'monetization' ? '/analytics#analytics-monetization-title' : '/analytics'}>Open connected-source reports & insights</Link><label className="local-field">View source<select value={scope} onChange={event => setScope(event.target.value)}><option value="all">All sources</option>{options}</select></label><button type="button" className="btn btn-ghost btn-sm" onClick={exportData}>Export workspace</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadText('source-metrics-template.json', JSON.stringify([{ ...EMPTY_ROW, date: new Date().toISOString().slice(0, 10) }], null, 2), 'application/json')}>Download import template</button><label className="local-field">Import metrics JSON<input type="file" accept=".json,application/json" onChange={importRows} /></label></div>
    <div className="local-metric-grid"><div className="card"><strong>{totals.views.toLocaleString()}</strong><span>Reported views</span></div><div className="card"><strong>{engagement}%</strong><span>Interactions per view</span></div><div className="card"><strong>${totals.revenue.toFixed(2)}</strong><span>Reported revenue (USD)</span></div></div>
    {kind === 'monetization' && <section className="source-lab-section"><h3>Revenue planner</h3><div className="local-field-grid">{[['impressions', 'Monthly impressions'], ['rpm', 'Your revenue per 1,000 views (USD)'], ['cost', 'Monthly cost (USD)']].map(([key, label]) => <label className="local-field" key={key}>{label}<input type="number" min="0" max="1000000000" step={key === 'impressions' ? '1' : '.01'} value={value[key]} onChange={event => update({ [key]: Math.min(1e9, Math.max(0, Number(event.target.value) || 0)) })} /></label>)}</div><p><strong>${(value.impressions / 1000 * value.rpm - value.cost).toFixed(2)}</strong> estimated monthly net from your assumptions.</p><p className="local-muted">Planning estimate only. Actual earnings, fees, eligibility, and payout reporting must come from each provider.</p></section>}
    {kind === 'deep-learning' && <section className="source-lab-section"><h3>Model experiment</h3><div className="local-field-grid"><label className="local-field">Objective<input maxLength={200} value={experiment.objective} onChange={event => update({ experiment: { ...experiment, objective: event.target.value } })} /></label><label className="local-field">Model<select value={experiment.model} onChange={event => update({ experiment: { ...experiment, model: event.target.value } })}><option>Feed-forward neural network</option><option>Content embeddings</option><option>Sequence model</option></select></label><label className="local-field">Training split<select value={experiment.training} onChange={event => update({ experiment: { ...experiment, training: Number(event.target.value) } })}><option value="70">70% train / 30% evaluation</option><option value="80">80% train / 20% evaluation</option></select></label><label className="local-field">Evaluation metric<select value={experiment.metric} onChange={event => update({ experiment: { ...experiment, metric: event.target.value } })}><option>Precision@10</option><option>NDCG@10</option><option>Mean absolute error</option></select></label></div><p>{filtered.length} aggregate rows available · {Math.floor(filtered.length * experiment.training / 100)} training rows · {filtered.length - Math.floor(filtered.length * experiment.training / 100)} evaluation rows.</p><button type="button" className="btn btn-ghost btn-sm" disabled={!filtered.length} onClick={() => downloadText('ufi-model-experiment.json', JSON.stringify({ experiment, data: filtered, trainingStatus: 'not_started', requires: 'A model runtime, suitable training labels, and authorized source data' }, null, 2), 'application/json')}>Export experiment & dataset</button><p className="local-muted">Dataset preparation and experiment planning. A training runtime is not connected; no model has been trained. Vault contents and private messages are excluded.</p></section>}
    <details className="source-lab-section"><summary>Add reported metrics</summary><form onSubmit={event => { event.preventDefault(); try { const clean = cleanRows([draft]); if (rows.length >= 1000) throw new Error('Export and clear old rows before adding more.'); if (update({ rows: [...rows, ...clean] })) setNotice('Metrics saved.'); } catch (error) { setNotice(error.message); } }}><div className="local-field-grid"><label className="local-field">Source<select value={draft.source} onChange={event => setDraft({ ...draft, source: event.target.value })}>{options}</select></label><label className="local-field">Date<input type="date" required value={draft.date} onChange={event => setDraft({ ...draft, date: event.target.value })} /></label>{numbers.map(key => <label key={key} className="local-field">{key === 'revenue' ? 'Revenue (USD)' : key}<input type="number" min="0" max="1000000000000" step={key === 'revenue' ? '.01' : '1'} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>)}</div><button className="btn btn-ghost btn-sm">Save reported metrics</button></form></details>
    <div className="local-table-scroll"><table className="local-table"><thead><tr><th>Source</th><th>Date</th><th>Views</th><th>Interactions</th><th>Revenue</th><th /></tr></thead><tbody>{filtered.slice(-100).reverse().map((row, index) => <tr key={index}><td>{SOURCE_META[row.source]?.label || row.source}</td><td>{row.date}</td><td>{Number(row.views).toLocaleString()}</td><td>{Number(row.likes) + Number(row.comments) + Number(row.saves)}</td><td>${Number(row.revenue).toFixed(2)}</td><td><button type="button" className="btn btn-ghost btn-sm" onClick={() => update({ rows: rows.filter(item => item !== row) })}>Remove</button></td></tr>)}</tbody></table>{!filtered.length && <p className="local-muted">No reports yet. Add your metrics or import the template from a source you manage.</p>}</div>
    <label className="local-field">{kind === 'monetization' ? 'Offers, sponsorships & next steps' : kind === 'deep-learning' ? 'Data permissions, labels & experiment notes' : 'Findings & next steps'}<textarea rows={5} maxLength={20000} value={value.notes} onChange={event => update({ notes: event.target.value })} /></label>
    <p className="local-muted" role="status">{saved.error || notice || 'Changes save in this browser.'}</p>
  </section>;
}
