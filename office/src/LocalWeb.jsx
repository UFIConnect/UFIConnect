import { useEffect, useMemo, useRef, useState } from 'react';
import { lineChanges } from './line-changes.mjs';
import './local-web.css';

const LOCAL_CONSOLE = 'http://127.0.0.1:4174/#local-web';
const LOCAL_PREVIEW = 'http://127.0.0.1:4173';
const isLocalConsole = import.meta.env.MODE === 'release-local';
const STEPS = [['edit', 'Edit'], ['preview', 'Preview'], ['publish', 'Publish']];
// Maps is the website's 3D source map, served only by the local website.
const PREVIEW_PAGES = [['/', 'Home'], ['/maps', 'Maps']];
const MAX_CHANGE_ROWS = 400;
const phoneUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname.endsWith('.trycloudflare.com') && !url.username && !url.password ? url.origin : ''; }
  catch { return ''; }
};
// Phones often drop "https://", add capitals, or paste surrounding text. Keep only a
// trycloudflare.com host, so the link can never lead to another site or scheme.
const TUNNEL_HOST = /(?:^|[^a-z0-9.-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+trycloudflare\.com)(?![a-z0-9.-]*[a-z0-9])/;
function readPhoneLink(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return { url: '', problem: '' };
  const host = text.replace(/^[a-z][a-z0-9+.-]*:\/\/[^@/\s]*@/, '').match(TUNNEL_HOST)?.[1];
  if (host) return { url: `https://${host}`, problem: '' };
  if (/(?:^|[/@\s])(?:127\.0\.0\.1|localhost|0\.0\.0\.0)(?:[:/\s]|$)/.test(text)) {
    return { url: '', problem: 'That is your computer’s own address, which a phone cannot open. On your computer, choose Start phone connection and use the link it shows, ending in .trycloudflare.com.' };
  }
  return { url: '', problem: 'This is not a phone connection link. On your computer, choose Start phone connection and copy or scan the link it shows. It ends in .trycloudflare.com.' };
}

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

function LocalPreview({ size, version, page, base = LOCAL_PREVIEW }) {
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
    <iframe key={version} src={`${base}${page === '/' ? '' : page}`} title="Local UFIConnect website preview"
      style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
  </div>;
}

// Dark modules on a white square: phone cameras do not reliably read inverted codes.
function PhoneQr({ link }) {
  const [modules, setModules] = useState(null);
  useEffect(() => {
    let active = true;
    setModules(null);
    import('uqr').then(({ encode }) => { if (active) setModules(encode(link, { ecc: 'M', border: 2 }).data); }).catch(() => {});
    return () => { active = false; };
  }, [link]);
  if (!modules) return null;
  const size = modules.length;
  const path = modules.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ''))).join('');
  return <svg className="local-web-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code for the phone workspace link" shapeRendering="crispEdges">
    <rect width={size} height={size} fill="#fff" /><path d={path} fill="#000" />
  </svg>;
}

function PhonePanel({ phone, busy, onConnect }) {
  const [copied, setCopied] = useState(false);
  const linkInput = useRef(null);
  const link = phone.url ? `${phone.url}/#local-web` : '';
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); }
    catch { linkInput.current?.select(); }
  };
  return <section className="local-web-panel local-web-phone" aria-labelledby="local-web-phone-heading">
    <h2 id="local-web-phone-heading">Use your phone</h2>
    {phone.state === 'ready' && link ? <div className="local-web-phone-ready">
      <PhoneQr link={link} />
      <div>
        <p>Scan with your phone camera, then enter this code:</p>
        <p className="local-web-pair-code">{phone.code?.match(/.{1,4}/g)?.join(' ')}</p>
        <label className="local-web-label">Phone workspace link<input ref={linkInput} aria-label="Phone workspace link" readOnly value={link} /></label>
        <div className="local-web-actions">
          <button type="button" onClick={copyLink}>{copied ? 'Link copied' : 'Copy link'}</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => onConnect('stop')}>Stop phone connection</button>
        </div>
      </div>
    </div> : <>
      <p>Edit and preview from your phone while this computer keeps running.</p>
      {phone.error && <p className="local-web-hint">{phone.error}</p>}
      <button type="button" disabled={Boolean(busy)} onClick={() => onConnect('start')}>{busy === 'phone' ? 'Connecting phone…' : 'Start phone connection'}</button>
    </>}
  </section>;
}

function Changes({ before, after }) {
  const { hunks, added, removed, endings } = useMemo(() => lineChanges(before, after), [before, after]);
  let remaining = MAX_CHANGE_ROWS;
  const shown = [];
  for (const hunk of hunks) {
    if (remaining <= 0) break;
    shown.push({ ...hunk, rows: hunk.rows.slice(0, remaining) });
    remaining -= hunk.rows.length;
  }
  const plural = count => `${count} ${count === 1 ? 'line' : 'lines'}`;
  return <section className="local-web-changes" aria-label="Changes to publish">
    <p className="local-web-changes-summary">{plural(added)} added, {plural(removed)} removed</p>
    {endings && <p className="local-web-hint">Line endings also change throughout this file, to {endings === 'CRLF' ? 'Windows (CRLF)' : 'LF'}.</p>}
    {shown.map((hunk, index) => <div className="local-web-hunk" key={index}>
      <p className="local-web-hunk-line">Line {hunk.line}</p>
      <pre className="local-web-hunk-code">{hunk.rows.map((row, rowIndex) => {
        const text = row.text || ' ';
        if (row.kind === 'removed') return <del key={rowIndex}>{text}</del>;
        if (row.kind === 'added') return <ins key={rowIndex}>{text}</ins>;
        return <span key={rowIndex}>{text}</span>;
      })}</pre>
    </div>)}
    {(remaining < 0 || shown.length < hunks.length) && <p className="local-web-hint">Some changes are not listed here. Open the full files below to review everything.</p>}
  </section>;
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
  const [previewPage, setPreviewPage] = useState('/');
  // The GitHub preview is a separate copy of the repository; it never touches the files edited here.
  const [previewSource, setPreviewSource] = useState('local');
  const [github, setGithub] = useState({ state: 'unavailable' });
  const [branch, setBranch] = useState('main');
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [phone, setPhone] = useState({ state: 'off' });
  const [previewUrl, setPreviewUrl] = useState(LOCAL_PREVIEW);
  // Phones show one step at a time; wider screens show every section together.
  const [step, setStep] = useState('edit');
  const dirty = Boolean(saved && draft !== saved.content);
  const stepClass = id => (step === id ? '' : ' local-web-step-hidden');

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
      if (!(status.previewUrl === LOCAL_PREVIEW || (status.phone?.remote && phoneUrl(status.previewUrl))) || !Array.isArray(directory.files)) {
        throw new Error('Restart the local release console to connect its website editor.');
      }
      setFiles(directory.files);
      setPhone(status.phone || { state: 'off' });
      setGithub(status.github || { state: 'unavailable' });
      setPreviewUrl(status.previewUrl);
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

  useEffect(() => {
    if (github.state !== 'updating') return undefined;
    const timer = setInterval(() => {
      fetch('/__local-web/github', { cache: 'no-store' }).then(payloadOf).then(setGithub).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [github.state]);
  const getLatestFromGithub = async () => {
    setPreviewSource('github');
    try {
      setGithub(await payloadOf(await fetch('/__local-web/github', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Web-Editor': '1' }, body: JSON.stringify({ branch: branch.trim() || 'main' }),
      })));
    } catch (failure) { setGithub(current => ({ ...current, state: 'error', error: failure.message })); }
  };
  const githubReady = github.state === 'ready' || (github.state === 'updating' && github.sha);
  const previewBase = previewSource === 'github' ? github.previewUrl : previewUrl;
  const clearReview = () => { setReview(null); setReviewed(false); setCommitMessage(''); };
  const connectPhone = async action => {
    setBusy('phone'); setError('');
    try {
      setPhone(await payloadOf(await fetch('/__local-web/phone', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Local-Web-Editor': '1' }, body: JSON.stringify({ action }),
      })));
    } catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  };

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
      setNotice(phone.remote ? 'Saved on this computer. Refresh the phone preview to see it.' : 'Saved on this computer. The preview updates automatically.');
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
      setNotice(`Published ${review.path}${commit ? ` (${commit.slice(0, 7)})` : ''}. The public website updates after verification passes. Other local files were not published.`);
      clearReview();
    } catch (failure) {
      setError(`${failure.message} Prepare a fresh public review before retrying.`);
      clearReview();
    } finally { setBusy(''); }
  };

  return <>
    <p className="local-web-subtitle">{phone.remote
      ? 'You are editing website files on your computer from this phone.'
      : 'Edit website files on this computer, check the preview, then publish one reviewed file.'}</p>
    {error && <p className="local-web-error" role="alert">{error}</p>}
    {notice && <p className="local-web-notice" role="status">{notice}</p>}
    {ready && !phone.remote && <PhonePanel phone={phone} busy={busy} onConnect={connectPhone} />}
    {!ready && <div className="local-web-panel"><p>{busy === 'connecting' ? 'Connecting to your local files…' : 'The local file editor is unavailable. Start the console with npm run office:release-local.'}</p>
      {!busy && <button type="button" onClick={() => setConnectionAttempt(value => value + 1)}>Retry connection</button>}
    </div>}
    {ready && <>
      <div className="local-web-steps" role="group" aria-label="Local web steps">
        {STEPS.map(([id, label], index) => <button key={id} type="button" aria-pressed={step === id} onClick={() => setStep(id)}>
          <span aria-hidden="true">{index + 1}</span>{label}
        </button>)}
      </div>
      <div className="local-web-workspace">
        <section className={`local-web-panel${stepClass('edit')}`} aria-labelledby="local-web-editor-heading">
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
            <p className="local-web-hint">Reload picks up edits made in another editor.</p>
          </> : <p className="local-web-empty">Choose a file to start. Edits stay on this computer until you publish.</p>}
        </section>
        <section className={`local-web-panel${stepClass('preview')}`} aria-labelledby="local-web-preview-heading">
          <div className="local-web-section-heading"><h2 id="local-web-preview-heading">Local preview</h2>
            {!phone.remote && <div className="local-web-heading-actions">
              <button type="button" onClick={() => setPreviewVersion(value => value + 1)}>Refresh</button>
              <a className="local-web-button" href={`${previewSource === 'github' && githubReady ? previewBase : previewUrl}${previewPage === '/' ? '' : previewPage}`} target="_blank" rel="noreferrer">Open local website</a>
            </div>}
          </div>
          <p className="local-web-hint">Account actions in the preview use the live service.</p>
          {phone.remote ? <div className="local-web-phone-preview">
            <p>The preview opens in its own tab. Enter the same connection code there, then refresh it after each save.</p>
            <a href={previewUrl} target="_blank" rel="noreferrer" className="local-web-button local-web-primary">Open phone preview</a>
          </div> : <>
            <div className="local-web-actions" role="group" aria-label="Preview source">
              <button type="button" aria-pressed={previewSource === 'local'} onClick={() => setPreviewSource('local')}>Your files</button>
              <button type="button" aria-pressed={previewSource === 'github'} disabled={github.state === 'unavailable'}
                title={github.state === 'unavailable' ? 'Restart with npm run office:release-local to preview GitHub' : undefined}
                onClick={() => setPreviewSource('github')}>GitHub</button>
            </div>
            {previewSource === 'github' && <div className="local-web-github">
              <label className="local-web-label" htmlFor="local-web-branch">GitHub branch</label>
              <div className="local-web-actions">
                <input id="local-web-branch" value={branch} onChange={event => setBranch(event.target.value)} spellCheck={false} autoCapitalize="none" />
                <button type="button" className="local-web-primary" disabled={github.state === 'updating'} onClick={getLatestFromGithub}>Get latest from GitHub</button>
              </div>
              <p className="local-web-hint" role="status">{github.state === 'updating' ? `${github.step || 'Updating'}…`
                : github.state === 'ready' ? `Showing ${github.branch} at ${github.sha.slice(0, 7)}: ${github.subject}`
                : github.state === 'error' ? `Could not load GitHub: ${github.error}`
                : 'Get the latest from GitHub to preview it here. Your own files are not changed.'}</p>
            </div>}
            <div className="local-web-actions" role="group" aria-label="Preview page">
              {PREVIEW_PAGES.map(([page, label]) => <button type="button" key={page} aria-pressed={previewPage === page} onClick={() => setPreviewPage(page)}>{label}</button>)}
            </div>
            <div className="local-web-actions" role="group" aria-label="Preview size">
              <button type="button" aria-pressed={previewSize === 'desktop'} onClick={() => setPreviewSize('desktop')}>Desktop</button>
              <button type="button" aria-pressed={previewSize === 'mobile'} onClick={() => setPreviewSize('mobile')}>Mobile</button>
            </div>
            {previewSource === 'github' && !githubReady
              ? <p className="local-web-empty">The GitHub version appears here once it has loaded.</p>
              : <LocalPreview size={previewSize} version={`${previewVersion}:${previewSource}:${github.sha || ''}`} page={previewPage} base={previewBase} />}
          </>}
        </section>
      </div>
      <section className={`local-web-panel local-web-publish${stepClass('publish')}`} aria-labelledby="local-web-publish-heading">
        <div className="local-web-section-heading"><h2 id="local-web-publish-heading">Update the public website</h2><span>One reviewed file at a time</span></div>
        <p>Publishes only the selected saved file after you review its changes. Other local edits stay on this computer.</p>
        <button type="button" onClick={prepareReview} disabled={!saved || dirty || Boolean(busy)}>{busy === 'reviewing' ? 'Loading public review…' : 'Review for public update'}</button>
        {!saved && <p className="local-web-hint">Choose and save a file first.</p>}
        {dirty && <p className="local-web-hint">Save your edits locally before preparing the public review.</p>}
        {review && <div className="local-web-review">
          <h3>Changes to {review.path}</h3>
          <p className="local-web-hint">Compared with the public release source. Publishing replaces the whole file, and is rejected if that source changes first.</p>
          <Changes before={review.baseline} after={review.content} />
          <details className="local-web-full">
            <summary>Compare full files</summary>
            <div className="local-web-comparison">
              <label>Current public release source<textarea aria-label="Current public release source" className="local-web-code" value={review.baseline} readOnly spellCheck={false} /></label>
              <label>Saved local file to publish<textarea aria-label="Saved local file to publish" className="local-web-code" value={review.content} readOnly spellCheck={false} /></label>
            </div>
          </details>
          <label className="local-web-label" htmlFor="local-web-commit-message">Describe this public update</label>
          <input id="local-web-commit-message" value={commitMessage} disabled={Boolean(busy)} maxLength={120} placeholder="What changes for visitors" onChange={event => setCommitMessage(event.target.value)} />
          <label className="local-web-confirm"><input type="checkbox" checked={reviewed} disabled={Boolean(busy)} onChange={event => setReviewed(event.target.checked)} />I reviewed these changes and want to publish this file to the public website.</label>
          <button type="button" className="local-web-primary" onClick={publishFile} disabled={!reviewed || commitMessage.trim().length < 6 || Boolean(busy)}>{busy === 'publishing' ? 'Publishing…' : 'Publish this file'}</button>
        </div>}
      </section>
    </>}
  </>;
}

function PhoneConnection() {
  const [address, setAddress] = useState(() => { try { return localStorage.getItem('ufi-local-computer-link') || ''; } catch { return ''; } });
  const { url, problem } = readPhoneLink(address);
  return <section className="local-web-panel local-web-phone" aria-labelledby="phone-connect-heading">
    <h2 id="phone-connect-heading">Edit from your phone</h2>
    <ol className="local-web-steps-list">
      <li>On your computer, run <code>npm run office:release-local</code> and choose <strong>Start phone connection</strong> in the local workspace it opens.</li>
      <li>Scan the QR code with this phone, or paste its link below.</li>
      <li>Enter the connection code shown on your computer.</li>
    </ol>
    <label className="local-web-label" htmlFor="phone-workspace-address">Computer connection link</label>
    <input id="phone-workspace-address" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={address} onChange={event => setAddress(event.target.value)} placeholder="https://your-connection.trycloudflare.com" />
    {problem && <p className="local-web-hint" role="status">{problem}</p>}
    <div className="local-web-actions">
      {url ? <a className="local-web-button local-web-primary" href={`${url}/#local-web`} rel="noreferrer" onClick={() => { try { localStorage.setItem('ufi-local-computer-link', url); } catch {} }}>Connect to my computer</a>
        : <button type="button" className="local-web-primary" disabled>Connect to my computer</button>}
    </div>
    <p className="local-web-hint">The link changes each time the phone connection starts. Your computer must stay on.</p>
  </section>;
}

export default function LocalWeb({ apiBase = '', request }) {
  return <div className="local-web">
    <h1>Local web</h1>
    {isLocalConsole ? <LocalEditor apiBase={apiBase} request={request} /> : <>
      <p className="local-web-subtitle">Edit the website on your computer, check the preview, then publish one reviewed file.</p>
      <section className="local-web-panel local-web-desktop-start">
        <h2>Make changes on your computer</h2>
        <p>Start the local console from your UFIConnect repository:</p>
        <pre className="local-web-command">npm run office:release-local</pre>
        <div className="local-web-actions">
          <a className="local-web-button local-web-primary" href={LOCAL_CONSOLE} target="_blank" rel="noreferrer">Open local web workspace</a>
          <a className="local-web-button" href={LOCAL_CONSOLE} target="_blank" rel="noreferrer">Start phone connection</a>
        </div>
        <p className="local-web-hint">Both open the console on this computer at 127.0.0.1:4174. <strong>Start phone connection</strong> is at the top of that page; this hosted site cannot reach your computer. Publishing a reviewed file asks for your Office access token.</p>
      </section>
      <PhoneConnection />
    </>}
  </div>;
}
