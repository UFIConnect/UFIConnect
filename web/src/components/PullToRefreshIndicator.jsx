import './PullToRefreshIndicator.css';

export default function PullToRefreshIndicator({ pulling, progress, refreshing, refreshingLabel = 'Refreshing feed' }) {
  if (!pulling && !refreshing) return null;

  const label = refreshing ? refreshingLabel : progress >= 1 ? 'Release to refresh' : 'Pull to refresh';
  return (
    <div className="pull-to-refresh-indicator" role="status" aria-label={label}>
      {refreshing
        ? <span className="spinner spinner-primary" aria-hidden="true" />
        : <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" pathLength="100" strokeDasharray={`${progress * 100} 100`} />
          </svg>}
    </div>
  );
}
