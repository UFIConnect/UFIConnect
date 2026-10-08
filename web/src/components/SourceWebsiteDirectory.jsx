import { useMemo, useState } from 'react';
import ACCOUNT_DIRECTORY from '../../../backend/account-directory.json';
import { SOURCE_WEBSITE_IDS } from './sourceMeta';
import { ACCOUNT_CATEGORIES, accountCategory } from './sourceDirectory';
import ExternalAccountLogin from './ExternalAccountLogin';
import { DirectoryControls } from './DirectoryControls';

export default function SourceWebsiteDirectory({ plan }) {
  const [category, setCategory] = useState(plan === 'business' ? 'career' : 'publishing');
  const entries = useMemo(() => SOURCE_WEBSITE_IDS.map(key => [key, ACCOUNT_DIRECTORY[key]])
    .filter(([, entry]) => plan !== 'business' || entry.category === 'career'), [plan]);
  const categories = ACCOUNT_CATEGORIES.filter(([id]) => entries.some(([key, entry]) => accountCategory(key, entry) === id));
  const selected = categories.some(([id]) => id === category) ? category : categories[0]?.[0];
  const visible = entries.filter(([key, entry]) => accountCategory(key, entry) === selected)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));
  if (!entries.length) return null;
  return <section className="feed-source-websites" aria-label="Source websites" style={{ gridColumn: '1 / -1', minWidth: 0, borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
    <h4 style={{ margin: '0 0 6px' }}>Source websites</h4>
    <p style={{ color: 'var(--muted)', fontSize: '.78rem', margin: '0 0 8px' }}>Read or listen on these sources.</p>
    <DirectoryControls label="source websites" filter={selected} onFilterChange={setCategory} options={categories} />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {visible.map(([key]) => <ExternalAccountLogin key={key} platform={key} />)}
    </div>
  </section>;
}
