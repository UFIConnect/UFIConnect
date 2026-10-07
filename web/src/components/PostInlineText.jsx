import { postBodyWithoutLinks } from './postLinkPreview.mjs';

function hashtags(text, accent) {
  if (!accent) return text;
  return text.split(/(#[\p{L}\p{N}_]+)/u).map((part, index) => index % 2
    ? <span key={index} className="post-chrome-tag" style={{ '--source-color': accent }}>{part}</span> : part);
}

export default function PostInlineText({ text, accent }) {
  return hashtags(postBodyWithoutLinks(text), accent);
}
