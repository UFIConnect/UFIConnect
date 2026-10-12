import './ResultsPagination.css';

export default function ResultsPagination({ page = 1, hasNext = false, loading = false, onPageChange, totalPages, ariaLabel = 'Results pages' }) {
  const current = Number.isSafeInteger(page) && page > 0 ? page : 1;
  const total = Number.isSafeInteger(totalPages) && totalPages >= current ? totalPages : null;
  const previousDisabled = loading || current === 1;
  const nextDisabled = loading || !hasNext || (total !== null && current >= total);
  const changePage = next => {
    if (loading || next < 1 || (total !== null && next > total)) return;
    onPageChange?.(next);
  };
  return <nav className="results-pagination" aria-label={ariaLabel} aria-busy={loading}>
    <button type="button" className="results-pagination-button" disabled={previousDisabled} onClick={() => changePage(current - 1)}>
      <span aria-hidden="true">←</span><span>Previous</span>
    </button>
    <span className="results-pagination-status" role="status" aria-live="polite" aria-atomic="true">
      <span aria-current="page">Page {current}{total !== null ? ` of ${total}` : ''}</span>
      {loading && <span className="results-pagination-loading">Loading…</span>}
    </span>
    <button type="button" className="results-pagination-button" disabled={nextDisabled} onClick={() => changePage(current + 1)}>
      <span>Next</span><span aria-hidden="true">→</span>
    </button>
  </nav>;
}
