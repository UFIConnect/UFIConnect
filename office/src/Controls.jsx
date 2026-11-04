import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  if (control.input === 'flood-settings') return 'Configure';
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

function frontendTargetLabel(target) {
  if (target === 'mobile') return 'App';
  if (target === 'office') return 'Office';
  return 'Web';
}

function ActionButton({ children, onClick, tone = 'primary', disabled = false, style, title }) {
  const tones = {
    primary: { background: COLORS.blueStrong, color: '#fff', borderColor: COLORS.blueStrong },
    neutral: { background: 'rgba(255,255,255,.04)', color: COLORS.subtle, borderColor: COLORS.border },
    success: { background: 'rgba(34,197,94,.10)', color: COLORS.green, borderColor: 'rgba(34,197,94,.25)' },
  };
  return (
    <button
      type="button"
      className="controls-action"
      onClick={onClick}
      disabled={disabled}
      title={title}
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

export default function Controls({ apiBase = '', pipelineBase = '', request = fetch, onNavigate = () => {}, initialQuery = '' }) {
  const [controls, setControls] = useState([]);
  const [history, setHistory] = useState([]);
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState('All controls');
  const [status, setStatus] = useState('Loading controls');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [runningId, setRunningId] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const commandListRef = useRef(null);
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

  const categoryCounts = useMemo(() => {
    const counts = new Map([['All controls', controls.length]]);
    for (const control of controls) counts.set(control.category, (counts.get(control.category) || 0) + 1);
    return counts;
  }, [controls]);

  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    return controls.filter((control) => {
      const categoryMatch = category === 'All controls' || control.category === category;
      const haystack = `${control.label} ${control.description} ${control.category} ${control.id}`.toLowerCase();
      return categoryMatch && (!search || haystack.includes(search));
    });
  }, [category, controls, query]);

  const groupedControls = useMemo(() => {
    const groups = new Map();
    for (const control of filtered) {
      if (!groups.has(control.category)) groups.set(control.category, []);
      groups.get(control.category).push(control);
    }
    return [...groups.entries()];
  }, [filtered]);

  const chooseCategory = useCallback((nextCategory) => {
    setCategory(nextCategory);
    window.requestAnimationFrame(() => {
      commandListRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }, []);

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
      setNotice({ tone: 'info', text: `Choose an existing ${frontendTargetLabel(target)} frontend file, review it, then commit the change.` });
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
    if (control.input === 'flood-settings') {
      onNavigate('feed-audit');
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
      const bases = [...new Set(requestedBases)];
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
      setNotice({
        tone: 'success',
        text: control.input === 'frontend-file'
          ? `${control.label} completed. GitHub verification will publish the commit to the public domain when it passes.`
          : `${control.label} completed.`,
        result,
      });
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
    <div className="controls-page" style={{ maxWidth: 1500, margin: '0 auto' }}>
      <style>{`
        @keyframes controlsEnter {
          from { opacity: 0; transform: translateY(7px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes controlsProgress {
          from { transform: translateX(-100%); }
          to { transform: translateX(320%); }
        }
        .controls-page { scroll-behavior: smooth; }
        .controls-summary,
        .controls-panel { animation: controlsEnter .24s ease-out both; }
        .controls-action { transition: transform .14s ease, filter .14s ease, border-color .14s ease; }
        .controls-action:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.12); }
        .controls-action:active:not(:disabled) { transform: translateY(0); }
        .controls-category-button {
          width: 100%; min-height: 34px; display: flex; align-items: center; justify-content: space-between;
          gap: 10px; padding: 8px 10px; border: 1px solid transparent; border-radius: 7px;
          background: transparent; color: #64748b; cursor: pointer; font: inherit; font-size: 11px;
          text-align: left; transition: background .14s ease, border-color .14s ease, color .14s ease, transform .14s ease;
        }
        .controls-category-button:hover { background: rgba(255,255,255,.04); color: #cbd5e1; transform: translateX(2px); }
        .controls-category-button[data-active="true"] {
          background: rgba(29,78,216,.16); border-color: rgba(96,165,250,.28); color: #93c5fd;
        }
        .controls-category-count {
          min-width: 24px; padding: 2px 6px; border-radius: 999px; background: rgba(255,255,255,.05);
          color: #94a3b8; text-align: center; font-size: 9.5px; font-variant-numeric: tabular-nums;
        }
        .controls-command-list { scroll-behavior: smooth; scrollbar-gutter: stable; }
        .controls-command-group { animation: controlsEnter .2s ease-out both; }
        .controls-command-row {
          transition: background .14s ease, padding-left .14s ease, border-color .14s ease;
          animation: controlsEnter .2s ease-out both;
        }
        .controls-command-row:hover { background: rgba(255,255,255,.025); padding-left: 8px !important; }
        .controls-running-track { height: 2px; overflow: hidden; background: rgba(96,165,250,.12); border-radius: 999px; }
        .controls-running-track::after {
          content: ''; display: block; width: 32%; height: 100%; background: #60a5fa;
          animation: controlsProgress 1s ease-in-out infinite;
        }
        @media (max-width: 980px) {
          .controls-browser { grid-template-columns: 1fr !important; }
          .controls-category-nav {
            display: flex !important; overflow-x: auto; gap: 7px; padding: 1px 0 8px;
            position: sticky; top: 0; z-index: 4; background: #0d0d1a; scrollbar-width: thin;
          }
          .controls-category-button { width: auto; flex: 0 0 auto; white-space: nowrap; }
          .controls-category-button:hover { transform: translateY(-1px); }
          .controls-command-list { max-height: 68vh !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .controls-page, .controls-command-list { scroll-behavior: auto; }
          .controls-summary, .controls-panel, .controls-command-group, .controls-command-row,
          .controls-running-track::after { animation: none !important; }
          .controls-action, .controls-category-button, .controls-command-row { transition: none !important; }
        }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#f1f5f9', letterSpacing: 0 }}>Controls</h1>
          <p style={{ margin: '6px 0 0', color: COLORS.muted, fontSize: 13.5, lineHeight: 1.5 }}>
            Run public feed, source, health, frontend, and deployment actions from one place.
          </p>
        </div>
        <ActionButton tone="neutral" onClick={refresh}>Refresh controls</ActionButton>
      </div>

      <div className="controls-summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 10, marginBottom: 18 }}>
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

      <section className="controls-panel" style={sectionStyle}>
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
        {runningId && <div className="controls-running-track" aria-hidden="true" style={{ margin: '-5px 0 12px' }} />}

        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(220px, 1fr) auto', gap: 9, marginBottom: 12 }}>
          <input aria-label="Search controls" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actions, services, or sources" style={inputStyle} />
          <ActionButton
            tone="neutral"
            onClick={() => { setQuery(''); chooseCategory('All controls'); }}
            disabled={!query && category === 'All controls'}
            style={{ width: compact ? '100%' : undefined }}
          >
            Clear filters
          </ActionButton>
        </div>

        <div className="controls-browser" style={{ display: 'grid', gridTemplateColumns: '205px minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
          <nav className="controls-category-nav" aria-label="Control categories" style={{ display: 'grid', gap: 3, position: 'sticky', top: 0 }}>
            {categories.map((entry) => (
              <button
                key={entry}
                type="button"
                className="controls-category-button"
                data-active={category === entry}
                aria-pressed={category === entry}
                onClick={() => chooseCategory(entry)}
              >
                <span>{entry}</span>
                <span className="controls-category-count">{categoryCounts.get(entry) || 0}</span>
              </button>
            ))}
          </nav>

          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, margin: '0 2px 8px' }}>
              <span style={{ color: COLORS.subtle, fontSize: 10.5, fontWeight: 700 }}>
                {filtered.length} {filtered.length === 1 ? 'command' : 'commands'}
              </span>
              <span style={{ color: COLORS.muted, fontSize: 10 }}>Select a category or search by service</span>
            </div>
            <div ref={commandListRef} className="controls-command-list" style={{ maxHeight: 620, overflowY: 'auto', borderTop: `1px solid ${COLORS.border}`, borderBottom: `1px solid ${COLORS.border}` }}>
              {groupedControls.map(([groupName, groupControls], groupIndex) => (
                <section key={groupName} className="controls-command-group" style={{ animationDelay: `${Math.min(groupIndex * 24, 160)}ms` }}>
                  <div style={{
                    position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                    padding: '8px 6px', background: COLORS.panel, borderBottom: `1px solid ${COLORS.border}`,
                  }}>
                    <h3 style={{ margin: 0, color: COLORS.blue, fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0 }}>{groupName}</h3>
                    <span style={{ color: COLORS.muted, fontSize: 9.5 }}>{groupControls.length}</span>
                  </div>
                  {groupControls.map((control, controlIndex) => {
                    const running = runningId === control.id;
                    const unavailable = control.available === false;
                    return (
                      <div key={control.id} className="controls-command-row" style={{
                        display: 'grid',
                        gridTemplateColumns: compact ? 'minmax(0, 1fr) auto' : 'minmax(260px, 1fr) 100px 120px',
                        gap: 10,
                        alignItems: 'center',
                        padding: '11px 3px',
                        borderBottom: `1px solid ${COLORS.border}`,
                        animationDelay: `${Math.min((groupIndex * 3 + controlIndex) * 18, 220)}ms`,
                      }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                            <span style={{ color: COLORS.text, fontSize: 12.5, fontWeight: 800 }}>{control.label}</span>
                            {running && <span style={{ color: COLORS.blue, fontSize: 9.5, fontWeight: 800 }}>RUNNING</span>}
                          </div>
                          <div style={{ color: unavailable ? COLORS.red : COLORS.muted, fontSize: 10.5, lineHeight: 1.45, marginTop: 3 }}>{unavailable ? control.unavailableReason : control.description}</div>
                          {compact && <div style={{ color: COLORS.subtle, fontSize: 10, marginTop: 5 }}>{control.target} | {control.impact}</div>}
                        </div>
                        {!compact && <div style={{ color: control.impact === 'critical' ? COLORS.red : control.impact === 'high' ? COLORS.amber : COLORS.subtle, fontSize: 10.5, textTransform: 'capitalize' }}>{control.target} | {control.impact}</div>}
                        <ActionButton
                          tone={control.id.startsWith('deploy.') ? 'success' : control.input === 'frontend-file' ? 'primary' : 'neutral'}
                          onClick={() => execute(control)}
                          disabled={Boolean(runningId) || unavailable}
                          title={unavailable ? control.unavailableReason : control.description}
                          style={{ width: compact ? 108 : '100%' }}
                        >
                          {running ? 'Running...' : controlActionLabel(control)}
                        </ActionButton>
                      </div>
                    );
                  })}
                </section>
              ))}
              {!filtered.length && <div style={{ padding: 18, color: COLORS.muted, fontSize: 12 }}>No controls match this filter.</div>}
            </div>
          </div>
        </div>

        {editor.open && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
            <SectionHeader
              title={`${frontendTargetLabel(editor.target)} frontend change`}
              description="Only existing frontend text files are editable. GitHub rejects stale commits, verifies each new main commit, then publishes successful web changes to the public domain."
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
          <SectionHeader
            title="Execution history"
            description="Latest durable control runs across the API and pipeline."
            action={<ActionButton tone="neutral" onClick={() => setHistoryOpen((open) => !open)}>{historyOpen ? 'Hide history' : `Show history (${history.length})`}</ActionButton>}
          />
          {historyOpen && <div className="controls-command-group" style={{ display: 'grid', maxHeight: 300, overflowY: 'auto' }}>
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
          </div>}
        </div>
      </section>
    </div>
  );
}
