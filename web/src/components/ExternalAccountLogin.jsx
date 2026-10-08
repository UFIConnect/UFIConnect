import directory from '../../../backend/account-directory.json';
import AccountActionIcon from './AccountActionIcon';
import { ExternalLink } from 'lucide-react';

export default function ExternalAccountLogin({ platform, compact = false, className = 'btn btn-outline btn-sm' }) {
  const entry = directory[platform];
  if (!entry?.siteUrl) return null;
  const label = `Visit ${entry.name} website`;
  return <a className={`${className} account-icon-action`} style={{ position: 'relative' }} href={entry.siteUrl} target="_blank" rel="noopener noreferrer" aria-label={label}
    title={label}>
    <AccountActionIcon platform={platform} />
    <span aria-hidden="true" style={{ position: 'absolute', right: 3, bottom: 3, display: 'flex', padding: 1, borderRadius: 3, background: 'var(--card)' }}><ExternalLink size={11} /></span>
  </a>;
}
