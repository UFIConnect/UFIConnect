import { Children, useEffect, useState } from 'react';
import './PagedList.css';

// Keep each page mounted so opening a menu cannot discard a draft or player state.
export default function PagedList({ children, pageSize = 4, label = 'Options', className = '', selectedIndex = 0 }) {
  const items = Children.toArray(children).filter(Boolean);
  const [requested, setPage] = useState(() => Math.max(0, Math.floor(selectedIndex / pageSize)));
  useEffect(() => { setPage(Math.max(0, Math.floor(selectedIndex / pageSize))); }, [selectedIndex, pageSize]);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(requested, pages - 1);
  return <div className={`paged-list ${className}`}>
    <div className="paged-list-items">{items.map((item, index) => <div key={item.key ?? index} hidden={Math.floor(index / pageSize) !== page}>{item}</div>)}</div>
    {pages > 1 && <nav className="paged-list-navigation" aria-label={`${label} pages`}>
      <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={`Previous ${label.toLowerCase()}`}>Previous</button>
      <span role="status" aria-live="polite">{page + 1} / {pages}</span>
      <button type="button" disabled={page === pages - 1} onClick={() => setPage(page + 1)} aria-label={`Next ${label.toLowerCase()}`}>Next</button>
    </nav>}
  </div>;
}
