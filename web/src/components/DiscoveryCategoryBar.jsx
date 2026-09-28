import { DISCOVERY_CATEGORIES, discoveryChoice } from './discoveryCategories';
import './DiscoveryCategoryBar.css';

export default function DiscoveryCategoryBar({ mode, filters, onChange, actions }) {
  const category = DISCOVERY_CATEGORIES[mode];
  if (!category) return null;
  const selected = discoveryChoice(mode, filters)?.[0];
  return (
    <div className="discovery-toolbar">
      <div className="discovery-category-bar" role="group" aria-label={category.filterLabel}>
      <button type="button"
        className="feed-toolbar-control feed-topic-filter-trigger discovery-category-clear ufi-clear-control"
        aria-label={`Clear ${category.filterLabel.toLowerCase()}`}
        disabled={!selected}
        onClick={() => onChange({ ...filters, discovery: { ...filters.discovery, [mode]: '' } })}>
        Clear
      </button>
      {category.choices.map(([key, label]) => (
        <button key={key} type="button"
          className={`feed-toolbar-control feed-topic-filter-trigger${selected === key ? ' active' : ''}`}
          aria-pressed={selected === key}
          onClick={() => onChange({ ...filters, discovery: { ...filters.discovery, [mode]: selected === key ? '' : key } })}>
          {label}
        </button>
      ))}
      </div>
      {actions && <div className="discovery-toolbar-actions">{actions}</div>}
    </div>
  );
}
