import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ReportModal from './ReportModal';

export default function ReportPostButton({ post, className = 'post-chrome-action', showLabel = false }) {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  if (!post?.id) return null;
  return <>
    <button type="button" className={className} aria-label="Report post" title="Report post" onClick={event => { event.preventDefault(); event.stopPropagation(); setOpen(true); }}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 21V4m0 0c5-4 9 4 14 0v10c-5 4-9-4-14 0" /></svg>{showLabel && <span>Report</span>}
    </button>
    {open && <ReportModal targetType="post" targetId={String(post.id)} targetLabel="post" source={post.source} sourceUrl={post.sourceUrl || undefined} signInRequired={!token} onClose={() => setOpen(false)} />}
  </>;
}
