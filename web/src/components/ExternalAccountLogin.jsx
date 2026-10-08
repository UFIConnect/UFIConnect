import directory from '../../../backend/account-directory.json';

export default function ExternalAccountLogin({ platform, compact = false, className = 'btn btn-outline btn-sm' }) {
  const entry = directory[platform];
  if (!entry?.siteUrl) return null;
  const label = entry.loginUrl ? `Sign in on ${entry.name}` : `Visit ${entry.name}`;
  return <a className={className} href={entry.loginUrl || entry.siteUrl} target="_blank" rel="noopener noreferrer" aria-label={label}
    title={`${label}. This does not link the account to UFIConnect.`}>
    {compact ? entry.loginUrl ? 'Sign in' : 'Visit website' : label}
  </a>;
}
