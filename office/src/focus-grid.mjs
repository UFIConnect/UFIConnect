import { EARTH_RADIUS_METERS, measureLocation, validCenter } from './focus-geofence.mjs';

export const GRID_STEPS = { fine: 0.0005, detail: 0.001, block: 0.002, neighborhood: 0.01, district: 0.1, region: 1 };
export const GRID_LABELS = { fine: 'Fine (0.0005°)', detail: 'Detail (0.001°)', block: 'Block (0.002°)',
  neighborhood: 'Neighborhood (0.01°)', district: 'District (0.1°)', region: 'Region (1°)', custom: 'Custom spacing' };
export const GRID_COLORS = { lavender: '#b9b4ff', cyan: '#67e8f9', amber: '#fcd34d', white: '#ffffff' };
export const SAVED_GRID_LIMIT = 40;
export const GRID_HISTORY_LIMIT = 50;
const radians = degrees => degrees * Math.PI / 180;
const round = value => Number(value.toFixed(9));
const stepValid = step => Number.isFinite(step) && step >= 0.0005 && step <= 1;
const choice = (value, choices, fallback) => choices.includes(value) ? value : fallback;

export function gridOptions(input) {
  const enabled = key => input?.[key] !== false;
  return {
    enabled: enabled('enabled'), events: enabled('events'), showLines: enabled('showLines'),
    highlight: enabled('highlight'), showSaved: enabled('showSaved'), showVisitors: enabled('showVisitors'),
    showVisited: input?.showVisited === true, labels: input?.labels === true, visitorAccuracy: input?.visitorAccuracy === true,
    customStep: stepValid(input?.customStep) ? round(input.customStep) : 0.005,
    confirmations: choice(input?.confirmations, [2, 3, 4, 5], 2),
    neighbors: choice(input?.neighbors, [0, 1, 3, 6, 11], 11),
    color: Object.hasOwn(GRID_COLORS, input?.color) ? input.color : 'lavender',
    opacity: choice(input?.opacity, [25, 50, 75, 100], 75),
    weight: choice(input?.weight, [0.65, 1.2, 2], 0.65),
    visitorScope: choice(input?.visitorScope, ['current', 'selected', 'neighbors', 'all'], 'current'),
    visitorKind: choice(input?.visitorKind, ['', 'phone', 'computer', 'equipment', 'bicycle', 'vehicle'], ''),
    visitorCertainty: choice(input?.visitorCertainty, ['', 'reliable', 'uncertain'], ''),
    visitorSort: choice(input?.visitorSort, ['recent', 'name', 'distance'], 'recent'),
  };
}

export function gridStep(settings) {
  return settings.grid === 'custom' ? gridOptions(settings.gridOptions).customStep : GRID_STEPS[settings.grid] ?? GRID_STEPS.neighborhood;
}

export function gridCell(point, step) {
  if (!validCenter(point) || !stepValid(step)) return null;
  const rows = Math.ceil(180 / step), columns = Math.ceil(360 / step);
  const longitude = point.longitude === 180 ? -180 : point.longitude;
  const row = Math.min(rows - 1, Math.floor(Number(((point.latitude + 90) / step).toFixed(8))));
  const column = Math.min(columns - 1, Math.floor(Number(((longitude + 180) / step).toFixed(8))));
  const south = round(row * step - 90), west = round(column * step - 180);
  const latitudeGap = Math.min(point.latitude - south, Math.min(90, south + step) - point.latitude);
  const longitudeGap = Math.min(longitude - west, Math.min(180, west + step) - longitude);
  const margin = EARTH_RADIUS_METERS * Math.min(radians(latitudeGap),
    Math.asin(Math.abs(Math.cos(radians(point.latitude)) * Math.sin(radians(longitudeGap)))));
  return { id: `${row + 1}-${column + 1}`, south, west, step, reliable: margin > point.accuracy };
}

export function gridCellFromId(value, step) {
  if (typeof value !== 'string' || !/^\d{1,7}-\d{1,7}$/.test(value.trim()) || !stepValid(step)) return null;
  const [row, column] = value.trim().split('-').map(Number);
  if (row < 1 || column < 1 || row > Math.ceil(180 / step) || column > Math.ceil(360 / step)) return null;
  return { id: `${row}-${column}`, south: round((row - 1) * step - 90), west: round((column - 1) * step - 180), step };
}

export function gridCellInfo(cell) {
  const north = Math.min(90, round(cell.south + cell.step)), east = Math.min(180, round(cell.west + cell.step));
  const center = { latitude: (cell.south + north) / 2, longitude: (cell.west + east) / 2, accuracy: 0 };
  const height = measureLocation({ ...center, latitude: cell.south }, { ...center, latitude: north }, 0).distance;
  const width = measureLocation({ ...center, longitude: cell.west }, { ...center, longitude: east }, 0).distance;
  return { center, north, east, width, height, radius: Math.max(width, height) };
}

export function gridGeometry(cell, neighbors = 0) {
  const { step } = cell;
  neighbors = choice(neighbors, [0, 1, 2, 3, 6, 11], 0);
  const [rowId, columnId] = cell.id.split('-').map(Number);
  const row = rowId - 1, column = columnId - 1;
  const rows = Math.ceil(180 / step), columns = Math.ceil(360 / step);
  const xs = Array.from({ length: 2 * neighbors + 2 }, (_, index) =>
    round(((column - neighbors + index) % columns + columns) % columns * step - 180));
  const bottom = Math.max(-90, round((row - neighbors) * step - 90));
  const top = Math.min(90, round((row + neighbors + 1) * step - 90));
  const lines = [];
  for (let index = 0; index <= 2 * neighbors + 1; index++) {
    const boundary = row - neighbors + index;
    lines.push([[xs[index], bottom], [xs[index], top]]);
    if (boundary >= 0 && boundary <= rows) {
      const y = Math.min(90, round(boundary * step - 90));
      lines.push(xs.map(x => [x, y]));
    }
  }
  return { type: 'MultiLineString', coordinates: lines };
}

// RFC 7946 winding; reverse the ring for d3's spherical polygon convention.
export function gridPolygon(cell, spherical = false) {
  const { north, east } = gridCellInfo(cell);
  const ring = [[cell.west, cell.south], [east, cell.south], [east, north], [cell.west, north], [cell.west, cell.south]];
  return { type: 'Polygon', coordinates: [spherical ? ring.reverse() : ring] };
}

export function savedGridCells(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  return input.slice(0, SAVED_GRID_LIMIT).flatMap(item => {
    const cell = gridCellFromId(item?.cellId, item?.step);
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 80) : '';
    if (!cell || !name) return [];
    const key = `${cell.step}:${cell.id}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ cellId: cell.id, step: cell.step, name,
      note: typeof item.note === 'string' ? item.note.trim().slice(0, 160) : '' }];
  });
}

export function adjacentGridCell(cell, target) {
  if (!target || cell.step !== target.step) return false;
  const [row, column] = cell.id.split('-').map(Number), [targetRow, targetColumn] = target.id.split('-').map(Number);
  const gap = Math.abs(column - targetColumn), columns = Math.ceil(360 / cell.step);
  return Math.abs(row - targetRow) <= 1 && Math.min(gap, columns - gap) <= 1;
}

export function selectGridVisitors(sources, options, target, search = '', origin = null) {
  const query = search.trim().toLocaleLowerCase();
  return sources.filter(source => (!query || source.name.toLocaleLowerCase().includes(query) || source.cell.id.includes(query)) &&
    (!options.visitorKind || source.kind === options.visitorKind) &&
    (!options.visitorCertainty || source.cell.reliable === (options.visitorCertainty === 'reliable')) &&
    (options.visitorScope === 'all' || !target || (options.visitorScope === 'neighbors'
      ? adjacentGridCell(source.cell, target) : source.cell.id === target.id && source.cell.step === target.step)))
    .map(source => ({ ...source, distance: origin ? measureLocation(origin, source.fix, 0).distance : null }))
    .sort((a, b) => options.visitorSort === 'name' ? a.name.localeCompare(b.name) : options.visitorSort === 'distance' && origin
      ? a.distance - b.distance || a.name.localeCompare(b.name) : b.fix.timestamp - a.fix.timestamp || a.name.localeCompare(b.name));
}

export function filterGridHistory(history, { search = '', minutes = 0, sort = 'recent', now }) {
  const query = search.trim();
  return history.filter(visit => visit.cell.id.includes(query) && (!minutes || visit.lastAt >= now - minutes * 60000))
    .slice().sort((a, b) => sort === 'samples' ? b.samples - a.samples || b.lastAt - a.lastAt : sort === 'time'
      ? (b.observedMs ?? 0) - (a.observedMs ?? 0) || b.lastAt - a.lastAt : b.lastAt - a.lastAt);
}

export function exportGridHistory(history, { format, source, step, now }) {
  const rows = history.map(visit => ({ cell: visit.cell.id, stepDegrees: visit.cell.step,
    firstObserved: new Date(visit.firstAt).toISOString(), lastObserved: new Date(visit.lastAt).toISOString(),
    samples: visit.samples, observedSeconds: Math.floor((visit.observedMs ?? 0) / 1000),
    latitude: visit.fix.latitude, longitude: visit.fix.longitude, accuracyMeters: visit.fix.accuracy }));
  const metadata = { exportedAt: new Date(now).toISOString(), source, stepDegrees: step,
    observation: 'Accepted GPS observations only; gaps are excluded from observed time. This is not continuous presence.' };
  if (format === 'csv') {
    const columns = ['cell', 'stepDegrees', 'firstObserved', 'lastObserved', 'samples', 'observedSeconds', 'latitude', 'longitude', 'accuracyMeters'];
    return { data: [columns.join(','), ...rows.map(row => columns.map(key => row[key]).join(','))].join('\r\n'), mime: 'text/csv' };
  }
  const data = format === 'geojson' ? { type: 'FeatureCollection', metadata,
    features: rows.map((row, index) => ({ type: 'Feature', geometry: gridPolygon(history[index].cell), properties: row })) } : { metadata, cells: rows };
  return { data: JSON.stringify(data, null, 2), mime: format === 'geojson' ? 'application/geo+json' : 'application/json' };
}
