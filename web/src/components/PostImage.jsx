import { useEffect, useState } from 'react';

export default function PostImage({ post, style, alt, onUnavailable }) {
  const candidates = [...new Set([post.mediaUrl, post.imageUrl, post.thumbnailUrl, post.mediaPoster].filter(value=>typeof value==='string' && /^https?:\/\//i.test(value)).map(value=>value.replace(/&amp;/g,'&')))];
  const key = candidates.join('|');
  const [index,setIndex] = useState(0);
  useEffect(()=>setIndex(0),[post.id,key]);
  const source = candidates[index];
  if (!source) return <span className="post-media-unavailable">Image unavailable. Open the original post to view its media.</span>;
  return <img src={source} alt={alt || post.title || 'Post image'} loading="lazy" decoding="async" style={style} onError={()=>{setIndex(value=>value+1);if(index+1>=candidates.length)onUnavailable?.();}} />;
}
