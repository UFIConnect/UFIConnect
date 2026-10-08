import directory from '../../../backend/account-directory.json';

export default function ExternalAccountLogin({ platform, compact = false, className = 'btn btn-outline btn-sm' }) {
  const entry = directory[platform];
  if (!entry?.siteUrl) return null;
  const label = `Visit ${entry.name} website`;
  return <a className={className} href={entry.siteUrl} target="_blank" rel="noopener noreferrer" aria-label={label}
    title={label}>
    {compact ? 'Visit website' : label}
  </a>;
}
