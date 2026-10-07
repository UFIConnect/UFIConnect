import { Fragment } from 'react';
import { postTextParts } from '../../../backend/post-text.mjs';
import { postLinkDestination } from './postLinkPreview.mjs';

function hashtags(text, accent) {
  if (!accent) return text;
  return text.split(/(#[\p{L}\p{N}_]+)/u).map((part, index) => index % 2
    ? <span key={index} className="post-chrome-tag" style={{ '--source-color': accent }}>{part}</span> : part);
}

export default function PostInlineText({ text, accent }) {
  return postTextParts(text).map(part => part.href
    ? <a key={part.start} href={part.href} target="_blank" rel="noopener noreferrer nofollow ugc"
        title={part.href} aria-label={`Open ${part.href} (opens in a new tab)`} dir="ltr"
        style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '2px', overflowWrap: 'anywhere' }}
        onClick={event => event.stopPropagation()}>{postLinkDestination(part.href)?.label || part.text}</a>
    : <Fragment key={part.start}>{hashtags(part.text, accent)}</Fragment>);
}
