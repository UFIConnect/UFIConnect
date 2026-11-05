// Keep the catalog's order within each group, including any curated order.
export function connectedFirstSourceIds(sources, connected = {}) {
  return [...sources].sort((a, b) => Number(connected[b] === true) - Number(connected[a] === true));
}

export function connectedFirstAccountEntries(entries, connected = {}) {
  return [...entries].sort(([a], [b]) => Number(connected[b] === true) - Number(connected[a] === true));
}
