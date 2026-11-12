import { Link } from 'react-router-dom';
import { SaveJobButton, SavePostButton } from './SaveButtons';
import PostInlineText from './PostInlineText';
import PostLinkPreviews from './PostLinkPreviews';
import { useAuth } from '../contexts/AuthContext';
import { hasReadJob, jobDetailPath } from '../utils/jobReads';
import { safePostLink } from '../../../backend/post-links.mjs';

export function SavedPostCard({ post, onRemoved }) {
  const sourceLabel = post.sourceLabel || (post.source === 'uficonnect' ? 'UFI' : post.source) || 'Post';
  const hasUfiDetail = post.source !== 'mastodon' && (post.source === 'uficonnect' || post.ufiInteractive);
  const originalUrl = safePostLink(post.sourceUrl);
  return (
    <article className="card profile-saved-post">
      <div className="profile-saved-item-heading">
        <span>{sourceLabel}</span>
        <time>{post.savedAt ? `Saved ${new Date(post.savedAt).toLocaleDateString()}` : 'Saved post'}</time>
      </div>
      {post.title && <h3><PostInlineText text={post.title} /></h3>}
      {post.content && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><PostInlineText text={post.content} /></p>}
      {post.mediaType === 'image' && post.mediaUrl && (
        <img src={post.mediaUrl} alt="" className="profile-saved-post-image" />
      )}
      <PostLinkPreviews post={post} />
      <div className="profile-saved-item-actions">
        {hasUfiDetail && <Link className="btn btn-ghost btn-sm" to={`/p/${encodeURIComponent(post.id)}`}>View post</Link>}
        {originalUrl && <a className="btn btn-ghost btn-sm" href={originalUrl} target="_blank" rel="noopener noreferrer">View original</a>}
        <SavePostButton
          post={post}
          className="btn btn-primary btn-sm save-item-button"
          onChange={(saved) => { if (!saved) onRemoved?.(post.id); }}
        />
      </div>
    </article>
  );
}

export function SavedJobCard({ job }) {
  const { profile } = useAuth();
  return (
    <article className="card profile-saved-job">
      <div className="profile-saved-item-heading">
        <span>{job.status === 'applied' ? 'Applied' : 'Saved job'}</span>
        {hasReadJob(profile?.id, job) && <span className="job-read-tag">Read</span>}
        <span>{job.source || 'Career listing'}</span>
      </div>
      <h3>{job.title || 'Untitled position'}</h3>
      <p className="profile-saved-job-org">{job.org || 'Employer listed by source'}</p>
      {job.jobContent && <p className="profile-saved-job-description">{job.jobContent}</p>}
      <div className="profile-saved-item-actions">
        <Link className="btn btn-ghost btn-sm" to={jobDetailPath(job)} state={{ job: { ...job, read: undefined, description: job.jobContent }, viewerId: profile?.id }}>View details</Link>
        {job.sourceUrl && <a className="btn btn-primary btn-sm" href={job.sourceUrl} target="_blank" rel="noopener noreferrer">View listing</a>}
        <SaveJobButton job={job} className="btn btn-ghost btn-sm save-item-button" />
      </div>
    </article>
  );
}
