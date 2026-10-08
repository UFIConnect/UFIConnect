import { useId, useState } from 'react';
import { ExternalLink, Link2 } from 'lucide-react';
import { postLinkPreviews } from './postLinkPreview.mjs';
import './PostLinkPreviews.css';

export default function PostLinkPreviews({ post, text, excludeUrl, maxVisible = 2, variant, collapsible = false }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const links = postLinkPreviews(text ?? [post?.title, post?.content].filter(Boolean).join('\n'), excludeUrl ?? post?.sourceUrl);
  if (!links.length) return null;
  const limit = Number.isFinite(maxVisible) ? Math.max(1, Math.floor(maxVisible)) : 2;
  const visible = expanded ? links : links.slice(0, limit);
  const preview = (
    <section className={`post-link-previews${variant === 'dark' ? ' post-link-previews--dark' : ''}`} aria-label="Links in this post">
      <div className="post-link-previews-heading"><Link2 size={13} aria-hidden="true" />Links in this post</div>
      <ul id={listId} className="post-link-previews-list">
        {visible.map(link => (
          <li key={link.href}>
            <a className="post-link-preview" href={link.href} target="_blank" rel="noopener noreferrer nofollow ugc"
              title={link.href} aria-label={`Open ${link.href} (opens in a new tab)`}
              onClick={event => event.stopPropagation()}>
              <span className="post-link-preview-copy">
                <span className="post-link-preview-domain" dir="ltr">{link.domain}</span>
                <span className="post-link-preview-path" dir="ltr">{link.path === '/' ? 'Homepage' : link.path}</span>
              </span>
              <ExternalLink size={15} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      {links.length > limit && (
        <button type="button" className="post-link-previews-toggle" aria-expanded={expanded} aria-controls={listId}
          onClick={event => { event.stopPropagation(); setExpanded(value => !value); }}>
          {expanded ? 'Show fewer links' : `Show ${links.length - limit} more ${links.length - limit === 1 ? 'link' : 'links'}`}
        </button>
      )}
    </section>
  );
  return collapsible ? (
    <details className="media-lightbox-links">
      <summary>Links in this post ({links.length})</summary>
      {preview}
    </details>
  ) : preview;
}
