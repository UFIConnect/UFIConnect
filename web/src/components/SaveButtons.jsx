import { useState } from 'react';
import { useSavedItems } from '../contexts/SavedItemsContext';
import { useToast } from '../contexts/ToastContext';

function BookmarkIcon({ filled = false, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21l-6-4-6 4V4.5Z" />
    </svg>
  );
}

export function SavePostButton({ post, className = 'btn btn-ghost btn-sm', style, showLabel = true, onChange, menuItem = false }) {
  const { isPostSaved, postBusyIds, togglePost } = useSavedItems();
  const { showToast } = useToast();
  const [error, setError] = useState(false);
  const id = String(post?.id || '');
  const saved = isPostSaved(id);
  const busy = postBusyIds.has(id);

  async function handleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!id || busy) return;
    setError(false);
    try {
      const nextSaved = await togglePost(post);
      onChange?.(nextSaved);
      showToast(nextSaved ? 'Post saved' : 'Post removed from saved', 'success');
    } catch {
      setError(true);
      showToast('Could not update this saved post. Please try again.', 'error');
    }
  }

  return (
    <button
      type="button"
      role={menuItem ? 'menuitem' : undefined}
      className={`${className}${saved ? ' saved' : ''}${error ? ' error' : ''}`}
      style={style}
      onClick={handleClick}
      disabled={!id || busy}
      aria-pressed={saved}
      aria-label={saved ? 'Remove saved post' : 'Save post'}
      title={error ? 'Could not update this saved post. Try again.' : saved ? 'Remove from saved' : 'Save post'}
    >
      {busy ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <BookmarkIcon filled={saved} />}
      {showLabel && <span>{saved ? 'Saved' : 'Save'}</span>}
    </button>
  );
}

export function SaveJobButton({ job, className = 'btn btn-ghost btn-sm', style, showLabel = true, onChange }) {
  const { getJob, jobBusyIds, saveJob, removeJob } = useSavedItems();
  const { showToast } = useToast();
  const [error, setError] = useState(false);
  const id = String(job?.id || '');
  const tracked = getJob(id);
  const saved = tracked?.status === 'saved' || tracked?.status === 'applied';
  const busy = jobBusyIds.has(id);
  const applied = tracked?.status === 'applied';

  async function handleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!id || busy || applied) return;
    setError(false);
    try {
      if (saved) await removeJob(id);
      else await saveJob(job, 'saved');
      onChange?.(!saved);
      showToast(saved ? 'Job removed from saved' : 'Job saved', 'success');
    } catch {
      setError(true);
      showToast('Could not update this saved job. Please try again.', 'error');
    }
  }

  const label = applied ? 'Applied' : saved ? 'Saved' : 'Save';
  return (
    <button
      type="button"
      className={`${className}${saved ? ' saved' : ''}${error ? ' error' : ''}`}
      style={style}
      onClick={handleClick}
      disabled={!id || busy || applied}
      aria-pressed={saved}
      aria-label={applied ? 'This job is marked applied' : saved ? 'Remove saved job' : 'Save job'}
      title={error ? 'Could not update this saved job. Try again.' : applied ? 'This job is in your applied list' : saved ? 'Remove from saved jobs' : 'Save job'}
    >
      {busy ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <BookmarkIcon filled={saved} />}
      {showLabel && <span>{label}</span>}
    </button>
  );
}
