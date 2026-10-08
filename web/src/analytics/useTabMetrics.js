import { useEffect, useId, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { PAGE_CATEGORIES } from './googleAnalytics.mjs';
import { trackCategoryview } from '../analytics';

// State values select a catalog entry, never an event field. This hook does
// not read labels, form values, searches, account IDs or document titles.
export default function useTabMetrics(group, value, enabled = true) {
  const location = useLocation();
  const previous = useRef(null);
  const instance = useId(), sequence = useRef(0);
  const category = typeof value === 'string' ? `${group}_${value.toLowerCase().replaceAll('-', '_')}` : '';
  useEffect(() => {
    if (!enabled || PAGE_CATEGORIES[category]?.viewType !== 'tab') { previous.current = null; return; }
    const visit = `${location.pathname}:${category}`;
    if (previous.current === visit) return;
    previous.current = visit;
    trackCategoryview(category, `${location.key}:${instance}:${++sequence.current}`, group);
  }, [category, location.pathname, enabled]);
}

export function useSelectedTabMetrics(group, values, enabled = true) {
  const location = useLocation(), instance = useId(), sequence = useRef(0), previous = useRef(null);
  const selection = JSON.stringify((Array.isArray(values) && values.length ? values : ['all'])
    .filter(value => typeof value === 'string').map(value => `${group}_${value.replaceAll('-', '_')}`)
    .filter(category => PAGE_CATEGORIES[category]?.viewType === 'tab').sort());
  useEffect(() => {
    if (!enabled) { previous.current = null; return; }
    const categories = JSON.parse(selection), scope = `${location.pathname}:${group}`;
    const before = previous.current?.scope === scope ? previous.current.categories : [];
    previous.current = { scope, categories };
    for (const category of categories.filter(category => !before.includes(category))) {
      trackCategoryview(category, `${location.key}:${instance}:${++sequence.current}`, group);
    }
  }, [selection, group, location.pathname, enabled]);
}
