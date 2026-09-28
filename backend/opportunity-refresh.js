'use strict';

// Preserve the selected sort and source balance inside each cohort.
function reorderOpportunitiesForRefresh(results, shownIds, refreshKey) {
  if (!refreshKey) return { results, mode: null };
  const unseen = results.filter(item => !shownIds.has(item.id));
  if (!unseen.length) return { results, mode: 'unchanged' };
  return { results: [...unseen, ...results.filter(item => shownIds.has(item.id))], mode: 'unseen' };
}

module.exports = { reorderOpportunitiesForRefresh };
