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

export function AccountSiteLink({ platform, name }) {
  const href = ACCOUNT_SITE_URLS[platform];
  if (!href) return null;
  const label = `Open ${name || platform} website`;
  return <a className="btn btn-ghost btn-sm account-site-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
    <ExternalLink size={16} aria-hidden="true" />
  </a>;
}
