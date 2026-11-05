import { useRef, useState } from 'react';
import { AlignLeft, List, ListOrdered, ImagePlus, Copy, Download, X, Check, Eye, FileText } from 'lucide-react';
import PhotoPickerButton from './PhotoPickerButton';
import './PublishingComposer.css';

export function WritingArea({ value, onChange, label = 'Post draft', placeholder, disabled = false, maxLength = 4000, rows = 8, templates = [] }) {
  const input = useRef(null);
  function format(kind) {
    const element = input.current;
    const start = element.selectionStart === 0 ? 0 : value.lastIndexOf('\n', element.selectionStart - 1) + 1;
    const nextBreak = value.indexOf('\n', element.selectionEnd);
    const end = nextBreak < 0 ? value.length : nextBreak;
    const selected = value.slice(start, end);
    const result = kind === 'spacing' ? selected.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n')
      : selected.split('\n').map((line, index) => `${kind === 'bullets' ? '•' : `${index + 1}.`} ${line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')}`).join('\n');
    const next = value.slice(0, start) + result + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start, start + result.length); });
  }
  function insertTemplate(event) {
    const template = templates.find(item => item.label === event.target.value);
    if (template) onChange(value.trim() ? `${value.trim()}\n\n${template.text}` : template.text);
    event.target.value = '';
    input.current?.focus();
  }
  const count = value.length;
  return <div className="publish-writing">
    <div className="publish-writing-heading"><label htmlFor={label.replace(/\W/g, '-')}><FileText size={17} />{label}</label><span>{value.trim() ? value.trim().split(/\s+/).length : 0} words</span></div>
    <div className="publish-toolbar" role="toolbar" aria-label={`${label} writing tools`}>
      <button type="button" title="Bullet list" aria-label={`Add bullets to ${label}`} disabled={disabled} onClick={() => format('bullets')}><List size={18} /></button>
      <button type="button" title="Numbered list" aria-label={`Number ${label}`} disabled={disabled} onClick={() => format('numbers')}><ListOrdered size={18} /></button>
      <button type="button" title="Clean up spacing" aria-label={`Clean up ${label} spacing`} disabled={disabled} onClick={() => format('spacing')}><AlignLeft size={18} /></button>
      {templates.length > 0 && <select aria-label={`${label} template`} defaultValue="" disabled={disabled} onChange={insertTemplate}><option value="">Add a template…</option>{templates.map(item => <option key={item.label}>{item.label}</option>)}</select>}
    </div>
    <textarea ref={input} id={label.replace(/\W/g, '-')} aria-label={label} value={value} onChange={event => onChange(event.target.value)} rows={rows} placeholder={placeholder} disabled={disabled} />
    <div className={`publish-writing-footer ${count > maxLength ? 'publish-over-limit' : ''}`}><span>Plain text · ready for your destinations</span><span aria-live="polite">{count.toLocaleString()} / {maxLength.toLocaleString()}</span></div>
  </div>;
}

export function PhotoAttachment({ media, onFile, onRemove, busy = false, disabled = false, progress = 0, error = '', allowVideo = false }) {
  const [dragging, setDragging] = useState(false);
  return <section className={`publish-photo ${dragging ? 'publish-photo-dragging' : ''}`} aria-label="Post photo"
    onDragOver={event => { event.preventDefault(); if (!disabled && !busy) setDragging(true); }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
    onDrop={event => { event.preventDefault(); setDragging(false); if (!disabled && !busy && event.dataTransfer.files[0]) onFile(event.dataTransfer.files[0]); }}>
    <div className="publish-photo-heading"><span><ImagePlus size={18} />{media?.type === 'video' ? 'Attached video' : 'Post photo'}</span>{media && <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || busy} onClick={onRemove}><X size={15} />Remove {media.type === 'video' ? 'video' : 'photo'}</button>}</div>
    {media ? <div className="publish-photo-selected">{media.type === 'video' ? <video src={media.url} controls playsInline preload="metadata" /> : <img src={media.url} alt="Selected for cross-posting" />}{media.name && <p>{media.name}</p>}<span><Check size={14} />{busy ? 'Replacing attachment…' : 'Ready to publish'}</span></div>
      : <div className="publish-photo-empty"><ImagePlus size={32} /><strong>Give your post a visual</strong><p>{allowVideo ? 'Drop a photo or video here, or choose a file.' : 'Drop a photo here, choose a file, or use your camera.'}</p><small>{allowVideo ? 'One photo up to 10 MB or video up to 64 MB. YouTube requires a video.' : 'One photo · JPG, PNG or WebP · up to 10 MB'}</small></div>}
    <PhotoPickerButton onFileSelected={onFile} accept={allowVideo ? 'image/*,video/*' : 'image/*'} disabled={disabled || busy} label={busy ? 'Uploading attachment…' : media ? 'Replace attachment' : allowVideo ? 'Add photo or video' : 'Add photo'} ariaLabel={media ? 'Replace attachment' : allowVideo ? 'Add a photo or video' : 'Add a photo'} className="btn btn-outline btn-sm" />
    {busy && <div className="publish-upload-progress" role="status"><progress max="100" value={Math.round(progress * 100)} /><span>Uploading {Math.round(progress * 100)}%</span></div>}
    {error && <p className="publish-over-limit" role="alert">{error}</p>}
  </section>;
}

export function PostPreview({ content, media, name = 'You', subtitle = 'Post preview', destinations = [], onCopy, onDownload }) {
  const [expanded, setExpanded] = useState(false);
  return <aside className="publish-preview" aria-label="Live post preview">
    <div className="publish-preview-heading"><h3><Eye size={18} />Live preview</h3><span>Updates as you write</span></div>
    <article className="publish-preview-post"><header><span className="publish-preview-avatar">{name.charAt(0).toUpperCase()}</span><div><strong>{name}</strong><small>{subtitle}</small></div></header>
      <p className={content ? 'publish-preview-text' : 'publish-preview-placeholder'}>{content ? expanded || content.length <= 600 ? content : content.slice(0, 600) + '…' : 'Your writing and photo will appear here.'}</p>
      {content.length > 600 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExpanded(old => !old)}>{expanded ? 'Show less' : 'Read complete preview'}</button>}
      {media && (media.type === 'video' ? <video src={media.url} controls playsInline preload="metadata" /> : <img src={media.url} alt="Post photo preview" />)}
    </article>
    <div className="publish-preview-destinations"><strong>Selected destinations</strong><p>{destinations.length ? destinations.join(' · ') : 'Choose where to publish this post.'}</p></div>
    <div className="publish-preview-actions">{onCopy && <button type="button" className="btn btn-outline btn-sm" disabled={!content} onClick={onCopy}><Copy size={15} />Copy text</button>}{onDownload && <button type="button" className="btn btn-ghost btn-sm" disabled={!content} onClick={() => onDownload(content)}><Download size={15} />Download text</button>}</div>
  </aside>;
}

export function downloadPostText(content, filename = 'uficonnect-draft.txt') {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const POST_TEMPLATES = [
  { label: 'Update', text: 'A quick update\n\nWhat happened:\n\nWhat comes next:' },
  { label: 'Event', text: 'You’re invited\n\nWhen:\nWhere:\nWhat to expect:\n\nHow to join:' },
  { label: 'Question', text: 'I’d like your perspective on…\n\nHere’s the context:\n\nWhat would you recommend?' },
];
