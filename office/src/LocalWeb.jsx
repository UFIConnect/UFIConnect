import { useEffect, useRef, useState } from 'react';
import './local-web.css';

const LOCAL_CONSOLE = 'http://127.0.0.1:4174/#local-web';
const LOCAL_PREVIEW = 'http://127.0.0.1:4173';
const isLocalConsole = import.meta.env.MODE === 'release-local'
  && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname);

async function payloadOf(response) {
  let payload;
  try { payload = await response.json(); } catch { throw new Error('The service returned an unreadable response.'); }
  if (!response.ok) throw new Error(payload.error || payload.msg || `Request failed (${response.status}).`);
  return payload;
}

async function localFile(path) {
  return payloadOf(await fetch(`/__local-web/file?path=${encodeURIComponent(path)}`, { cache: 'no-store' }));
}

function assertSameFile(current, saved) {
  if (current.path !== saved.path || current.revision !== saved.revision || current.content !== saved.content) {
    throw new Error('This file changed on disk. Reload the file and review it again before publishing.');
  }
}

function LocalPreview({ size, version }) {
  const container = useRef(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  useEffect(() => {
    const element = container.current;
    const observer = new ResizeObserver(entries => setAvailableWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = size === 'mobile' ? 390 : 1280;
  const height = 900;
  const scale = availableWidth ? Math.min(1, availableWidth / width) : 1;
  return <div ref={container} className={`local-web-preview local-web-preview-${size}`} style={{ height: height * scale }}>
    <iframe key={version} src={LOCAL_PREVIEW} title="Local UFIConnect website preview"
      style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
  </div>;
}

function LocalEditor({ apiBase, request }) {
  const [files, setFiles] = useState([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState('connecting');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState('');
  const [review, setReview] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [previewSize, setPreviewSize] = useState('desktop');
  const [previewVersion, setPreviewVersion] = useState(0);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const dirty = Boolean(saved && draft !== saved.content);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setBusy('connecting');
    setError('');
    Promise.all([
      fetch('/__local-web/status', { cache: 'no-store', signal: controller.signal }).then(payloadOf),
      fetch('/__local-web/files', { cache: 'no-store', signal: controller.signal }).then(payloadOf),
    ]).then(([status, directory]) => {
      if (!active) return;
      if (status.previewUrl !== LOCAL_PREVIEW || !Array.isArray(directory.files)) {
        throw new Error('Restart the local release console to connect its website editor.');
      }
      setFiles(directory.files);
      setReady(true);
    }).catch(failure => {
      if (active) setError(failure.message);
    }).finally(() => { if (active) setBusy(''); });
    return () => { active = false; controller.abort(); };
  }, [connectionAttempt]);

  useEffect(() => {
    const beforeUnload = event => {
      if (!dirty && !busy) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const beforeNavigate = event => {
      if (busy) {
        event.preventDefault();
        setNotice('Wait for the current file operation to finish before leaving this tab.');
      } else if (dirty && !window.confirm('Discard unsaved changes to this local file?')) {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('office-before-navigate', beforeNavigate);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('office-before-navigate', beforeNavigate);
    };
  }, [dirty, busy]);

  const clearReview = () => { setReview(null); setReviewed(false); setCommitMessage(''); };

  const loadFile = async path => {
    if (!path || busy || (dirty && !window.confirm('Discard unsaved changes and load this file?'))) return;
    setBusy('loading');
    setError('');
    setNotice('');
    clearReview();
    try {
      const file = await localFile(path);
      setSaved(file);
      setDraft(file.content);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  };

  const saveFile = async () => {
    if (!saved || !dirty || busy) return;
    setBusy('saving');
    setError('');
    setNotice('');
    clearReview();
    try {
      const file = await payloadOf(await fetch(`/__local-web/file?path=${encodeURIComponent(saved.path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Local-Web-Editor': '1' },
        body: JSON.stringify({ path: saved.path, content: draft, expectedRevision: saved.revision }),
      }));
      setSaved(file);
      setDraft(file.content);
      setNotice('Saved on this computer. The local preview updates automatically.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  };

  const prepareReview = async () => {
    if (!saved || dirty || busy) return;
    setBusy('reviewing');
    setError('');
    setNotice('');
    clearReview();
    try {
      assertSameFile(await localFile(saved.path), saved);
      const baseline = await payloadOf(await request(`${apiBase}/office/frontend-file?target=web&path=${encodeURIComponent(saved.path)}`));
      if (baseline.path !== saved.path || typeof baseline.content !== 'string' || !/^[a-f0-9]{40}$/i.test(baseline.sha || '')) {
        throw new Error('The public file could not be loaded for review. Try again.');
      }
      if (baseline.content === saved.content) {
        setNotice('This saved file already matches the public release source. There is nothing to publish.');
        return;
      }
      setReview({ ...saved, baseline: baseline.content, expectedSha: baseline.sha });
    } catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  };

  const publishFile = async () => {
    if (!review || !reviewed || dirty || busy || commitMessage.trim().length < 6) return;
    setBusy('publishing');
    setError('');
    setNotice('');
    try {
      assertSameFile(await localFile(review.path), review);
      const payload = await payloadOf(await request(`${apiBase}/office/controls/commit.web-frontend/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmed: true,
          filePath: review.path,
          expectedSha: review.expectedSha,
          content: review.content,
          commitMessage: commitMessage.trim(),
          contextId: 'local-web:publish',
          contextLabel: 'Publish reviewed local website file',
        }),
      }));
      const commit = payload.result?.commitSha;
      setNotice(`Published ${review.path} to the release source${commit ? ` (${commit.slice(0, 7)})` : ''}. Verification must pass before Render updates the public website. Other local files were not published.`);
      clearReview();
    } catch (failure) {
      setError(`${failure.message} Prepare a fresh public review before retrying.`);
      clearReview();
    } finally { setBusy(''); }
  };

  return <>
    <p className="local-web-subtitle">Edit website files on this computer, try them in the preview, then review a saved file before updating the public website. Account actions in the preview use the live service.</p>
    <div className="local-web-actions">
      <a className="local-web-button" href={LOCAL_PREVIEW} target="_blank" rel="noreferrer">Open local website</a>
      <span className="local-web-hint">Local saves update the preview immediately. Publishing is a separate step.</span>
    </div>
    {error && <p className="local-web-error" role="alert">{error}</p>}
    {notice && <p className="local-web-notice" role="status">{notice}</p>}
    {!ready && <div className="local-web-panel"><p>{busy === 'connecting' ? 'Connecting to your local files…' : 'The local file editor is unavailable. Start the console with npm run office:release-local.'}</p>
      {!busy && <button type="button" onClick={() => setConnectionAttempt(value => value + 1)}>Retry connection</button>}
    </div>}
    {ready && <>
      <div className="local-web-workspace">
        <section className="local-web-panel" aria-labelledby="local-web-editor-heading">
          <div className="local-web-section-heading"><h2 id="local-web-editor-heading">Local files</h2><span>{dirty ? 'Unsaved changes' : saved ? 'Saved locally' : `${files.length} files`}</span></div>
          <label className="local-web-label" htmlFor="local-web-file">Website file</label>
          <select id="local-web-file" value={saved?.path || ''} disabled={Boolean(busy)} onChange={event => loadFile(event.target.value)}>
            <option value="" disabled>Choose a file to edit</option>
            {files.map(file => <option key={file.path} value={file.path}>{file.path}</option>)}
          </select>
          {saved ? <>
            <label className="local-web-label" htmlFor="local-web-content">{saved.path}</label>
            <textarea id="local-web-content" className="local-web-code" spellCheck={false} autoCapitalize="off" autoCorrect="off" value={draft} disabled={Boolean(busy)} onChange={event => { setDraft(event.target.value); clearReview(); setNotice(''); }} />
            <div className="local-web-actions">
              <button type="button" className="local-web-primary" onClick={saveFile} disabled={!dirty || Boolean(busy)}>{busy === 'saving' ? 'Saving…' : 'Save locally'}</button>
              <button type="button" disabled={!dirty || Boolean(busy)} onClick={() => { setDraft(saved.content); clearReview(); setNotice('Unsaved edits reset to the last loaded or saved version.'); }}>Reset unsaved</button>
              <button type="button" disabled={Boolean(busy)} onClick={() => loadFile(saved.path)}>Reload file</button>
            </div>
            <p className="local-web-hint">Reload to pick up edits made in another editor. A changed file must be reloaded before it can be overwritten.</p>
          </> : <p className="local-web-empty">Choose an existing website source, stylesheet, or public text file. Your edits stay local until you publish.</p>}
        </section>
        <section className="local-web-panel" aria-labelledby="local-web-preview-heading">
          <div className="local-web-section-heading"><h2 id="local-web-preview-heading">Local preview</h2><button type="button" onClick={() => setPreviewVersion(value => value + 1)}>Refresh</button></div>
          <div className="local-web-actions" role="group" aria-label="Preview size">
            <button type="button" aria-pressed={previewSize === 'desktop'} onClick={() => setPreviewSize('desktop')}>Desktop</button>
            <button type="button" aria-pressed={previewSize === 'mobile'} onClick={() => setPreviewSize('mobile')}>Mobile</button>
          </div>
          <LocalPreview size={previewSize} version={previewVersion} />
        </section>
      </div>
      <section className="local-web-panel local-web-publish" aria-labelledby="local-web-publish-heading">
        <div className="local-web-section-heading"><h2 id="local-web-publish-heading">Update the public website</h2><span>One reviewed file at a time</span></div>
        <p>Publish only the selected saved file. Other local edits stay on this computer. Successful verification starts the public deployment.</p>
        <button type="button" onClick={prepareReview} disabled={!saved || dirty || Boolean(busy)}>{busy === 'reviewing' ? 'Loading public review…' : 'Review for public update'}</button>
        {dirty && <p className="local-web-hint">Save your edits locally before preparing the public review.</p>}
        {review && <div className="local-web-review">
          <h3>Review {review.path}</h3>
          <p className="local-web-hint">Compare your saved file with the latest release source below. Publishing replaces this entire file. If it changes on the server after this review, publication is rejected.</p>
          <div className="local-web-comparison">
            <label>Current public release source<textarea aria-label="Current public release source" className="local-web-code" value={review.baseline} readOnly spellCheck={false} /></label>
            <label>Saved local file to publish<textarea aria-label="Saved local file to publish" className="local-web-code" value={review.content} readOnly spellCheck={false} /></label>
          </div>
          <label className="local-web-label" htmlFor="local-web-commit-message">Describe this public update</label>
          <input id="local-web-commit-message" value={commitMessage} disabled={Boolean(busy)} maxLength={120} placeholder="Describe what changes for visitors" onChange={event => setCommitMessage(event.target.value)} />
          <label className="local-web-confirm"><input type="checkbox" checked={reviewed} disabled={Boolean(busy)} onChange={event => setReviewed(event.target.checked)} />I reviewed both versions and want to publish this file to the public website.</label>
          <button type="button" className="local-web-primary" onClick={publishFile} disabled={!reviewed || commitMessage.trim().length < 6 || Boolean(busy)}>{busy === 'publishing' ? 'Publishing…' : 'Publish this file'}</button>
        </div>}
      </section>
    </>}
  </>;
}

export default function LocalWeb({ apiBase = '', request }) {
  return <div className="local-web">
    <h1>Local web</h1>
    {isLocalConsole ? <LocalEditor apiBase={apiBase} request={request} /> : <>
      <p className="local-web-subtitle">Open your local website workspace to edit files, preview your changes, and review them before updating the public website.</p>
      <section className="local-web-panel">
        <h2>Make changes on your computer</h2>
        <p>Start the local console from your UFIConnect repository:</p>
        <pre className="local-web-command">npm run office:release-local</pre>
        <a className="local-web-button local-web-primary" href={LOCAL_CONSOLE} target="_blank" rel="noreferrer">Open local web workspace</a>
        <p className="local-web-hint">The console opens on this computer at 127.0.0.1:4174. Sign in with your Office access token to publish a reviewed file. Local saves affect the preview; successful verification publishes approved changes.</p>
      </section>
    </>}
  </div>;
}
