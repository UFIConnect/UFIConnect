import { collectionTiming } from './sourceCollection.mjs';

export default function SourceCollectionDetails({ source }) {
  const timing = collectionTiming(source);
  if (!timing.pullLimit) return null;
  return (
    <div className="source-collection-details" style={{ fontSize: '.72rem', color: 'var(--muted, #64748B)', lineHeight: 1.5 }}>
      <div>App pull limit: <strong>{timing.pullLimit}</strong></div>
      {timing.minimumSpacing && <div>Minimum spacing: {timing.minimumSpacing}</div>}
      {timing.scheduledInterval && <div>Scheduled interval: {timing.scheduledInterval}</div>}
    </div>
  );
}
