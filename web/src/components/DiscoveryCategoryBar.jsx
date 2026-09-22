import { DISCOVERY_CATEGORIES, discoveryChoice } from './discoveryCategories';
import './DiscoveryCategoryBar.css';

export default function DiscoveryCategoryBar({ mode, filters, onChange }) {
  const category = DISCOVERY_CATEGORIES[mode];
  if (!category) return null;
  const selected = discoveryChoice(mode, filters)?.[0];
  return (
    <div className="discovery-category-bar" role="group" aria-label={category.filterLabel}>
      {category.choices.map(([key, label]) => (
        <button key={key} type="button"
          className={`feed-toolbar-control feed-topic-filter-trigger${selected === key ? ' active' : ''}`}
          aria-pressed={selected === key}
          onClick={() => onChange({ ...filters, discovery: { ...filters.discovery, [mode]: selected === key ? '' : key } })}>
          {label}
        </button>
      ))}
    </div>
  );
}
