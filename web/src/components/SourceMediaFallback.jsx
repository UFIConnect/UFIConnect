import { useState } from 'react';
import { SOURCE_META } from './sourceMeta';
import './PostDetails.css';
export default function SourceMediaFallback({ post }) {
  const [failed,setFailed] = useState(false);
  if (!/^https?:\/\//i.test(post?.sourceUrl || '')) return null;
  return <a className="post-media-fallback" href={post.sourceUrl} target="_blank" rel="noopener noreferrer">
    {post.mediaPoster && !failed && <img src={post.mediaPoster} loading="lazy" decoding="async" alt="Video preview" onError={()=>setFailed(true)} />}
    <strong>Watch on {SOURCE_META[post.source]?.label || post.sourceLabel || 'the original source'} ↗</strong>
    <span>This provider’s video opens in its own player.</span>
  </a>;
}
