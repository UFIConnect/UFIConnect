const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
export const count = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
export function reportDays(report, now = Date.now()) {
  const days = (report?.daily || []).map(row => row.day).filter(day => dayPattern.test(day)).sort();
  const validDay = value => dayPattern.test(value || '') && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  const end = validDay(report?.range?.to) ? report.range.to : days.at(-1) || new Date(now).toISOString().slice(0, 10);
  const from = validDay(report?.range?.from) ? report.range.from : days[0] || new Date(Date.parse(`${end}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  if (from > end) return [];
  const length = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  return Array.from({ length }, (_, index) => new Date(Date.parse(`${from}T00:00:00Z`) + index * 86400000).toISOString().slice(0, 10));
}

export function filterAnalytics(report, { platform = 'all', category = 'all', viewType = 'all', start, end } = {}) {
  const categories = (report?.categories || []).filter(row => (platform === 'all' || row.platform === platform)
    && (category === 'all' || row.category === category) && (viewType === 'all' || row.viewType === viewType));
  const firstRecordedDay = report?.history?.firstRecordedDay;
  const daily = new Map(reportDays(report).filter(day => (!start || day >= start) && (!end || day <= end))
    .map(day => {
      const available = !report?.history || Boolean(firstRecordedDay && day >= firstRecordedDay);
      return [day, { day, available, views: available ? 0 : null, tabs: available ? 0 : null, errors: available ? 0 : null }];
    }));
  const rows = categories.map(row => {
    let views = 0, errors = 0;
    for (const day of row.daily || []) {
      if (!daily.has(day.day)) continue;
      const value = daily.get(day.day), viewsForDay = count(day.views), errorsForDay = count(day.errors);
      if (!value.available) continue;
      views += viewsForDay; errors += errorsForDay;
      value[row.viewType === 'tab' ? 'tabs' : 'views'] += viewsForDay;
      value.errors += errorsForDay;
    }
    return { ...row, selectedViews: views, selectedErrors: errors };
  });
  rows.sort((a, b) => b.selectedViews - a.selectedViews || String(a.label).localeCompare(String(b.label)));
  const days = [...daily.values()];
  return { rows, daily: days, availableDays: days.filter(row => row.available).length, unavailableDays: days.filter(row => !row.available).length,
    views: days.reduce((total, row) => total + row.views, 0), tabs: days.reduce((total, row) => total + row.tabs, 0),
    errors: days.reduce((total, row) => total + row.errors, 0), activeCategories: rows.filter(row => row.selectedViews > 0).length };
}

function selectedRows(report, rows, { platform = 'all', category = 'all', viewType = 'all', start, end } = {}) {
  const categories = new Map((report?.categories || []).map(row => [row.category, row]));
  return rows.filter(row => {
    const meta = categories.get(row.category);
    return meta && (!start || row.day >= start) && (!end || row.day <= end)
      && (platform === 'all' || meta.platform === platform) && (category === 'all' || row.category === category)
      && (viewType === 'all' || meta.viewType === viewType);
  });
}

export function filterDiagnostics(report, filters = {}) {
  if (!Array.isArray(report?.performance?.details)) return null;
  const categories = new Map((report?.categories || []).map(row => [row.category, row]));
  return selectedRows(report, report.performance.details, filters)
    .filter(row => count(row.count) > 0)
    .map(row => ({ ...row, count: count(row.count), label: categories.get(row.category).label }))
    .sort((a, b) => b.day.localeCompare(a.day) || b.count - a.count || a.label.localeCompare(b.label));
}
