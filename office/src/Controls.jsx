import { useCallback, useEffect, useMemo, useState } from 'react';

const COLORS = {
  panel: '#0d0d1a',
  border: 'rgba(255,255,255,.08)',
  text: '#e2e8f0',
  muted: '#64748b',
  subtle: '#94a3b8',
  blue: '#60a5fa',
  blueStrong: '#1d4ed8',
  green: '#4ade80',
  amber: '#fbbf24',
  red: '#f87171',
};

const inputStyle = {
  width: '100%',
  minHeight: 38,
  padding: '9px 11px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 7,
  background: '#080812',
  color: COLORS.text,
  fontSize: 13,
  lineHeight: 1.4,
  outline: 'none',
  letterSpacing: 0,
  colorScheme: 'dark',
};

const sectionStyle = {
  background: COLORS.panel,
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  padding: 18,
};

async function responsePayload(response) {
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.error || payload.msg || `Request returned ${response.status}`);
  return payload;
}

function controlActionLabel(control) {
  if (control.input === 'frontend-file') return 'Edit and commit';
  if (control.id === 'deploy.mobile') return 'Build app';
  if (control.id.startsWith('deploy.')) return 'Deploy';
  return 'Run';
}

function resultSummary(value) {
  if (!value || typeof value !== 'object') return String(value || 'Completed');
  const text = JSON.stringify(value, null, 2);
  return text.length > 1800 ? `${text.slice(0, 1800)}\n...` : text;
}

function formatTimestamp(value) {
  if (!value) return 'Pending';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function ActionButton({ children, onClick, tone = 'primary', disabled = false, style }) {
  const tones = {
    primary: { background: COLORS.blueStrong, color: '#fff', borderColor: COLORS.blueStrong },
    neutral: { background: 'rgba(255,255,255,.04)', color: COLORS.subtle, borderColor: COLORS.border },
    success: { background: 'rgba(34,197,94,.10)', color: COLORS.green, borderColor: 'rgba(34,197,94,.25)' },
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: 36,
        padding: '8px 13px',
        border: '1px solid',
        borderRadius: 7,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0,
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function SectionHeader({ title, description, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 15 }}>
      <div>
        <h2 style={{ margin: 0, color: COLORS.text, fontSize: 15, fontWeight: 800, letterSpacing: 0 }}>{title}</h2>
        {description && <p style={{ margin: '4px 0 0', color: COLORS.muted, fontSize: 11.5, lineHeight: 1.5 }}>{description}</p>}
      </div>
      {action}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ color: COLORS.subtle, fontSize: 11, fontWeight: 700 }}>{label}</span>
      {children}
      {hint && <span style={{ color: COLORS.muted, fontSize: 10.5, lineHeight: 1.4 }}>{hint}</span>}
    </label>
  );
}

export default function Controls({ apiBase = '', pipelineBase = '', request = fetch }) {
  const [controls, setControls] = useState([]);
  const [history, setHistory] = useState([]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All controls');
  const [status, setStatus] = useState(apiBase ? 'Loading controls' : 'Controls unavailable');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [runningId, setRunningId] = useState('');
  const [compact, setCompact] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 980px)').matches : false
  ));
  const [editor, setEditor] = useState({
    open: false,
    controlId: '',
    target: 'web',
    files: [],
    filePath: '',
    sha: '',
    content: '',
    original: '',
    commitMessage: '',
    loading: false,
    error: '',
  });

  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  const refresh = useCallback(async () => {
    if (!apiBase) return;
    setStatus('Refreshing controls');
    try {
      const payload = await responsePayload(await request(`${apiBase}/office/controls`));
      setControls(Array.isArray(payload.controls) ? payload.controls : []);
      setHistory(Array.isArray(payload.history) ? payload.history : []);
      setStatus(`${payload.controls?.length || 0} controls ready`);
      setError('');
    } catch (loadError) {
      setStatus('Controls unavailable');
      setError(loadError.message);
    }
  }, [apiBase, request]);

  useEffect(() => { refresh(); }, [refresh]);

  const categories = useMemo(() => (
    ['All controls', ...new Set(controls.map((control) => control.category))]
  ), [controls]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return controls.filter((control) => {
      const categoryMatch = category === 'All controls' || control.category === category;
      const haystack = `${control.label} ${control.description} ${control.category} ${control.id}`.toLowerCase();
      return categoryMatch && (!search || haystack.includes(search));
    });
  }, [category, controls, query]);

  const openEditor = async (control) => {
    if (control.available === false) {
      setNotice({ tone: 'error', text: control.unavailableReason || 'This control is not configured.' });
      return;
    }
    const target = control.frontendTarget;
    setEditor((current) => ({
      ...current,
      open: true,
      controlId: control.id,
      target,
      files: [],
      filePath: '',
      sha: '',
      content: '',
      original: '',
      commitMessage: '',
      loading: true,
      error: '',
    }));
    try {
      const payload = await responsePayload(await request(`${apiBase}/office/frontend-files?target=${encodeURIComponent(target)}`));
      setEditor((current) => ({ ...current, files: payload.files || [], loading: false }));
      setNotice({ tone: 'info', text: `Choose an existing ${target} frontend file, review it, then commit the change.` });
    } catch (loadError) {
      setEditor((current) => ({ ...current, loading: false, error: loadError.message }));
    }
  };

  const loadFile = async () => {
    if (!editor.filePath) return;
    setEditor((current) => ({ ...current, loading: true, error: '' }));
    try {
      const url = `${apiBase}/office/frontend-file?target=${encodeURIComponent(editor.target)}&path=${encodeURIComponent(editor.filePath)}`;
      const payload = await responsePayload(await request(url));
      setEditor((current) => ({
        ...current,
        filePath: payload.path,
        sha: payload.sha,
        content: payload.content,
        original: payload.content,
        loading: false,
      }));
    } catch (loadError) {
      setEditor((current) => ({ ...current, loading: false, error: loadError.message }));
    }
  };

  const execute = async (control, extraPayload = null) => {
    if (!control) return null;
    if (control.input === 'frontend-file' && !extraPayload) {
      await openEditor(control);
      return null;
    }
    if (control.available === false) {
      setNotice({ tone: 'error', text: control.unavailableReason || 'This control is not configured.' });
      return null;
    }
    if (control.requiresConfirmation && !window.confirm(
      `Run "${control.label}"? The action and result will be recorded in Office history.`,
    )) return null;

    setRunningId(control.id);
    setNotice({ tone: 'info', text: `${control.label} is running.` });
    try {
      const requestedBases = control.target === 'both'
        ? [apiBase, pipelineBase || apiBase]
        : [control.target === 'pipeline' ? (pipelineBase || apiBase) : apiBase];
      const bases = [...new Set(requestedBases.filter(Boolean))];
      const results = [];
      for (const base of bases) {
        const payload = await responsePayload(await request(`${base}/office/controls/${encodeURIComponent(control.id)}/execute`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            contextId: `office-controls:${control.id}`,
            contextLabel: control.label,
            confirmed: Boolean(control.requiresConfirmation),
            ...(extraPayload || {}),
          }),
        }));
        results.push({ role: base === apiBase ? 'api' : 'pipeline', ...payload.result });
      }
      const result = results.length === 1 ? results[0] : results;
      setNotice({ tone: 'success', text: `${control.label} completed.`, result });
      await refresh();
      return results[0] || null;
    } catch (runError) {
      setNotice({ tone: 'error', text: `${control.label} failed: ${runError.message}` });
      await refresh();
      return null;
    } finally {
      setRunningId('');
    }
  };

  const commitFile = async () => {
    const control = controls.find((entry) => entry.id === editor.controlId);
    if (!editor.filePath || !editor.sha) {
      setEditor((current) => ({ ...current, error: 'Choose and load a frontend file first.' }));
      return;
    }
    if (editor.content === editor.original) {
      setEditor((current) => ({ ...current, error: 'Make a reviewed change before committing.' }));
      return;
    }
    if (editor.commitMessage.trim().length < 6) {
      setEditor((current) => ({ ...current, error: 'Enter a specific commit message.' }));
      return;
    }
    setEditor((current) => ({ ...current, error: '' }));
    const result = await execute(control, {
      filePath: editor.filePath,
      expectedSha: editor.sha,
      content: editor.content,
      commitMessage: editor.commitMessage,
    });
    if (result?.contentSha) {
      setEditor((current) => ({
        ...current,
        sha: result.contentSha,
        original: current.content,
        commitMessage: '',
      }));
    }
  };

  const unavailableCount = controls.filter((control) => control.available === false).length;
  const sourceCount = controls.filter((control) => control.category === 'Individual sources').length;

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#f1f5f9', letterSpacing: 0 }}>Controls</h1>
          <p style={{ margin: '6px 0 0', color: COLORS.muted, fontSize: 13.5, lineHeight: 1.5 }}>
            Run public feed, source, health, frontend, and deployment actions from one place.
          </p>
        </div>
        <ActionButton tone="neutral" onClick={refresh}>Refresh controls</ActionButton>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 10, marginBottom: 18 }}>
        {[
          ['Available', controls.length - unavailableCount, COLORS.green],
          ['Needs setup', unavailableCount, unavailableCount ? COLORS.amber : COLORS.green],
          ['Source actions', sourceCount, COLORS.blue],
          ['Recorded runs', history.length, COLORS.text],
        ].map(([label, value, color]) => (
          <div key={label} style={{ ...sectionStyle, padding: '13px 15px' }}>
            <div style={{ color: COLORS.muted, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
            <div style={{ color, fontSize: 22, fontWeight: 800, marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
          </div>
        ))}
      </div>

      <section style={sectionStyle}>
        <SectionHeader
          title="Public control plane"
          description={`${status}. Confirmed actions and their results are stored in the Office audit history.`}
        />

        {error && <div role="alert" style={{ marginBottom: 12, padding: '10px 12px', border: '1px solid rgba(239,68,68,.28)', borderRadius: 7, background: 'rgba(239,68,68,.07)', color: COLORS.red, fontSize: 11.5 }}>{error}</div>}
        {notice && (
          <div role="status" style={{
            marginBottom: 12,
            padding: '10px 12px',
            border: `1px solid ${notice.tone === 'error' ? 'rgba(239,68,68,.28)' : notice.tone === 'success' ? 'rgba(34,197,94,.28)' : 'rgba(96,165,250,.28)'}`,
            borderRadius: 7,
            background: notice.tone === 'error' ? 'rgba(239,68,68,.07)' : notice.tone === 'success' ? 'rgba(34,197,94,.07)' : 'rgba(59,130,246,.07)',
            color: notice.tone === 'error' ? COLORS.red : notice.tone === 'success' ? COLORS.green : COLORS.blue,
            fontSize: 11.5,
            lineHeight: 1.5,
          }}>
            <strong>{notice.text}</strong>
            {notice.result && <pre style={{ margin: '7px 0 0', maxHeight: 150, overflow: 'auto', whiteSpace: 'pre-wrap', color: COLORS.subtle, fontSize: 10.5, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }}>{resultSummary(notice.result)}</pre>}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(240px, 1fr) 230px', gap: 9, marginBottom: 8 }}>
          <input aria-label="Search controls" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actions, services, or sources" style={inputStyle} />
          <select aria-label="Filter controls by category" value={category} onChange={(event) => setCategory(event.target.value)} style={inputStyle}>
            {categories.map((entry) => <option key={entry}>{entry}</option>)}
          </select>
        </div>

        <div style={{ maxHeight: 520, overflowY: 'auto', borderTop: `1px solid ${COLORS.border}` }}>
          {filtered.map((control) => {
            const running = runningId === control.id;
            const unavailable = control.available === false;
            return (
              <div key={control.id} style={{
                display: 'grid',
                gridTemplateColumns: compact ? 'minmax(0, 1fr) auto' : 'minmax(260px, 1fr) 150px 90px 120px',
                gap: 10,
                alignItems: 'center',
                padding: '11px 3px',
                borderBottom: `1px solid ${COLORS.border}`,
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: COLORS.text, fontSize: 12.5, fontWeight: 800 }}>{control.label}</div>
                  <div style={{ color: unavailable ? COLORS.red : COLORS.muted, fontSize: 10.5, lineHeight: 1.45, marginTop: 3 }}>{unavailable ? control.unavailableReason : control.description}</div>
                  {compact && <div style={{ color: COLORS.subtle, fontSize: 10, marginTop: 5 }}>{control.category} | {control.target} | {control.impact}</div>}
                </div>
                {!compact && <div style={{ color: COLORS.subtle, fontSize: 10.5 }}>{control.category}</div>}
                {!compact && <div style={{ color: control.impact === 'critical' ? COLORS.red : control.impact === 'high' ? COLORS.amber : COLORS.subtle, fontSize: 10.5, textTransform: 'capitalize' }}>{control.target} | {control.impact}</div>}
                <ActionButton
                  tone={control.id.startsWith('deploy.') ? 'success' : control.input === 'frontend-file' ? 'primary' : 'neutral'}
                  onClick={() => execute(control)}
                  disabled={running || unavailable}
                  style={{ width: compact ? 112 : '100%' }}
                >
                  {running ? 'Running...' : controlActionLabel(control)}
                </ActionButton>
              </div>
            );
          })}
          {!filtered.length && <div style={{ padding: 14, color: COLORS.muted, fontSize: 12 }}>No controls match this filter.</div>}
        </div>

        {editor.open && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
            <SectionHeader
              title={`${editor.target === 'web' ? 'Web' : 'App'} frontend change`}
              description="Only existing frontend text files are editable. GitHub rejects stale or conflicting commits."
              action={<ActionButton tone="neutral" onClick={() => setEditor((current) => ({ ...current, open: false }))}>Close editor</ActionButton>}
            />
            <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) 110px', gap: 9 }}>
              <select
                aria-label="Frontend file"
                value={editor.filePath}
                onChange={(event) => setEditor((current) => ({ ...current, filePath: event.target.value, sha: '', content: '', original: '', error: '' }))}
                style={inputStyle}
              >
                <option value="">{editor.loading ? 'Loading files...' : 'Choose a frontend file'}</option>
                {editor.files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
              </select>
              <ActionButton tone="neutral" onClick={loadFile} disabled={!editor.filePath || editor.loading}>{editor.loading ? 'Loading...' : 'Load file'}</ActionButton>
            </div>
            {editor.error && <div role="alert" style={{ color: COLORS.red, fontSize: 11.5, marginTop: 9 }}>{editor.error}</div>}
            {editor.sha && (
              <>
                <textarea
                  aria-label="Frontend file content"
                  spellCheck="false"
                  value={editor.content}
                  onChange={(event) => setEditor((current) => ({ ...current, content: event.target.value, error: '' }))}
                  rows={compact ? 16 : 24}
                  style={{ ...inputStyle, marginTop: 10, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 11, tabSize: 2 }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) auto auto', gap: 9, alignItems: 'end', marginTop: 9 }}>
                  <Field label="Commit message" hint={`${editor.content.length.toLocaleString()} characters | ${editor.content === editor.original ? 'No changes' : 'Modified'}`}>
                    <input value={editor.commitMessage} onChange={(event) => setEditor((current) => ({ ...current, commitMessage: event.target.value, error: '' }))} placeholder="Describe this frontend change" maxLength={120} style={inputStyle} />
                  </Field>
                  <ActionButton tone="neutral" onClick={() => setEditor((current) => ({ ...current, content: current.original, error: '' }))} disabled={editor.content === editor.original}>Reset</ActionButton>
                  <ActionButton onClick={commitFile} disabled={runningId === editor.controlId || editor.content === editor.original}>{runningId === editor.controlId ? 'Committing...' : 'Commit to main'}</ActionButton>
                </div>
              </>
            )}
          </div>
        )}

        <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
          <SectionHeader title="Execution history" description="Latest durable control runs across the API and pipeline." />
          <div style={{ display: 'grid', maxHeight: 300, overflowY: 'auto' }}>
            {history.slice(0, 50).map((run) => (
              <div key={run.id} style={{ display: 'grid', gridTemplateColumns: compact ? '1fr auto' : 'minmax(220px, 1fr) 100px 160px 95px', gap: 10, padding: '9px 2px', borderTop: `1px solid ${COLORS.border}`, alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: COLORS.text, fontSize: 11.5, fontWeight: 700 }}>{run.controlLabel}</div>
                  <div style={{ color: run.error ? COLORS.red : COLORS.muted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{run.error || run.contextLabel || 'Office control'}</div>
                </div>
                {!compact && <div style={{ color: COLORS.subtle, fontSize: 10.5, textTransform: 'capitalize' }}>{run.targetRole}</div>}
                {!compact && <div style={{ color: COLORS.muted, fontSize: 10.5 }}>{formatTimestamp(run.startedAt)}</div>}
                <div style={{ color: run.status === 'succeeded' ? COLORS.green : run.status === 'failed' ? COLORS.red : COLORS.amber, fontSize: 10.5, fontWeight: 800, textTransform: 'capitalize', textAlign: 'right' }}>
                  {run.status}{run.durationMs != null ? ` | ${run.durationMs}ms` : ''}
                </div>
              </div>
            ))}
            {!history.length && <div style={{ color: COLORS.muted, fontSize: 12, padding: '10px 0' }}>No control runs have been recorded yet.</div>}
          </div>
        </div>
      </section>
    </div>
  );
}
