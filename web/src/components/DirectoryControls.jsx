import { ExternalLink } from 'lucide-react';
import { ACCOUNT_SITE_URLS } from './sourceDirectory';
import './source-directory.css';

export function DirectoryControls({ label, filter, onFilterChange, options }) {
  return <div className="source-directory-controls">
    <select className="form-select" aria-label={`Filter ${label}`} value={filter} onChange={e => onFilterChange(e.target.value)}>
      {options.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
    </select>
  </div>;
}

export function AccountCategoryNavigation({ sections, category, onChange, compact = false }) {
  if (!sections.length) return null;
  const options = sections;
  const active = options.some(option => option.id === category) ? category : options[0].id;
  return <fieldset className={`account-category-filter${compact ? ' account-category-filter--compact' : ''}`} aria-label="Account categories">
    <legend>Categories</legend>
    {compact ? <select className="form-select" aria-label="Account category" value={active} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.id} value={option.id}>{option.label} ({option.total})</option>)}
    </select> : <ul>{options.map(option => <li key={option.id}>
      <button type="button" aria-pressed={active === option.id} onClick={() => onChange(option.id)}>{option.label} <span>{option.total}</span></button>
    </li>)}</ul>}
  </fieldset>;
}

export function AccountSiteLink({ platform, name, siteUrl, className = '', label }) {
  let href = ACCOUNT_SITE_URLS[platform] || siteUrl;
  if (platform === 'mastodon' && siteUrl) {
    try { const url = new URL(siteUrl); if (url.protocol === 'https:' && !url.username && !url.password) href = url.origin; } catch { /* Keep the official server directory fallback. */ }
  }
  if (!href) return null;
  try { const url = new URL(href); if (url.protocol !== 'https:' || url.username || url.password) return null; href = url.href; } catch { return null; }
  const accessibleLabel = label || `Open ${name || platform} website`;
  return <a className={`btn btn-ghost btn-sm account-site-link ${className}`} href={href} target="_blank" rel="noopener noreferrer" aria-label={accessibleLabel} title={accessibleLabel}>
    <ExternalLink size={16} aria-hidden="true" />
  </a>;
}
