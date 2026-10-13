import ResultsPagination from './ResultsPagination';
import { POST_PAGE_SIZE } from '../hooks/usePostPages';
import useInfiniteScroll from '../hooks/useInfiniteScroll';

export default function PostPagesNavigation({ results, targetId, continuous = false, label = 'Post pages' }) {
  const sentinel = useInfiniteScroll({ enabled: continuous && results.hasNext && !results.loading && !results.error,
    onLoadMore: () => results.goToPage(results.page + 1), revision: results.page });
  function scrollToResults() {
    document.getElementById(targetId)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
  async function changePage(page) {
    if (await results.goToPage(page)) scrollToResults();
  }
  async function retry() {
    if (await results.retry() && !continuous) scrollToResults();
  }
  return <>
    {results.error && <div className="card profile-saved-state" role="alert">
      {results.error}<button type="button" className="btn btn-ghost" disabled={results.loading} onClick={retry}>Try again</button>
    </div>}
    {continuous && <>
      <div ref={sentinel} data-feed-scroll-sentinel aria-hidden="true" style={{ height: 1 }} />
      {results.loading && results.items.length > 0 && <p role="status">Loading more posts…</p>}
    </>}
    {!continuous && (results.items.length > 0 || results.page > 1) && <ResultsPagination
      page={results.page} hasNext={results.hasNext} loading={results.loading}
      onPageChange={changePage} ariaLabel={label}
      totalPages={results.total === null ? undefined : Math.max(1, Math.ceil(results.total / POST_PAGE_SIZE))}
    />}
  </>;
}
