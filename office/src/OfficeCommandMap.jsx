import { useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, ChevronRight, GitBranch, List, Map as MapIcon, RefreshCw, Search, X } from 'lucide-react';
import { buildCommandDistricts, buildControlLinks, filterDistrictCommands } from './office-command-city.mjs';
import './OfficeCommandMap.css';

function route(link, from, to) {
  if (link.kind === 'catalog') return { path: to.y > 360 ? `M560 65H22V${to.y}H${to.x - 108}` : `M560 65V94H${to.x}V${to.y - 40}`, hidden: true };
  if (from.y === to.y) return { path: `M${from.x + (to.x > from.x ? 108 : -108)} ${from.y}H${to.x + (to.x > from.x ? -108 : 108)}`, x: (from.x + to.x) / 2, y: from.y - 56 };
  if (from.id === 'Public feed' && to.id === 'Public health') return { path: `M${from.x + 108} ${from.y}H566V${to.y}H${to.x - 108}`, x: 566, y: 473 };
  if (from.x === to.x) return { path: `M${from.x} ${from.y + (to.y > from.y ? 40 : -40)}V${to.y + (to.y > from.y ? -40 : 40)}`, x: from.x, y: (from.y + to.y) / 2 };
  const middle = from.id === 'Travel and restaurants' ? 280 : from.id === 'Office agents' ? 235 : (from.y + to.y) / 2;
  return { path: `M${from.x} ${from.y + (to.y > from.y ? 40 : -40)}V${middle}H${to.x}V${to.y + (to.y > from.y ? -40 : 40)}`, x: (from.x + to.x) / 2, y: middle - 10 };
}

function ControlGraph({ groups, links, selected, query, onSelect, count, patternId }) {
  const byId = new Map(groups.map(group => [group.id, group]));
  const matching = new Set(filterDistrictCommands(groups, query).map(item => item.district.id));
  const height = Math.max(640, ...groups.map(group => group.y + 100));
  return <div className="ocm-canvas"><svg className="ocm-graph-svg" viewBox={`0 0 1120 ${height}`} role="group" aria-label="Connected map of Office controls by purpose">
    <defs><pattern id={patternId} width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="#294158" /></pattern></defs>
    <rect width="1120" height={height} fill={`url(#${patternId})`} opacity=".6" />
    <g className="ocm-connections" aria-hidden="true">{links.map(link => {
      const line = route(link, byId.get(link.from), byId.get(link.to));
      return <g key={`${link.from}-${link.to}`} data-from={link.from} data-to={link.to} data-related={selected && [link.from, link.to].includes(selected)} className={`ocm-connection ocm-connection-${link.kind}`}>
        <path d={line.path} />{!line.hidden && <g transform={`translate(${line.x} ${line.y})`}><rect x={-link.label.length * 3.1 - 7} y="-10" width={link.label.length * 6.2 + 14} height="20" rx="5" /><text textAnchor="middle" y="4">{link.label}</text></g>}
      </g>;
    })}</g>
    <g role="button" tabIndex={0} className="ocm-map-root" aria-label="Browse all Office controls" onClick={() => onSelect('')} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(''); } }}>
      <rect x="460" y="16" width="200" height="49" rx="9" /><text x="560" y="37" textAnchor="middle">All Office controls</text><text x="560" y="53" textAnchor="middle" className="ocm-root-count">{count} commands · {groups.length} groups</text>
    </g>
    {groups.map(group => <g key={group.id} role="button" tabIndex={0} className="ocm-group-node" transform={`translate(${group.x} ${group.y})`} aria-label={`${group.label}, ${group.controls.length} commands. Open group`} aria-pressed={selected === group.id}
      data-selected={selected === group.id} data-matches={matching.has(group.id)} style={{ '--group-color': group.color }} onClick={() => onSelect(group.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(group.id); } }}>
      <title>{group.label}: {group.place}. {group.controls.length} commands.</title>
      <rect className="ocm-node-focus" x="-113" y="-45" width="226" height="90" rx="13" /><rect className="ocm-node-body" x="-108" y="-40" width="216" height="80" rx="9" />
      <rect x="-108" y="-24" width="3" height="48" rx="1.5" fill={group.color} /><circle cx="-91" cy="-18" r="3" fill={group.color} />
      <text x="-81" y="-14" className="ocm-node-title">{group.label}</text><text x="-91" y="7" className="ocm-node-purpose">{group.place}</text><text x="-91" y="27" className="ocm-node-count">{group.controls.length} {group.controls.length === 1 ? 'command' : 'commands'}</text><path d="m88 19 5 5-5 5" fill="none" stroke={group.color} strokeWidth="1.5" />
    </g>)}
  </svg></div>;
}

const targetName = target => ({ api: 'API', pipeline: 'Pipeline', both: 'API + Pipeline' }[target] || 'Office');
function CommandCard({ control, district, onCommand }) {
  return <button type="button" className="ocm-command" data-control-id={control.id} onClick={() => onCommand?.(control.id)} style={{ '--group-color': district.color }} aria-label={`Review ${control.label}`}>
    <span className="ocm-command-point" aria-hidden="true"><GitBranch size={16} /></span><span className="ocm-command-copy"><small>{district.label}</small><strong>{control.label}</strong><span>{control.description || 'Open this command to review its target and options.'}</span><span className="ocm-command-meta"><em>{control.available === false ? 'Setup needed' : `Runs on ${targetName(control.target)}`}</em>{control.requiresConfirmation && <em>Confirmation required</em>}</span></span><ArrowUpRight size={16} className="ocm-command-arrow" />
  </button>;
}

export default function OfficeCommandMap({ controls = [], loading = false, error = '', onCommand, onRefresh }) {
  const [selected, setSelected] = useState(''), [query, setQuery] = useState(''), [mode, setMode] = useState('map');
  const detailRef = useRef(null), patternId = `control-grid-${useId().replace(/:/g, '')}`;
  const groups = useMemo(() => buildCommandDistricts(controls), [controls]), links = useMemo(() => buildControlLinks(groups), [groups]);
  const selectedGroup = groups.find(group => group.id === selected), category = selectedGroup ? selected : '';
  const commands = useMemo(() => filterDistrictCommands(groups, query, category), [groups, query, category]);
  const count = groups.reduce((total, group) => total + group.controls.length, 0);
  const related = links.filter(link => link.kind === 'related' && [link.from, link.to].includes(category)).map(link => ({ ...link, group: groups.find(group => group.id === (link.from === category ? link.to : link.from)) }));
  function visit(id) {
    setSelected(id);
    window.requestAnimationFrame(() => { detailRef.current?.focus({ preventScroll: true }); detailRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' }); });
  }
  return <section className="office-command-map" aria-labelledby="ocm-title">
    <div className="ocm-heading"><div><p className="ocm-eyebrow"><GitBranch size={14} /> CONNECTED BY PURPOSE</p><h2 id="ocm-title">Control map</h2><p>Explore related tasks, then open the command you need.</p></div><div className="ocm-totals"><strong>{count}<span>commands</span></strong><strong>{groups.length}<span>groups</span></strong></div></div>
    <div className="ocm-toolbar"><div className="ocm-search"><Search size={17} /><input type="search" aria-label="Search control map" value={query} placeholder="Find a command, source, or service…" onChange={event => { setQuery(event.target.value); setSelected(''); }} />{query && <button type="button" aria-label="Clear control search" onClick={() => setQuery('')}><X size={15} /></button>}</div><div className="ocm-view-buttons" aria-label="Command view"><button type="button" aria-pressed={mode === 'map'} onClick={() => setMode('map')}><MapIcon size={15} />Map</button><button type="button" aria-pressed={mode === 'list'} onClick={() => { setMode('list'); setSelected(''); }}><List size={15} />All controls</button></div>{onRefresh && <button type="button" className="ocm-refresh" disabled={loading} onClick={onRefresh} aria-label="Refresh control map"><RefreshCw size={15} /></button>}</div>
    {error && <p role="alert" className="ocm-error">{error}</p>}{loading && <p className="ocm-empty" role="status">Loading Office controls…</p>}{!loading && !count && !error && <p className="ocm-empty">No Office commands are available yet. Refresh to check again.</p>}
    {!!count && <>
      {mode === 'map' && <div className="ocm-map-panel"><div className="ocm-map-caption"><span><GitBranch size={14} />Related tasks connect across the map</span><span className="ocm-pan-hint">Scroll to explore</span></div><ControlGraph groups={groups} links={links} selected={category} query={query} onSelect={visit} count={count} patternId={patternId} /><p className="ocm-map-note">Lines connect related controls. Select a group to see its commands.</p></div>}
      <nav className="ocm-groups" aria-label="Control groups"><button type="button" aria-pressed={!category} onClick={() => setSelected('')}><GitBranch size={14} />All groups <span>{count}</span></button>{groups.map(group => <button type="button" key={group.id} aria-pressed={category === group.id} style={{ '--group-color': group.color }} onClick={() => visit(group.id)}><i aria-hidden="true" />{group.label}<span>{group.controls.length}</span></button>)}</nav>
      <div className="ocm-detail" ref={detailRef} tabIndex={-1}><div className="ocm-detail-heading"><div>{selectedGroup && <button type="button" className="ocm-back" onClick={() => setSelected('')}><ArrowLeft size={13} />All groups</button>}<h3>{query ? 'Search results' : selectedGroup ? selectedGroup.label : 'All commands'}<span>{commands.length}</span></h3><p>{selectedGroup ? selectedGroup.place : query ? `Commands matching “${query}”` : 'Select a command to review its target, inputs, and effects.'}</p></div><span className="ocm-review-note"><ChevronRight size={14} />Select to review</span></div>
        {!!related.length && <div className="ocm-related"><span>Related controls</span>{related.map(link => <button type="button" key={`${link.from}-${link.to}`} onClick={() => visit(link.group.id)}><span>{link.label}</span><strong>{link.group.label}<ArrowUpRight size={12} /></strong></button>)}</div>}
        {selectedGroup && <div className="ocm-branch-label"><GitBranch size={14} /><span>{selectedGroup.label}</span><ChevronRight size={13} /><span>{commands.length} commands to review</span></div>}
        {!commands.length ? <p className="ocm-empty">No commands match this search. Try another name or clear your filters.</p> : <div className={`ocm-command-grid ${selectedGroup ? 'ocm-linked-commands' : ''}`}>{commands.map(({ control, district }) => <CommandCard key={control.id} control={control} district={district} onCommand={onCommand} />)}</div>}
      </div>
    </>}
  </section>;
}
