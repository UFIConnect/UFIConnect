import { useRef, useState } from 'react';
import { Download, FileCode2 } from 'lucide-react';
const previewPolicy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: https:; connect-src \'none\'; form-action \'none\'; base-uri \'none\'">';

export default function OfficeAIArtifacts({ task, apiBase, request }) {
  const [file, setFile] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [preview, setPreview] = useState(false);
  const sequence = useRef(0);
  async function open(item) {
    const current = ++sequence.current; setBusy(true); setError(''); setPreview(false);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await request(`${apiBase}/office/ai/workspace/${encodeURIComponent(task.id)}/file?path=${encodeURIComponent(item.path)}`, { signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(typeof data.error === 'string' ? data.error : 'This file could not be read from memory.');
      const loaded = data.file || data;
      if (loaded.path !== item.path || typeof loaded.content !== 'string') throw Error('The saved file receipt did not match the requested file.');
      if (current === sequence.current) setFile(loaded);
    } catch (cause) { if (current === sequence.current) setError(cause.name === 'AbortError' ? 'Reading the saved file timed out. Retry to read its current version.' : cause.message); }
    finally { clearTimeout(timeout); if (current === sequence.current) setBusy(false); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = file.path.split('/').at(-1); document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="office-ai-task-results" aria-label="Files saved in memory"><h3><FileCode2 size={16} /> Files saved in memory</h3><p className="office-ai-form-note">These drafts are stored on uficonnect.ai and linked to this task. Public publication uses a separate release.</p><div className="office-ai-result-actions">{task.artifacts.map(item => <button type="button" key={item.path} disabled={busy} onClick={() => open(item)}>Open {item.path}</button>)}</div>{error && <p className="office-ai-error" role="alert">{error}</p>}{file && <div><h4>{file.path}</h4><small>Revision {file.revision} · Memory {file.memoryId}</small><pre className="office-ai-conversation-output">{file.content}</pre><button type="button" onClick={download}><Download size={14} />Download file</button>{/\.html?$/i.test(file.path) && <button type="button" onClick={() => setPreview(value => !value)}>{preview ? 'Close HTML preview' : 'Preview HTML draft'}</button>}{preview && <iframe title="Private HTML draft preview" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={previewPolicy + file.content} style={{ width: '100%', minHeight: 360, border: '1px solid #334155', borderRadius: 8, marginTop: 12, background: '#fff' }} />}</div>}</section>;
}
