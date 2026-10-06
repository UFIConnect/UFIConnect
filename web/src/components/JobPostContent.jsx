import { useMemo } from 'react';
import { summarizeJob } from '../utils/jobSummary.mjs';
import './PostDetails.css';

export default function JobPostContent({ post, compact = false }) {
  const job = useMemo(()=>summarizeJob(post),[post?.fullDescription,post?.description,post?.content]);
  return <section className="job-post-content" aria-label="Job description">
    <p className="job-post-intro">{job.intro || 'This source has not supplied the job description. Open the original listing for details.'}</p>
    {job.details.length > 0 && <div className="job-post-duties"><h3>{job.hasTasks ? 'Main responsibilities' : 'Listing details'}</h3><ul>{job.details.map((task,index)=><li key={index}>{task}</li>)}</ul></div>}
    {!compact && job.fullText && <details className="job-post-full"><summary>Read the full supplied listing</summary><div>{job.fullText}</div>{post.sourceUrl && <a href={post.sourceUrl} target="_blank" rel="noopener noreferrer">Open the original job listing ↗</a>}</details>}
    <div className="job-post-summary"><h3>Role task summary</h3><p>{job.summary || 'Specific tasks were not supplied in the available description. Check the original listing for the complete duties.'}</p></div>
  </section>;
}
