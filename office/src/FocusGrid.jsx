import { useEffect, useState } from 'react';
import { clockText, coordinateLabel } from './focus-studio-model.mjs';
import { downloadFocusFile, locationLength, locationSpeed } from './focus-tracking.mjs';
import { directionsLink, gridVisitors, SOURCE_TYPES, VEHICLE_TYPES } from './focus-movement.mjs';
import {
  exportGridHistory, filterGridHistory, GRID_COLORS, GRID_LABELS, GRID_HISTORY_LIMIT, gridCellFromId,
  gridCellInfo, gridStep, SAVED_GRID_LIMIT, selectGridVisitors,
} from './focus-grid.mjs';

const cellKey = cell => `${cell.step}:${cell.id}`;
const savedKey = cell => `${cell.step}:${cell.cellId}`;
const kindLabel = source => source.kind === 'vehicle' ? VEHICLE_TYPES[source.type].label : SOURCE_TYPES[source.kind];

function GridSwitches({ options, onChange, entries }) {
  return <div className="focus-grid-switches">{entries.map(([key, label]) => <label key={key} className="focus-check">
    <input type="checkbox" checked={options[key]} onChange={event => onChange({ [key]: event.target.checked })} />{label}
  </label>)}</div>;
}

export default function FocusGrid({ tools, tracking, devices, units, inspectedCell, onInspect, picking, onPick, onVisit, onMessages }) {
  const { fix, settings, setGrid, state, now, update, updateGridOptions } = tools;
  const { grid, crossings, pendingGrid, pendingSamples, visited, cellVisits } = state.movement;
  const options = settings.gridOptions, step = gridStep(settings);
  const cell = inspectedCell ?? grid;
  const info = cell && gridCellInfo(cell);
  const [customDraft, setCustomDraft] = useState(null);
  const [lookup, setLookup] = useState('');
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyMinutes, setHistoryMinutes] = useState(0);
  const [historySort, setHistorySort] = useState('recent');
  const [historyCount, setHistoryCount] = useState(10);
  const [format, setFormat] = useState('json');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedKey = cell ? cellKey(cell) : '';
  const saved = settings.savedCells.find(item => savedKey(item) === selectedKey);
  useEffect(() => { setName(saved?.name ?? ''); setNote(saved?.note ?? ''); }, [selectedKey, saved?.name, saved?.note]);
  const visitorTarget = options.visitorScope === 'current' ? grid : cell;
  const sources = gridVisitors(devices.viewing ? devices.sources : [], visitorTarget?.step ?? step, now);
  const visitors = selectGridVisitors(sources, options, visitorTarget, search, fix);
  const history = filterGridHistory(cellVisits, { search: historySearch, minutes: historyMinutes, sort: historySort, now });

  function inspect(next) {
    onInspect(next);
    if (next) onVisit({ ...gridCellInfo(next).center, radius: gridCellInfo(next).radius });
    setError('');
  }

  function exportHistory() {
    const file = exportGridHistory(history, { format, source: state.sourceId || 'this-device', step, now });
    downloadFocusFile(file.data, `office-grid-history.${format}`, file.mime);
    setNotice('Filtered grid history exported.');
  }

  return <section className="focus-ops-tool focus-grid-tool" aria-labelledby="focus-grid-heading">
    <h3 id="focus-grid-heading">Grid tracking</h3>
    <p className="focus-footnote">Latitude/longitude cells for live GPS, shared devices and your observed route. Spacing is angular; cell width varies with latitude.</p>
    <label className="focus-check"><input type="checkbox" checked={options.enabled}
      onChange={event => updateGridOptions({ enabled: event.target.checked })} />Enable grid tracking</label>
    <label className="focus-select">Grid spacing
      <select value={settings.grid} onChange={event => { setGrid(event.target.value); setCustomDraft(null); setError(''); onInspect(null); setNotice('Grid spacing changed; observation history reset.'); }}>
        {Object.entries(GRID_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    {settings.grid === 'custom' && <label className="focus-select">Custom grid spacing (degrees)
      <input type="number" min="0.0005" max="1" step="0.0005" value={customDraft ?? options.customStep}
        onChange={event => setCustomDraft(event.target.value)} onBlur={event => {
          const value = event.currentTarget.valueAsNumber;
          if (!Number.isFinite(value) || value < 0.0005 || value > 1) { setError('Choose grid spacing between 0.0005° and 1°.'); return; }
          setCustomDraft(null); setError('');
          if (value !== options.customStep) { setGrid('custom', value); onInspect(null); setNotice('Grid spacing changed; observation history reset.'); }
        }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    </label>}
    <dl className="focus-ops-stats" aria-label="Grid telemetry">
      <div><dt>{fix && options.enabled ? 'Confirmed cell' : 'Last confirmed cell'}</dt><dd>{grid?.id ?? '—'}</dd></div>
      <div><dt>Crossings</dt><dd>{crossings}</dd></div>
      <div><dt>Recent cells visited</dt><dd>{visited.length}{visited.length === 200 && '+'}</dd></div>
      <div><dt>Reliable shared devices · filtered list</dt><dd>{visitors.filter(source => source.cell.reliable).length}</dd></div>
    </dl>
    <p className="focus-feedback" role="status">{!options.enabled ? 'Grid tracking off' : !fix ? 'Waiting for GPS' : pendingGrid ? 'Confirming a crossing' :
      grid ? 'Watching for a crossing' : 'Waiting for a reading clear of the grid boundary'}</p>
    {pendingGrid && <p className="focus-footnote">Cell {pendingGrid}: {pendingSamples} of {options.confirmations} reliable readings.</p>}

    <details className="focus-advanced">
      <summary>Grid display</summary>
      <div className="focus-advanced-body">
        <GridSwitches options={options} onChange={updateGridOptions} entries={[
          ['showLines', 'Show cell grid lines'], ['highlight', 'Highlight current cell'], ['labels', 'Show cell labels'],
          ['showVisited', 'Shade observed cells by sample count'], ['showSaved', 'Show saved cells'],
          ['showVisitors', 'Show shared devices on map'], ['visitorAccuracy', 'Show shared GPS uncertainty circles'],
        ]} />
        <div className="focus-option-grid">
          <label className="focus-select">Grid line color<select value={options.color} onChange={event => updateGridOptions({ color: event.target.value })}>
            {Object.keys(GRID_COLORS).map(key => <option key={key} value={key}>{key[0].toUpperCase() + key.slice(1)}</option>)}
          </select></label>
          <label className="focus-select">Grid line opacity<select value={options.opacity} onChange={event => updateGridOptions({ opacity: Number(event.target.value) })}>
            {[25, 50, 75, 100].map(value => <option key={value} value={value}>{value}%</option>)}
          </select></label>
          <label className="focus-select">Grid line weight<select value={options.weight} onChange={event => updateGridOptions({ weight: Number(event.target.value) })}>
            <option value="0.65">Thin</option><option value="1.2">Medium</option><option value="2">Bold</option>
          </select></label>
          <label className="focus-select">Surrounding grid rings<select value={options.neighbors} onChange={event => updateGridOptions({ neighbors: Number(event.target.value) })}>
            {[0, 1, 3, 6, 11].map(value => <option key={value} value={value}>{value === 0 ? 'Center cell only' : `${value} rings`}</option>)}
          </select></label>
        </div>
        <p className="focus-footnote">Small cells appear as you zoom in. Brighter shading means more accepted samples, not more people. Display switches leave GPS running.</p>
      </div>
    </details>

    <details className="focus-advanced">
      <summary>Crossing controls</summary>
      <div className="focus-advanced-body">
        <label className="focus-select">Reliable readings to confirm a crossing
          <select value={options.confirmations} onChange={event => updateGridOptions({ confirmations: Number(event.target.value) })}>
            {[2, 3, 4, 5].map(value => <option key={value} value={value}>{value} consecutive readings</option>)}
          </select>
        </label>
        <GridSwitches options={options} onChange={updateGridOptions} entries={[['events', 'Log grid crossings and run grid messages']]} />
        <button type="button" className="focus-button" onClick={onMessages}>Configure crossing messages</button>
        <p className="focus-footnote">Each uncertainty circle must fit inside the new cell. An uncertain reading or signal gap resets confirmation. GPS gaps never create crossings or add observed time. Disabling grid events cancels their pending message repeats.</p>
      </div>
    </details>

    <details className="focus-advanced" open>
      <summary>Inspect and save cells</summary>
      <div className="focus-advanced-body">
        <div className="focus-actions">
          <button type="button" className="focus-button" aria-pressed={picking} onClick={() => onPick(!picking)}>{picking ? 'Cancel cell selection' : 'Select cell on map'}</button>
          <button type="button" className="focus-button" disabled={!grid} onClick={() => { onInspect(null); setNotice('Using the current tracking cell.'); }}>Use current tracking cell</button>
        </div>
        {picking && <p className="focus-feedback" role="status">Tap the map, or choose its center, to inspect a cell.</p>}
        <form className="focus-grid-lookup" onSubmit={event => {
          event.preventDefault();
          const found = gridCellFromId(lookup, step);
          if (found) inspect(found); else setError('Enter a valid row-column cell ID for the current spacing.');
        }}>
          <label className="focus-select">Find grid cell by ID<input value={lookup} maxLength={15} placeholder="90001-180001"
            onChange={event => setLookup(event.target.value)} /></label>
          <button type="submit" className="focus-button">Inspect cell ID</button>
        </form>
        {cell ? <>
          <h4>{inspectedCell ? 'Inspected' : 'Current tracking'} cell {cell.id}</h4>
          <dl className="focus-ops-stats" aria-label="Selected cell details">
            <div><dt>Spacing</dt><dd>{cell.step}°</dd></div>
            <div><dt>Approximate size</dt><dd>{locationLength(info.width, units)} × {locationLength(info.height, units)}</dd></div>
            <div><dt>Center</dt><dd>{coordinateLabel(info.center)}</dd></div>
            <div><dt>South / north</dt><dd>{cell.south.toFixed(6)} / {info.north.toFixed(6)}°</dd></div>
            <div><dt>West / east</dt><dd>{cell.west.toFixed(6)} / {info.east.toFixed(6)}°</dd></div>
          </dl>
          <div className="focus-actions">
            <button type="button" className="focus-button" onClick={() => onVisit({ ...info.center, radius: info.radius })}>View cell on map</button>
            <a className="focus-button" href={directionsLink([info.center], settings.mode, tracking.liveFix)} target="_blank" rel="noopener noreferrer">Directions to cell center</a>
          </div>
          <p className="focus-footnote">A cell center is a map reference. Directions send that reference to Google Maps.</p>
          <form className="focus-ops-form" onSubmit={event => {
            event.preventDefault();
            const item = { cellId: cell.id, step: cell.step, name, note };
            update({ savedCells: saved ? settings.savedCells.map(existing => savedKey(existing) === selectedKey ? item : existing) : [...settings.savedCells, item] });
            setNotice('Cell saved on this device.'); setError('');
          }}>
            <label className="focus-select">Saved cell name<input value={name} maxLength={80} required onChange={event => {
              if (!inspectedCell) onInspect(cell);
              setName(event.target.value);
            }} /></label>
            <label className="focus-select">Cell note<textarea value={note} maxLength={160} rows={2} onChange={event => {
              if (!inspectedCell) onInspect(cell);
              setNote(event.target.value);
            }} /></label>
            <button className="focus-button" type="submit" disabled={!name.trim() || !saved && settings.savedCells.length >= SAVED_GRID_LIMIT}>{saved ? 'Update saved cell' : 'Save selected cell'}</button>
          </form>
        </> : <p className="focus-footnote">Select a cell on the map or enter a cell ID. You can inspect cells without starting GPS.</p>}
        <p className="focus-footnote">{settings.savedCells.length} / {SAVED_GRID_LIMIT} saved cells. Names, notes and display settings stay on this device.</p>
        {settings.savedCells.length > 0 && <ul className="focus-grid-visitors" aria-label="Saved grid cells">{settings.savedCells.map(item => <li key={savedKey(item)}>
          <strong>{item.name}</strong><span className="focus-footnote">Cell {item.cellId} · {item.step}°{item.note && ` · ${item.note}`}</span>
          <div className="focus-actions">
            <button type="button" className="focus-button" aria-label={`Inspect saved cell ${item.name}`} onClick={() => inspect(gridCellFromId(item.cellId, item.step))}>Inspect</button>
            <button type="button" className="focus-button" aria-label={`Delete saved cell ${item.name}`} onClick={() => {
              update({ savedCells: settings.savedCells.filter(existing => savedKey(existing) !== savedKey(item)) });
              setNotice('Saved cell removed.');
            }}>Delete</button>
          </div>
        </li>)}</ul>}
      </div>
    </details>

    <details className="focus-advanced" open>
      <summary>Grid visitors · shared devices</summary>
      <div className="focus-advanced-body">
        <p className="focus-footnote">Only devices explicitly sharing GPS with this Office are listed. A device name is a publisher-supplied label; the person's identity is unverified. Office cannot detect other people nearby.</p>
        {!devices.viewing && <button className="focus-button" type="button" disabled={!devices.available} onClick={devices.startViewing}>Load shared grid visitors</button>}
        <div className="focus-option-grid">
          <label className="focus-select">Visitor list scope<select value={options.visitorScope} onChange={event => updateGridOptions({ visitorScope: event.target.value })}>
            <option value="current">Current tracking cell</option><option value="selected">Inspected cell</option>
            <option value="neighbors">Inspected cell and neighbors</option><option value="all">All shared cells</option>
          </select></label>
          <label className="focus-select">Visitor device type<select value={options.visitorKind} onChange={event => updateGridOptions({ visitorKind: event.target.value })}>
            <option value="">All types</option>{Object.entries(SOURCE_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label className="focus-select">Visitor certainty<select value={options.visitorCertainty} onChange={event => updateGridOptions({ visitorCertainty: event.target.value })}>
            <option value="">All fresh observations</option><option value="reliable">Reliable cell membership</option><option value="uncertain">Uncertain near boundary</option>
          </select></label>
          <label className="focus-select">Sort visitors<select value={options.visitorSort} onChange={event => updateGridOptions({ visitorSort: event.target.value })}>
            <option value="recent">Most recent GPS</option><option value="name">Device name</option><option value="distance">Distance from tracking source</option>
          </select></label>
        </div>
        <label className="focus-select">Find shared device or cell<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
        {!visitorTarget && options.visitorScope !== 'all' && <p className="focus-footnote">No reference cell yet; showing all shared cells until one is selected.</p>}
        {options.visitorSort === 'distance' && !fix && <p className="focus-footnote">Distance sorting needs fresh GPS from the tracking source; showing most recent first.</p>}
        {devices.viewError && <p role="status" className="focus-footnote">Visitor data is incomplete while the Office connection is unavailable.</p>}
        {devices.viewing && !visitors.length && <p className="focus-footnote">No fresh shared GPS observations match these filters. This does not establish that the area is empty.</p>}
        <ul className="focus-grid-visitors" aria-label="Shared grid visitors">{visitors.map(source => <li key={source.id}>
          <h4>{source.name}</h4>
          <p className="focus-footnote">{kindLabel(source)} · Identity unverified · {source.cell.reliable ? 'GPS uncertainty fits within cell' : 'Near boundary — cell membership uncertain'}</p>
          {source.signalNotice && <p className="focus-footnote">{source.signalNotice}</p>}
          <dl className="focus-ops-stats">
            <div><dt>Sharing session</dt><dd>{source.id}</dd></div>
            {Number.isFinite(source.firstSharedAt) && <div><dt>Sharing started</dt><dd>{new Date(source.firstSharedAt).toLocaleString()}</dd></div>}
            <div><dt>Grid cell</dt><dd>{source.cell.id}</dd></div>
            <div><dt>Coordinates</dt><dd>{coordinateLabel(source.fix)}</dd></div>
            <div><dt>Accuracy</dt><dd>±{Math.ceil(source.fix.accuracy)} m</dd></div>
            <div><dt>GPS observed</dt><dd>{new Date(source.fix.timestamp).toLocaleString()} · {source.ageSeconds} s ago</dd></div>
            <div><dt>Speed · device-reported</dt><dd>{source.fix.speed == null ? 'Unavailable' : locationSpeed(source.fix.speed, units)}</dd></div>
            {source.distance !== null && <div><dt>Approximate straight-line distance</dt><dd>{locationLength(source.distance, units)}</dd></div>}
          </dl>
          <p className="focus-footnote">Source: GPS shared through the Office API. Readings expire after 25 seconds.</p>
          <div className="focus-actions">
            <button type="button" className="focus-button" onClick={() => onVisit(source.fix)}>View location on map</button>
            <button type="button" className="focus-button" onClick={() => tools.selectSource(source.id)}>Follow shared device</button>
            <a className="focus-button" href={directionsLink([source.fix], settings.mode, tracking.liveFix)} target="_blank" rel="noopener noreferrer">Directions to shared location</a>
          </div>
        </li>)}</ul>
      </div>
    </details>

    <details className="focus-advanced">
      <summary>Observed cell history · selected source</summary>
      <div className="focus-advanced-body">
        <p className="focus-footnote">Up to {GRID_HISTORY_LIMIT} cells from this session. First and last times are accepted observations. Observed time sums intervals between reliable readings in the same cell, excluding uncertain readings and GPS gaps. Changing source or spacing resets history.</p>
        <div className="focus-option-grid">
          <label className="focus-select">Find observed cell<input type="search" value={historySearch} onChange={event => { setHistorySearch(event.target.value); setHistoryCount(10); }} /></label>
          <label className="focus-select">History time window<select value={historyMinutes} onChange={event => { setHistoryMinutes(Number(event.target.value)); setHistoryCount(10); }}>
            <option value="0">Whole session</option><option value="5">Last 5 minutes</option><option value="15">Last 15 minutes</option><option value="60">Last hour</option>
          </select></label>
          <label className="focus-select">Sort cell history<select value={historySort} onChange={event => setHistorySort(event.target.value)}>
            <option value="recent">Last observed</option><option value="samples">Most reliable readings</option><option value="time">Most observed time</option>
          </select></label>
        </div>
        {history.length ? <ul className="focus-grid-visitors" aria-label="Observed grid cells">{history.slice(0, historyCount).map(visit => <li key={visit.cell.id}>
          <strong>Cell {visit.cell.id}</strong>
          <p className="focus-footnote">First observed {new Date(visit.firstAt).toLocaleString()} · Last observed {new Date(visit.lastAt).toLocaleString()} · {visit.samples} reliable readings · {clockText((visit.observedMs ?? 0) / 1000)} observed time · Last accuracy ±{Math.ceil(visit.fix.accuracy)} m</p>
          <div className="focus-actions">
            <button type="button" className="focus-button" onClick={() => onVisit(visit.fix)}>View recorded point</button>
            <button type="button" className="focus-button" aria-label={`Inspect observed cell ${visit.cell.id}`} onClick={() => inspect(visit.cell)}>Inspect cell</button>
          </div>
        </li>)}</ul> : <p className="focus-footnote">No reliable cell observations match this view.</p>}
        {historyCount < history.length && <button type="button" className="focus-button" onClick={() => setHistoryCount(count => count + 10)}>Show more observed cells</button>}
        <div className="focus-option-grid">
          <label className="focus-select">Grid export format<select value={format} onChange={event => setFormat(event.target.value)}>
            <option value="json">JSON</option><option value="csv">CSV</option><option value="geojson">GeoJSON cell boundaries</option>
          </select></label>
          <button type="button" className="focus-button" disabled={!history.length} onClick={exportHistory}>Export filtered grid history</button>
        </div>
        <p className="focus-footnote">Exports contain exact recorded coordinates. Only the selected source and matching history are included.</p>
        <button type="button" className="focus-button" disabled={!cellVisits.length && !crossings} onClick={() => {
          tools.dispatch({ type: 'grid' }); setNotice('Grid history and crossing count cleared. GPS continues running.');
        }}>Clear grid history and crossings</button>
      </div>
    </details>
    {error && <p className="focus-error" role="alert">{error}</p>}
    {notice && <p className="focus-feedback" role="status">{notice}</p>}
  </section>;
}
