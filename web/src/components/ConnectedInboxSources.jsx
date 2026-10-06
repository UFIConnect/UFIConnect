import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { SOURCE_META } from './sourceMeta';

export function inboxSourceName(source) {
  return source === 'ufi' || !source ? 'UFIConnect' : SOURCE_META[source]?.label || source;
}

export function inboxExternalUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export default function ConnectedInboxSources({ sources = [], kind = 'notifications', error = '', onRetry }) {
  return <details className="connected-inbox-sources">
    <summary>Connected sources{sources.length ? ` · ${sources.length}` : ''}{error || sources.some(source => ['reconnect_required', 'unavailable'].includes(source.status)) ? ' · Needs attention' : ''}</summary>
    <div className="connected-inbox-sources-body">
      <p>Supported {kind} appear here. Read status is saved in UFIConnect; your source account keeps its own read status.</p>
      {error && <div role="alert" className="connected-inbox-error">{error}{onRetry && <button className="btn btn-ghost btn-sm" onClick={onRetry}>Retry sources</button>}</div>}
      {!sources.length && !error && <p><Link to="/connected-accounts">Connect an account</Link> to see which inbox features it supports.</p>}
      {sources.map(source => {
        const url = inboxExternalUrl(source.url);
        return <div key={source.source} className="connected-inbox-source">
          <div><strong>{source.name || inboxSourceName(source.source)}</strong><span>{source.message || (source.status === 'ready' ? 'Connected and synced' : source.status === 'reconnect_required' ? 'Reconnect to restore access.' : source.status === 'external' ? `Open this source to view ${kind}.` : 'Temporarily unavailable. Try refreshing.')}</span></div>
          {source.status === 'reconnect_required' ? <Link to="/connected-accounts" className="btn btn-ghost btn-sm">Reconnect</Link> : url ? <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">Open <ExternalLink size={13} aria-hidden="true" /></a> : null}
        </div>;
      })}
    </div>
  </details>;
}
