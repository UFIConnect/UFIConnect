import { Link } from 'react-router-dom';
import { SaveJobButton, SavePostButton } from './SaveButtons';

export function SavedPostCard({ post, onRemoved }) {
  const sourceLabel = post.sourceLabel || (post.source === 'uficonnect' ? 'UFI' : post.source) || 'Post';
  const hasUfiDetail = post.source === 'uficonnect' || post.ufiInteractive;
  return (
    <article className="card profile-saved-post">
      <div className="profile-saved-item-heading">
        <span>{sourceLabel}</span>
        <time>{post.savedAt ? `Saved ${new Date(post.savedAt).toLocaleDateString()}` : 'Saved post'}</time>
      </div>
      {post.title && <h3>{post.title}</h3>}
      {post.content && <p>{post.content}</p>}
      {post.mediaType === 'image' && post.mediaUrl && (
        <img src={post.mediaUrl} alt="" className="profile-saved-post-image" />
      )}
      <div className="profile-saved-item-actions">
        {hasUfiDetail && <Link className="btn btn-ghost btn-sm" to={`/p/${encodeURIComponent(post.id)}`}>View post</Link>}
        {post.sourceUrl && <a className="btn btn-ghost btn-sm" href={post.sourceUrl} target="_blank" rel="noopener noreferrer">View original</a>}
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
  return (
    <article className="card profile-saved-job">
      <div className="profile-saved-item-heading">
        <span>{job.status === 'applied' ? 'Applied' : 'Saved job'}</span>
        <span>{job.source || 'Career listing'}</span>
      </div>
      <h3>{job.title || 'Untitled position'}</h3>
      <p className="profile-saved-job-org">{job.org || 'Employer listed by source'}</p>
      {job.jobContent && <p className="profile-saved-job-description">{job.jobContent}</p>}
      <div className="profile-saved-item-actions">
        <Link className="btn btn-ghost btn-sm" to={`/opportunities/${encodeURIComponent(job.id)}`} state={{ job: { ...job, description: job.jobContent } }}>View details</Link>
        {job.sourceUrl && <a className="btn btn-primary btn-sm" href={job.sourceUrl} target="_blank" rel="noopener noreferrer">View listing</a>}
        <SaveJobButton job={job} className="btn btn-ghost btn-sm save-item-button" />
      </div>
    </article>
  );
}
