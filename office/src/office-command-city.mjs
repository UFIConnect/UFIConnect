const GROUPS = {
  'Individual sources': ['#a78bfa', 'Fetch source content', 0, 0],
  'Public feed': ['#60a5fa', 'Process and deliver posts', 1, 0],
  'Feed audit': ['#5eead4', 'Review content safety', 2, 0],
  'Topic transfer': ['#c4b5fd', 'Classify and correct topics', 3, 0],
  'Travel and restaurants': ['#fda4af', 'Refresh location content', 0, 1],
  Jobs: ['#fde68a', 'Refresh career content', 1, 1],
  'Office agents': ['#fbbf24', 'Manage source workers', 2, 1],
  Automation: ['#f9a8d4', 'Maintain automated work', 3, 1],
  'Frontend changes': ['#93c5fd', 'Review and edit code', 0, 2],
  Deployments: ['#fb923c', 'Build and release changes', 1, 2],
  'Public health': ['#6ee7b7', 'Check service health', 2, 2],
  Runtime: ['#67e8f9', 'Inspect queues and storage', 3, 2],
};

// Navigation relationships, not automatic execution order or dependencies.
const RELATIONSHIPS = [
  ['Individual sources', 'Public feed', 'Content intake'],
  ['Travel and restaurants', 'Public feed', 'Location content'],
  ['Jobs', 'Public feed', 'Career content'],
  ['Office agents', 'Individual sources', 'Source workers'],
  ['Automation', 'Office agents', 'Agent maintenance'],
  ['Public feed', 'Feed audit', 'Feed safety'],
  ['Feed audit', 'Topic transfer', 'Topic quality'],
  ['Public feed', 'Public health', 'Delivery checks'],
  ['Frontend changes', 'Deployments', 'Code releases'],
  ['Deployments', 'Public health', 'Rollout checks'],
  ['Public health', 'Runtime', 'Service diagnosis'],
];

// Derive every group and command from the real catalog, including future groups.
export function buildCommandDistricts(controls = []) {
  const groups = new Map(), seen = new Set();
  for (const control of Array.isArray(controls) ? controls : []) {
    if (!control || typeof control.id !== 'string' || !control.id || typeof control.label !== 'string' || seen.has(control.id)) continue;
    seen.add(control.id);
    const category = typeof control.category === 'string' && control.category.trim() ? control.category : 'Other commands';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(control);
  }
  let extra = 0;
  return [...groups].map(([category, commands], index) => {
    const fallbackIndex = extra, known = Object.hasOwn(GROUPS, category);
    if (!known) extra++;
    const [color, place, column, row] = known ? GROUPS[category] : ['#94a3b8', category, fallbackIndex % 4, 3 + Math.floor(fallbackIndex / 4)];
    return { id: category, label: category, color, place, controls: commands,
      available: commands.filter(control => control.available !== false).length,
      x: 140 + column * 280, y: 160 + row * 200, index };
  });
}

export function buildControlLinks(groups) {
  const ids = new Set(groups.map(group => group.id));
  const links = RELATIONSHIPS.filter(([from, to]) => ids.has(from) && ids.has(to))
    .map(([from, to, label]) => ({ from, to, label, kind: 'related' }));
  if (ids.has('Office agents') && !ids.has('Individual sources') && ids.has('Public feed')) {
    links.push({ from: 'Office agents', to: 'Public feed', label: 'Feed workers', kind: 'related' });
  }
  // A catalog hub connects independent components without inventing task links.
  const visited = new Set();
  for (const group of groups) {
    if (visited.has(group.id)) continue;
    links.push({ from: '@all', to: group.id, label: 'Browse controls', kind: 'catalog' });
    const queue = [group.id];
    while (queue.length) {
      const id = queue.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      for (const link of links) {
        if (link.kind !== 'related') continue;
        if (link.from === id && !visited.has(link.to)) queue.push(link.to);
        if (link.to === id && !visited.has(link.from)) queue.push(link.from);
      }
    }
  }
  return links;
}

export function filterDistrictCommands(groups, query = '', category = '') {
  const words = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  return groups.filter(group => !category || group.id === category).flatMap(district =>
    district.controls.filter(control => {
      const text = `${control.id} ${control.label} ${control.description || ''} ${district.label} ${district.place} ${control.target || ''}`.toLowerCase();
      return words.every(word => text.includes(word));
    }).map(control => ({ control, district })));
}
