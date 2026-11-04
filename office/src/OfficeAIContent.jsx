import { Fragment, useState } from 'react';

export function safeOfficeLink(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}

function inline(text) {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/), url = link && safeOfficeLink(link[2]);
    return url ? <a key={index} href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{link[1]}</a> : <Fragment key={index}>{part}</Fragment>;
  });
}

function Code({ language, value }) {
  const [copied, setCopied] = useState(false), [failed, setFailed] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(value); setCopied(true); setFailed(false); } catch { setFailed(true); } }
  return <div className="office-ai-code"><div><span>{language || 'Code'}</span><button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy code'}</button></div><pre><code>{value}</code></pre>{failed && <small role="status">Copy is unavailable. Select the code to copy it.</small>}</div>;
}

// Render a deliberately small Markdown subset as React nodes. HTML and embedded
// images remain text; model output never becomes executable markup.
export default function OfficeAIContent({ text = '' }) {
  const blocks = String(text).split(/(```[^\n]*\n[\s\S]*?(?:```|$))/g);
  return <div className="office-ai-markdown">{blocks.map((block, index) => {
    if (block.startsWith('```')) { const end = block.indexOf('\n'); return <Code key={index} language={block.slice(3, end).trim().slice(0, 40)} value={block.slice(end + 1).replace(/```$/, '').replace(/\n$/, '')} />; }
    const lines = block.split('\n'), nodes = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], heading = line.match(/^(#{1,4})\s+(.+)$/), bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/);
      if (!line.trim()) { nodes.push(<br key={i} />); continue; }
      if (heading) nodes.push(<strong className="office-ai-markdown-heading" key={i}>{inline(heading[2])}</strong>);
      else if (bullet) nodes.push(<div className="office-ai-markdown-bullet" key={i}><span aria-hidden="true">•</span><span>{inline(bullet[1])}</span></div>);
      else nodes.push(<div key={i}>{inline(line)}</div>);
    }
    return <Fragment key={index}>{nodes}</Fragment>;
  })}</div>;
}
