const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
export const count = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
export function reportDays(report, now = Date.now()) {
  const days = (report?.daily || []).map(row => row.day).filter(day => dayPattern.test(day)).sort();
  const end = days.at(-1) || new Date(now).toISOString().slice(0, 10);
  return Array.from({ length: 30 }, (_, index) => new Date(Date.parse(`${end}T00:00:00Z`) - (29 - index) * 86400000).toISOString().slice(0, 10));
}

export function filterAnalytics(report, { platform = 'all', category = 'all', viewType = 'all', start, end } = {}) {
  const categories = (report?.categories || []).filter(row => (platform === 'all' || row.platform === platform)
    && (category === 'all' || row.category === category) && (viewType === 'all' || row.viewType === viewType));
  const daily = new Map(reportDays(report).filter(day => (!start || day >= start) && (!end || day <= end))
    .map(day => [day, { day, views: 0, tabs: 0, errors: 0 }]));
  const rows = categories.map(row => {
    let views = 0, errors = 0;
    for (const day of row.daily || []) {
      if (!daily.has(day.day)) continue;
      const value = daily.get(day.day), viewsForDay = count(day.views), errorsForDay = count(day.errors);
      views += viewsForDay; errors += errorsForDay;
      value[row.viewType === 'tab' ? 'tabs' : 'views'] += viewsForDay;
      value.errors += errorsForDay;
    }
    return { ...row, selectedViews: views, selectedErrors: errors };
  });
  rows.sort((a, b) => b.selectedViews - a.selectedViews || String(a.label).localeCompare(String(b.label)));
  const days = [...daily.values()];
  return { rows, daily: days, views: days.reduce((total, row) => total + row.views, 0), tabs: days.reduce((total, row) => total + row.tabs, 0),
    errors: days.reduce((total, row) => total + row.errors, 0), activeCategories: rows.filter(row => row.selectedViews > 0).length };
}
