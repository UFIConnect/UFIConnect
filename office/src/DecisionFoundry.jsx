import { useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEY = 'ufi_office_decision_foundry_v1';

const COLORS = {
  page: '#080810',
  panel: '#0d0d1a',
  panelSoft: '#10101f',
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

function uid(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function newDecision() {
  const now = new Date().toISOString();
  const impact = uid('criterion');
  const confidence = uid('criterion');
  const speed = uid('criterion');
  const reversibility = uid('criterion');
  const criteria = [
    { id: impact, name: 'Impact', weight: 40 },
    { id: confidence, name: 'Confidence', weight: 25 },
    { id: speed, name: 'Speed to value', weight: 20 },
    { id: reversibility, name: 'Reversibility', weight: 15 },
  ];
  const makeOption = (name) => ({
    id: uid('option'),
    name,
    summary: '',
    confidence: 60,
    scores: Object.fromEntries(criteria.map((criterion) => [criterion.id, 3])),
  });

  return {
    id: uid('decision'),
    title: 'Untitled decision',
    question: '',
    context: '',
    owner: '',
    deadline: '',
    status: 'Draft',
    criteria,
    options: [makeOption('Option A'), makeOption('Option B')],
    evidence: [],
    risks: [],
    recommendationId: '',
    rationale: '',
    successMeasure: '',
    reviewDate: '',
    controlId: '',
    decidedAt: '',
    createdAt: now,
    updatedAt: now,
  };
}

function loadDecisions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {}
  return [newDecision()];
}

function isUsableDecisionList(value) {
  return Array.isArray(value) && value.length > 0 && value.every((decision) => (
    decision && typeof decision.id === 'string' &&
    Array.isArray(decision.criteria) && Array.isArray(decision.options)
  ));
}

function weightedScore(decision, option) {
  const totalWeight = decision.criteria.reduce((sum, criterion) => sum + Number(criterion.weight || 0), 0);
  if (!totalWeight) return 0;
  const weighted = decision.criteria.reduce((sum, criterion) => {
    const score = Math.min(5, Math.max(1, Number(option.scores?.[criterion.id] || 3)));
    return sum + score * Number(criterion.weight || 0);
  }, 0);
  return weighted / totalWeight;
}

function scorePercent(score) {
  return Math.round((score / 5) * 100);
}

function readiness(decision) {
  const weightTotal = decision.criteria.reduce((sum, criterion) => sum + Number(criterion.weight || 0), 0);
  const checks = [
    { label: 'Decision question', done: Boolean(decision.question.trim()) },
    { label: 'Two or more options', done: decision.options.length >= 2 },
    { label: 'Weights total 100%', done: Math.abs(weightTotal - 100) < 0.01 },
    { label: 'Recommendation selected', done: Boolean(decision.recommendationId) },
    { label: 'Rationale recorded', done: Boolean(decision.rationale.trim()) },
  ];
  return { checks, complete: checks.filter((check) => check.done).length, weightTotal };
}

function formatDate(value) {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTimestamp(value) {
  if (!value) return 'Pending';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

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

function decisionBrief(decision) {
  const ranked = decision.options
    .map((option) => ({ ...option, score: weightedScore(decision, option) }))
    .sort((a, b) => b.score - a.score);
  const recommendation = decision.options.find((option) => option.id === decision.recommendationId);
  const lines = [
    `# ${decision.title || 'Untitled decision'}`,
    '',
    `Status: ${decision.status}`,
    `Owner: ${decision.owner || 'Unassigned'}`,
    `Decision date: ${decision.decidedAt ? formatDate(decision.decidedAt) : 'Not decided'}`,
    `Review date: ${formatDate(decision.reviewDate)}`,
    `Public action: ${decision.controlId || 'No action linked'}`,
    '',
    '## Decision question',
    decision.question || 'Not recorded.',
    '',
    '## Context',
    decision.context || 'Not recorded.',
    '',
    '## Ranked options',
    ...ranked.map((option, index) => `${index + 1}. ${option.name || 'Unnamed option'} - ${scorePercent(option.score)}% weighted score (${option.confidence || 0}% confidence)`),
    '',
    '## Decision',
    recommendation?.name || 'No recommendation selected.',
    '',
    '## Rationale',
    decision.rationale || 'Not recorded.',
    '',
    '## Success measure',
    decision.successMeasure || 'Not recorded.',
    '',
    '## Evidence',
    ...(decision.evidence.length
      ? decision.evidence.map((item) => `- [${item.stance}] ${item.source || 'Source'}: ${item.note || 'No note'}`)
      : ['- No evidence recorded.']),
    '',
    '## Risks',
    ...(decision.risks.length
      ? decision.risks.map((risk) => `- ${risk.name || 'Unnamed risk'} (${risk.likelihood} x ${risk.impact}): ${risk.mitigation || 'No mitigation recorded'}`)
      : ['- No risks recorded.']),
    '',
    `Last updated: ${new Date(decision.updatedAt).toLocaleString()}`,
  ];
  return lines.join('\n');
}

function Field({ label, children, hint }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ color: COLORS.subtle, fontSize: 11, fontWeight: 700, letterSpacing: 0 }}>{label}</span>
      {children}
      {hint && <span style={{ color: COLORS.muted, fontSize: 10.5, lineHeight: 1.4 }}>{hint}</span>}
    </label>
  );
}

function ActionButton({ children, onClick, tone = 'primary', disabled = false, style }) {
  const tones = {
    primary: { background: COLORS.blueStrong, color: '#fff', borderColor: COLORS.blueStrong },
    neutral: { background: 'rgba(255,255,255,.04)', color: COLORS.subtle, borderColor: COLORS.border },
    success: { background: 'rgba(34,197,94,.10)', color: COLORS.green, borderColor: 'rgba(34,197,94,.25)' },
    danger: { background: 'rgba(239,68,68,.08)', color: COLORS.red, borderColor: 'rgba(239,68,68,.22)' },
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

function DecisionFoundry({ apiBase = '', pipelineBase = '', request = fetch }) {
  const [decisions, setDecisions] = useState(loadDecisions);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [copied, setCopied] = useState(false);
  const [remoteSyncEnabled, setRemoteSyncEnabled] = useState(false);
  const [syncState, setSyncState] = useState(apiBase ? 'Loading Office data' : 'Browser backup');
  const [controls, setControls] = useState([]);
  const [controlHistory, setControlHistory] = useState([]);
  const [controlQuery, setControlQuery] = useState('');
  const [controlCategory, setControlCategory] = useState('All controls');
  const [controlState, setControlState] = useState(apiBase ? 'Loading controls' : 'Controls unavailable');
  const [controlError, setControlError] = useState('');
  const [controlNotice, setControlNotice] = useState(null);
  const [runningControlId, setRunningControlId] = useState('');
  const [frontendEditor, setFrontendEditor] = useState({
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
  const decisionsRef = useRef(decisions);
  const [compact, setCompact] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 980px)').matches : false
  ));

  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    decisionsRef.current = decisions;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions)); } catch {}
  }, [decisions]);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (!apiBase) {
        return;
      }
      try {
        const response = await request(`${apiBase}/office/workspaces/decision-foundry`);
        if (!response.ok) throw new Error(`Workspace returned ${response.status}`);
        const data = await response.json();
        const remoteDecisions = data?.payload?.decisions;
        if (cancelled) return;
        if (isUsableDecisionList(remoteDecisions)) {
          setDecisions(remoteDecisions);
          setSyncState('Saved to Office DB');
        } else {
          setSyncState('Saving to Office DB');
        }
        setRemoteSyncEnabled(true);
      } catch {
        if (!cancelled) setSyncState('Browser backup');
      }
    };

    hydrate();
    return () => { cancelled = true; };
  }, [apiBase, request]);

  useEffect(() => {
    if (!remoteSyncEnabled || !apiBase) return undefined;
    setSyncState('Saving to Office DB');
    const timeout = window.setTimeout(async () => {
      try {
        const response = await request(`${apiBase}/office/workspaces/decision-foundry`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ payload: { decisions: decisionsRef.current } }),
        });
        if (!response.ok) throw new Error(`Workspace returned ${response.status}`);
        setSyncState('Saved to Office DB');
      } catch {
        setSyncState('Browser backup');
      }
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [apiBase, decisions, remoteSyncEnabled, request]);

  useEffect(() => {
    let cancelled = false;
    if (!apiBase) return undefined;
    const loadControls = async () => {
      try {
        const payload = await responsePayload(await request(`${apiBase}/office/decision-controls`));
        if (cancelled) return;
        setControls(Array.isArray(payload.controls) ? payload.controls : []);
        setControlHistory(Array.isArray(payload.history) ? payload.history : []);
        setControlState(`${payload.controls?.length || 0} controls ready`);
        setControlError('');
      } catch (error) {
        if (!cancelled) {
          setControlState('Controls unavailable');
          setControlError(error.message);
        }
      }
    };
    loadControls();
    return () => { cancelled = true; };
  }, [apiBase, request]);

  const selected = decisions.find((decision) => decision.id === selectedId) || decisions[0];
  const selectedKey = selected?.id;
  useEffect(() => {
    if (selectedKey && selectedKey !== selectedId) setSelectedId(selectedKey);
  }, [selectedId, selectedKey]);

  const filtered = useMemo(() => decisions.filter((decision) => {
    const matchesStatus = statusFilter === 'All' || decision.status === statusFilter;
    const haystack = `${decision.title} ${decision.question} ${decision.owner}`.toLowerCase();
    return matchesStatus && haystack.includes(query.trim().toLowerCase());
  }), [decisions, query, statusFilter]);

  const controlCategories = useMemo(() => (
    ['All controls', ...new Set(controls.map((control) => control.category))]
  ), [controls]);

  const filteredControls = useMemo(() => {
    const search = controlQuery.trim().toLowerCase();
    return controls.filter((control) => {
      const matchesCategory = controlCategory === 'All controls' || control.category === controlCategory;
      const haystack = `${control.label} ${control.description} ${control.category} ${control.id}`.toLowerCase();
      return matchesCategory && (!search || haystack.includes(search));
    });
  }, [controlCategory, controlQuery, controls]);

  const ranked = useMemo(() => {
    if (!selected) return [];
    return selected.options
      .map((option) => ({ ...option, weighted: weightedScore(selected, option) }))
      .sort((a, b) => b.weighted - a.weighted);
  }, [selected]);

  if (!selected) return null;

  const ready = readiness(selected);
  const leader = ranked[0];
  const recommendation = selected.options.find((option) => option.id === selected.recommendationId);
  const activeCount = decisions.filter((decision) => !['Decided', 'Archived'].includes(decision.status)).length;
  const decidedCount = decisions.filter((decision) => decision.status === 'Decided').length;

  const updateSelected = (changes) => {
    setDecisions((current) => current.map((decision) => (
      decision.id === selected.id
        ? { ...decision, ...(typeof changes === 'function' ? changes(decision) : changes), updatedAt: new Date().toISOString() }
        : decision
    )));
  };

  const updateCollectionItem = (field, id, changes) => {
    updateSelected((decision) => ({
      [field]: decision[field].map((item) => item.id === id ? { ...item, ...changes } : item),
    }));
  };

  const addDecision = () => {
    const created = newDecision();
    setDecisions((current) => [created, ...current]);
    setSelectedId(created.id);
  };

  const duplicateDecision = () => {
    const copy = {
      ...selected,
      id: uid('decision'),
      title: `${selected.title} copy`,
      status: 'Draft',
      decidedAt: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setDecisions((current) => [copy, ...current]);
    setSelectedId(copy.id);
  };

  const removeDecision = () => {
    if (!window.confirm(`Delete "${selected.title}"? This cannot be undone.`)) return;
    const remaining = decisions.filter((decision) => decision.id !== selected.id);
    if (!remaining.length) {
      const replacement = newDecision();
      setDecisions([replacement]);
      setSelectedId(replacement.id);
      return;
    }
    setDecisions(remaining);
    setSelectedId(remaining[0].id);
  };

  const addCriterion = () => {
    const id = uid('criterion');
    updateSelected((decision) => ({
      criteria: [...decision.criteria, { id, name: 'New criterion', weight: 0 }],
      options: decision.options.map((option) => ({ ...option, scores: { ...option.scores, [id]: 3 } })),
    }));
  };

  const removeCriterion = (id) => {
    if (selected.criteria.length <= 1) return;
    updateSelected((decision) => ({
      criteria: decision.criteria.filter((criterion) => criterion.id !== id),
      options: decision.options.map((option) => {
        const scores = { ...option.scores };
        delete scores[id];
        return { ...option, scores };
      }),
    }));
  };

  const normalizeWeights = () => {
    const total = selected.criteria.reduce((sum, criterion) => sum + Math.max(0, Number(criterion.weight || 0)), 0);
    const count = selected.criteria.length;
    let used = 0;
    const criteria = selected.criteria.map((criterion, index) => {
      const weight = index === count - 1
        ? Number((100 - used).toFixed(2))
        : Number((total > 0 ? (Math.max(0, Number(criterion.weight || 0)) / total) * 100 : 100 / count).toFixed(2));
      used += weight;
      return { ...criterion, weight };
    });
    updateSelected({ criteria });
  };

  const addOption = () => {
    updateSelected((decision) => ({
      options: [...decision.options, {
        id: uid('option'),
        name: `Option ${String.fromCharCode(65 + decision.options.length)}`,
        summary: '',
        confidence: 60,
        scores: Object.fromEntries(decision.criteria.map((criterion) => [criterion.id, 3])),
      }],
    }));
  };

  const removeOption = (id) => {
    if (selected.options.length <= 1) return;
    updateSelected((decision) => ({
      options: decision.options.filter((option) => option.id !== id),
      recommendationId: decision.recommendationId === id ? '' : decision.recommendationId,
    }));
  };

  const addEvidence = () => updateSelected((decision) => ({
    evidence: [...decision.evidence, {
      id: uid('evidence'), source: '', note: '', stance: 'Supports', optionId: decision.options[0]?.id || '',
    }],
  }));

  const addRisk = () => updateSelected((decision) => ({
    risks: [...decision.risks, { id: uid('risk'), name: '', likelihood: 2, impact: 3, mitigation: '', owner: '' }],
  }));

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(decisionBrief(selected));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const exportBrief = () => {
    const blob = new Blob([decisionBrief(selected)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selected.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'decision'}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const markDecided = () => updateSelected({
    status: 'Decided',
    recommendationId: selected.recommendationId || leader?.id || '',
    decidedAt: selected.decidedAt || new Date().toISOString(),
  });

  const refreshControlData = async () => {
    if (!apiBase) return;
    setControlState('Refreshing controls');
    try {
      const payload = await responsePayload(await request(`${apiBase}/office/decision-controls`));
      setControls(Array.isArray(payload.controls) ? payload.controls : []);
      setControlHistory(Array.isArray(payload.history) ? payload.history : []);
      setControlState(`${payload.controls?.length || 0} controls ready`);
      setControlError('');
    } catch (error) {
      setControlState('Controls unavailable');
      setControlError(error.message);
    }
  };

  const persistWorkspace = async (snapshot) => {
    if (!apiBase) throw new Error('Office API is not configured.');
    setSyncState('Saving to Office DB');
    const response = await request(`${apiBase}/office/workspaces/decision-foundry`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { decisions: snapshot } }),
    });
    await responsePayload(response);
    setSyncState('Saved to Office DB');
  };

  const openFrontendEditor = async (control) => {
    if (control.available === false) {
      setControlNotice({ tone: 'error', text: control.unavailableReason || 'This control is not configured.' });
      return;
    }
    const target = control.frontendTarget;
    updateSelected({ controlId: control.id });
    setFrontendEditor((current) => ({
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
      setFrontendEditor((current) => ({ ...current, files: payload.files || [], loading: false }));
      setControlNotice({ tone: 'info', text: `Choose an existing ${target} frontend file, review it, then commit the change.` });
    } catch (error) {
      setFrontendEditor((current) => ({ ...current, loading: false, error: error.message }));
    }
  };

  const loadFrontendFile = async (filePath = frontendEditor.filePath) => {
    if (!filePath) return;
    setFrontendEditor((current) => ({ ...current, loading: true, error: '' }));
    try {
      const url = `${apiBase}/office/frontend-file?target=${encodeURIComponent(frontendEditor.target)}&path=${encodeURIComponent(filePath)}`;
      const payload = await responsePayload(await request(url));
      setFrontendEditor((current) => ({
        ...current,
        filePath: payload.path,
        sha: payload.sha,
        content: payload.content,
        original: payload.content,
        loading: false,
        error: '',
      }));
    } catch (error) {
      setFrontendEditor((current) => ({ ...current, loading: false, error: error.message }));
    }
  };

  const executeControl = async (control, extraPayload = null) => {
    if (!control) {
      setControlNotice({ tone: 'error', text: 'Choose a public control first.' });
      return null;
    }
    if (control.input === 'frontend-file' && !extraPayload) {
      await openFrontendEditor(control);
      return null;
    }
    if (control.available === false) {
      setControlNotice({ tone: 'error', text: control.unavailableReason || 'This control is not configured.' });
      return null;
    }
    if (control.impact === 'critical' && selected.status !== 'Decided') {
      setControlNotice({ tone: 'error', text: 'Mark this decision as Decided before committing or deploying.' });
      return null;
    }
    if (control.requiresConfirmation && !window.confirm(
      `Run "${control.label}" for "${selected.title}"? This action will be written to the Office audit history.`,
    )) return null;

    const linkedDecisions = decisions.map((decision) => (
      decision.id === selected.id
        ? { ...decision, controlId: control.id, updatedAt: new Date().toISOString() }
        : decision
    ));
    setDecisions(linkedDecisions);
    decisionsRef.current = linkedDecisions;
    setRunningControlId(control.id);
    setControlNotice({ tone: 'info', text: `${control.label} is running.` });

    try {
      await persistWorkspace(linkedDecisions);
      const requestedBases = control.target === 'both'
        ? [apiBase, pipelineBase || apiBase]
        : [control.target === 'pipeline' ? (pipelineBase || apiBase) : apiBase];
      const bases = [...new Set(requestedBases.filter(Boolean))];
      const results = [];
      for (const base of bases) {
        const payload = await responsePayload(await request(`${base}/office/decision-controls/${encodeURIComponent(control.id)}/execute`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            decisionId: selected.id,
            decisionTitle: selected.title,
            confirmed: Boolean(control.requiresConfirmation),
            ...(extraPayload || {}),
          }),
        }));
        results.push({ role: base === apiBase ? 'api' : 'pipeline', ...payload.result });
      }
      const result = results.length === 1 ? results[0] : results;
      setControlNotice({ tone: 'success', text: `${control.label} completed.`, result });
      await refreshControlData();
      return results[0] || null;
    } catch (error) {
      setControlNotice({ tone: 'error', text: `${control.label} failed: ${error.message}` });
      await refreshControlData();
      return null;
    } finally {
      setRunningControlId('');
    }
  };

  const commitFrontendFile = async () => {
    const control = controls.find((entry) => entry.id === frontendEditor.controlId);
    if (!frontendEditor.filePath || !frontendEditor.sha) {
      setFrontendEditor((current) => ({ ...current, error: 'Choose and load a frontend file first.' }));
      return;
    }
    if (frontendEditor.content === frontendEditor.original) {
      setFrontendEditor((current) => ({ ...current, error: 'Make a reviewed change before committing.' }));
      return;
    }
    if (frontendEditor.commitMessage.trim().length < 6) {
      setFrontendEditor((current) => ({ ...current, error: 'Enter a specific commit message.' }));
      return;
    }
    setFrontendEditor((current) => ({ ...current, error: '' }));
    const result = await executeControl(control, {
      filePath: frontendEditor.filePath,
      expectedSha: frontendEditor.sha,
      content: frontendEditor.content,
      commitMessage: frontendEditor.commitMessage,
    });
    if (result?.contentSha) {
      setFrontendEditor((current) => ({
        ...current,
        sha: result.contentSha,
        original: current.content,
        commitMessage: '',
      }));
    }
  };

  const linkedControl = controls.find((control) => control.id === selected.controlId);

  return (
    <div style={{ maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#f1f5f9', letterSpacing: 0 }}>Decision Foundry</h1>
          <p style={{ margin: '6px 0 0', color: COLORS.muted, fontSize: 13.5, lineHeight: 1.5 }}>
            Decide, execute approved public controls, and keep a durable record of every change.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <ActionButton tone="neutral" onClick={copyBrief}>{copied ? 'Copied' : 'Copy brief'}</ActionButton>
          <ActionButton tone="neutral" onClick={exportBrief}>Export brief</ActionButton>
          <ActionButton onClick={addDecision}>New decision</ActionButton>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 10, marginBottom: 18 }}>
        {[
          ['Total decisions', decisions.length, COLORS.text],
          ['Open', activeCount, COLORS.blue],
          ['Decided', decidedCount, COLORS.green],
          ['Current readiness', `${ready.complete}/5`, ready.complete === 5 ? COLORS.green : COLORS.amber],
        ].map(([label, value, color]) => (
          <div key={label} style={{ ...sectionStyle, padding: '13px 15px' }}>
            <div style={{ color: COLORS.muted, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0 }}>{label}</div>
            <div style={{ color, fontSize: 22, fontWeight: 800, marginTop: 5, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
          </div>
        ))}
      </div>

      <section style={{ ...sectionStyle, marginBottom: 18 }}>
        <SectionHeader
          title="Public control plane"
          description={`${controlState}. Every action is allowlisted, linked to the selected decision, and recorded in the Office database.`}
          action={<ActionButton tone="neutral" onClick={refreshControlData}>Refresh controls</ActionButton>}
        />

        {controlError && (
          <div role="alert" style={{ marginBottom: 12, padding: '10px 12px', border: '1px solid rgba(239,68,68,.28)', borderRadius: 7, background: 'rgba(239,68,68,.07)', color: COLORS.red, fontSize: 11.5 }}>
            {controlError}
          </div>
        )}

        {controlNotice && (
          <div
            role="status"
            style={{
              marginBottom: 12,
              padding: '10px 12px',
              border: `1px solid ${controlNotice.tone === 'error' ? 'rgba(239,68,68,.28)' : controlNotice.tone === 'success' ? 'rgba(34,197,94,.28)' : 'rgba(96,165,250,.28)'}`,
              borderRadius: 7,
              background: controlNotice.tone === 'error' ? 'rgba(239,68,68,.07)' : controlNotice.tone === 'success' ? 'rgba(34,197,94,.07)' : 'rgba(59,130,246,.07)',
              color: controlNotice.tone === 'error' ? COLORS.red : controlNotice.tone === 'success' ? COLORS.green : COLORS.blue,
              fontSize: 11.5,
              lineHeight: 1.5,
            }}
          >
            <strong>{controlNotice.text}</strong>
            {controlNotice.result && (
              <pre style={{ margin: '7px 0 0', maxHeight: 150, overflow: 'auto', whiteSpace: 'pre-wrap', color: COLORS.subtle, fontSize: 10.5, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }}>
                {resultSummary(controlNotice.result)}
              </pre>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(240px, 1fr) 230px', gap: 9, marginBottom: 8 }}>
          <input
            aria-label="Search public controls"
            value={controlQuery}
            onChange={(event) => setControlQuery(event.target.value)}
            placeholder="Search actions, services, or sources"
            style={inputStyle}
          />
          <select aria-label="Filter controls by category" value={controlCategory} onChange={(event) => setControlCategory(event.target.value)} style={inputStyle}>
            {controlCategories.map((category) => <option key={category}>{category}</option>)}
          </select>
        </div>

        <div style={{ maxHeight: 430, overflowY: 'auto', borderTop: `1px solid ${COLORS.border}` }}>
          {filteredControls.map((control) => {
            const running = runningControlId === control.id;
            const unavailable = control.available === false;
            return (
              <div
                key={control.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: compact ? 'minmax(0, 1fr) auto' : 'minmax(260px, 1fr) 150px 90px 120px',
                  gap: 10,
                  alignItems: 'center',
                  padding: '11px 3px',
                  borderBottom: `1px solid ${COLORS.border}`,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: COLORS.text, fontSize: 12.5, fontWeight: 800 }}>{control.label}</div>
                  <div style={{ color: unavailable ? COLORS.red : COLORS.muted, fontSize: 10.5, lineHeight: 1.45, marginTop: 3 }}>
                    {unavailable ? control.unavailableReason : control.description}
                  </div>
                  {compact && <div style={{ color: COLORS.subtle, fontSize: 10, marginTop: 5 }}>{control.category} | {control.target} | {control.impact}</div>}
                </div>
                {!compact && <div style={{ color: COLORS.subtle, fontSize: 10.5 }}>{control.category}</div>}
                {!compact && <div style={{ color: control.impact === 'critical' ? COLORS.red : control.impact === 'high' ? COLORS.amber : COLORS.subtle, fontSize: 10.5, textTransform: 'capitalize' }}>{control.target} | {control.impact}</div>}
                <ActionButton
                  tone={control.id.startsWith('deploy.') ? 'success' : control.input === 'frontend-file' ? 'primary' : 'neutral'}
                  onClick={() => executeControl(control)}
                  disabled={running || unavailable}
                  style={{ width: compact ? 112 : '100%' }}
                >
                  {running ? 'Running...' : controlActionLabel(control)}
                </ActionButton>
              </div>
            );
          })}
          {!filteredControls.length && <div style={{ padding: 14, color: COLORS.muted, fontSize: 12 }}>No controls match this filter.</div>}
        </div>

        {frontendEditor.open && (
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
            <SectionHeader
              title={`${frontendEditor.target === 'web' ? 'Web' : 'App'} frontend change`}
              description="Only existing frontend text files are editable. GitHub rejects the commit if the file changed after it was loaded."
              action={<ActionButton tone="neutral" onClick={() => setFrontendEditor((current) => ({ ...current, open: false }))}>Close editor</ActionButton>}
            />
            <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) 110px', gap: 9 }}>
              <select
                aria-label="Frontend file"
                value={frontendEditor.filePath}
                onChange={(event) => setFrontendEditor((current) => ({
                  ...current,
                  filePath: event.target.value,
                  sha: '',
                  content: '',
                  original: '',
                  error: '',
                }))}
                style={inputStyle}
              >
                <option value="">{frontendEditor.loading ? 'Loading files...' : 'Choose a frontend file'}</option>
                {frontendEditor.files.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
              </select>
              <ActionButton tone="neutral" onClick={() => loadFrontendFile()} disabled={!frontendEditor.filePath || frontendEditor.loading}>
                {frontendEditor.loading ? 'Loading...' : 'Load file'}
              </ActionButton>
            </div>
            {frontendEditor.error && <div role="alert" style={{ color: COLORS.red, fontSize: 11.5, marginTop: 9 }}>{frontendEditor.error}</div>}
            {frontendEditor.sha && (
              <>
                <textarea
                  aria-label="Frontend file content"
                  spellCheck="false"
                  value={frontendEditor.content}
                  onChange={(event) => setFrontendEditor((current) => ({ ...current, content: event.target.value, error: '' }))}
                  rows={compact ? 16 : 24}
                  style={{ ...inputStyle, marginTop: 10, resize: 'vertical', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 11, tabSize: 2 }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) auto auto', gap: 9, alignItems: 'end', marginTop: 9 }}>
                  <Field label="Commit message" hint={`${frontendEditor.content.length.toLocaleString()} characters | ${frontendEditor.content === frontendEditor.original ? 'No changes' : 'Modified'}`}>
                    <input
                      value={frontendEditor.commitMessage}
                      onChange={(event) => setFrontendEditor((current) => ({ ...current, commitMessage: event.target.value, error: '' }))}
                      placeholder="Describe this frontend change"
                      maxLength={120}
                      style={inputStyle}
                    />
                  </Field>
                  <ActionButton tone="neutral" onClick={() => setFrontendEditor((current) => ({ ...current, content: current.original, error: '' }))} disabled={frontendEditor.content === frontendEditor.original}>Reset</ActionButton>
                  <ActionButton onClick={commitFrontendFile} disabled={runningControlId === frontendEditor.controlId || frontendEditor.content === frontendEditor.original}>
                    {runningControlId === frontendEditor.controlId ? 'Committing...' : 'Commit to main'}
                  </ActionButton>
                </div>
              </>
            )}
          </div>
        )}

        <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
          <SectionHeader title="Execution history" description="Latest durable control runs across the API and pipeline." />
          <div style={{ display: 'grid', gap: 0, maxHeight: 260, overflowY: 'auto' }}>
            {controlHistory.slice(0, 30).map((run) => (
              <div key={run.id} style={{ display: 'grid', gridTemplateColumns: compact ? '1fr auto' : 'minmax(220px, 1fr) 100px 160px 95px', gap: 10, padding: '9px 2px', borderTop: `1px solid ${COLORS.border}`, alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: COLORS.text, fontSize: 11.5, fontWeight: 700 }}>{run.controlLabel}</div>
                  <div style={{ color: run.error ? COLORS.red : COLORS.muted, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{run.error || run.decisionTitle}</div>
                </div>
                {!compact && <div style={{ color: COLORS.subtle, fontSize: 10.5, textTransform: 'capitalize' }}>{run.targetRole}</div>}
                {!compact && <div style={{ color: COLORS.muted, fontSize: 10.5 }}>{formatTimestamp(run.startedAt)}</div>}
                <div style={{ color: run.status === 'succeeded' ? COLORS.green : run.status === 'failed' ? COLORS.red : COLORS.amber, fontSize: 10.5, fontWeight: 800, textTransform: 'capitalize', textAlign: 'right' }}>
                  {run.status}{run.durationMs != null ? ` | ${run.durationMs}ms` : ''}
                </div>
              </div>
            ))}
            {!controlHistory.length && <div style={{ color: COLORS.muted, fontSize: 12, padding: '10px 0' }}>No control runs have been recorded yet.</div>}
          </div>
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0, 1fr)' : '270px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <aside style={{ ...sectionStyle, padding: 12, position: compact ? 'static' : 'sticky', top: 20 }}>
          <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
            <input
              aria-label="Search decisions"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search decisions"
              style={inputStyle}
            />
            <select aria-label="Filter decisions by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={inputStyle}>
              {['All', 'Draft', 'Evaluating', 'Decided', 'Monitoring', 'Archived'].map((status) => <option key={status}>{status}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: compact ? 'row' : 'column', overflowX: compact ? 'auto' : 'visible', gap: 7, paddingBottom: compact ? 4 : 0 }}>
            {filtered.map((decision) => {
              const active = decision.id === selected.id;
              const itemReady = readiness(decision);
              return (
                <button
                  key={decision.id}
                  type="button"
                  onClick={() => setSelectedId(decision.id)}
                  style={{
                    width: compact ? 230 : '100%', minWidth: compact ? 230 : 0, padding: '11px 12px',
                    border: `1px solid ${active ? 'rgba(96,165,250,.5)' : 'transparent'}`,
                    borderRadius: 7, background: active ? 'rgba(59,130,246,.10)' : 'rgba(255,255,255,.025)',
                    cursor: 'pointer', textAlign: 'left', letterSpacing: 0,
                  }}
                >
                  <div style={{ color: active ? '#f1f5f9' : COLORS.text, fontSize: 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {decision.title || 'Untitled decision'}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, color: COLORS.muted, fontSize: 10.5 }}>
                    <span>{decision.status}</span>
                    <span>{itemReady.complete}/5 ready</span>
                  </div>
                </button>
              );
            })}
            {!filtered.length && <div style={{ color: COLORS.muted, fontSize: 12, padding: 10 }}>No decisions match.</div>}
          </div>
        </aside>

        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section style={sectionStyle}>
            <SectionHeader
              title="1. Frame the decision"
              description="Name the choice, define the decision question, and record the operating context."
              action={(
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <ActionButton tone="neutral" onClick={duplicateDecision}>Duplicate</ActionButton>
                  <ActionButton tone="danger" onClick={removeDecision}>Delete</ActionButton>
                </div>
              )}
            />
            <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(0, 2fr) minmax(180px, .8fr) minmax(155px, .7fr)', gap: 12 }}>
              <Field label="Decision title">
                <input value={selected.title} onChange={(event) => updateSelected({ title: event.target.value })} style={inputStyle} />
              </Field>
              <Field label="Owner">
                <input value={selected.owner} onChange={(event) => updateSelected({ owner: event.target.value })} placeholder="Decision owner" style={inputStyle} />
              </Field>
              <Field label="Decision deadline">
                <input type="date" value={selected.deadline} onChange={(event) => updateSelected({ deadline: event.target.value })} style={inputStyle} />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12, marginTop: 12 }}>
              <Field label="What must be decided?">
                <textarea value={selected.question} onChange={(event) => updateSelected({ question: event.target.value })} rows={4} placeholder="Write one answerable decision question." style={{ ...inputStyle, resize: 'vertical' }} />
              </Field>
              <Field label="Context and constraints">
                <textarea value={selected.context} onChange={(event) => updateSelected({ context: event.target.value })} rows={4} placeholder="Budget, timing, dependencies, and non-negotiables." style={{ ...inputStyle, resize: 'vertical' }} />
              </Field>
            </div>
          </section>

          <section style={sectionStyle}>
            <SectionHeader
              title="2. Set the evaluation criteria"
              description="Weights should total 100%. A higher score should always mean a better outcome."
              action={<ActionButton tone="neutral" onClick={addCriterion}>Add criterion</ActionButton>}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selected.criteria.map((criterion) => (
                <div key={criterion.id} style={{ display: 'grid', gridTemplateColumns: compact ? 'minmax(0, 1fr) 90px 38px' : 'minmax(220px, 1fr) 110px 38px', gap: 8, alignItems: 'center' }}>
                  <input value={criterion.name} onChange={(event) => updateCollectionItem('criteria', criterion.id, { name: event.target.value })} aria-label="Criterion name" style={inputStyle} />
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number" min="0" max="100" step="1"
                      value={criterion.weight}
                      onChange={(event) => updateCollectionItem('criteria', criterion.id, { weight: Math.max(0, Math.min(100, Number(event.target.value))) })}
                      aria-label={`${criterion.name} weight`}
                      style={{ ...inputStyle, paddingRight: 26, fontVariantNumeric: 'tabular-nums' }}
                    />
                    <span style={{ position: 'absolute', right: 10, top: 11, color: COLORS.muted, fontSize: 11 }}>%</span>
                  </div>
                  <button
                    type="button" onClick={() => removeCriterion(criterion.id)} disabled={selected.criteria.length <= 1}
                    aria-label={`Remove ${criterion.name}`}
                    style={{ width: 38, height: 38, borderRadius: 7, border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.red, cursor: 'pointer', opacity: selected.criteria.length <= 1 ? .35 : 1 }}
                  >x</button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: `1px solid ${COLORS.border}` }}>
              <div style={{ color: Math.abs(ready.weightTotal - 100) < .01 ? COLORS.green : COLORS.amber, fontSize: 12, fontWeight: 700 }}>
                Total weight: {Number(ready.weightTotal.toFixed(2))}%
              </div>
              <ActionButton tone="neutral" onClick={normalizeWeights}>Normalize to 100%</ActionButton>
            </div>
          </section>

          <section style={sectionStyle}>
            <SectionHeader
              title="3. Compare options"
              description="Score every option from 1 (weak) to 5 (strong). Rankings update immediately."
              action={<ActionButton tone="neutral" onClick={addOption}>Add option</ActionButton>}
            />
            <div style={{ overflowX: 'auto', paddingBottom: 3 }}>
              <table style={{ width: '100%', minWidth: Math.max(760, 410 + selected.criteria.length * 92), borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <thead>
                  <tr>
                    <th style={{ width: 210, padding: '8px 7px', textAlign: 'left', color: COLORS.muted, fontSize: 10.5 }}>Option</th>
                    {selected.criteria.map((criterion) => <th key={criterion.id} style={{ width: 92, padding: '8px 7px', color: COLORS.muted, fontSize: 10.5 }}>{criterion.name}<br />{criterion.weight}%</th>)}
                    <th style={{ width: 100, padding: '8px 7px', color: COLORS.muted, fontSize: 10.5 }}>Confidence</th>
                    <th style={{ width: 80, padding: '8px 7px', color: COLORS.muted, fontSize: 10.5 }}>Result</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {selected.options.map((option) => {
                    const score = weightedScore(selected, option);
                    const isLeader = leader?.id === option.id;
                    return (
                      <tr key={option.id} style={{ borderTop: `1px solid ${COLORS.border}`, background: isLeader ? 'rgba(34,197,94,.035)' : 'transparent' }}>
                        <td style={{ padding: 7 }}>
                          <input value={option.name} onChange={(event) => updateCollectionItem('options', option.id, { name: event.target.value })} aria-label="Option name" style={inputStyle} />
                          <input value={option.summary} onChange={(event) => updateCollectionItem('options', option.id, { summary: event.target.value })} aria-label={`${option.name} summary`} placeholder="Short tradeoff note" style={{ ...inputStyle, minHeight: 32, marginTop: 6, fontSize: 11.5 }} />
                        </td>
                        {selected.criteria.map((criterion) => (
                          <td key={criterion.id} style={{ padding: 7, textAlign: 'center' }}>
                            <select
                              value={option.scores?.[criterion.id] || 3}
                              onChange={(event) => updateCollectionItem('options', option.id, { scores: { ...option.scores, [criterion.id]: Number(event.target.value) } })}
                              aria-label={`${option.name} ${criterion.name} score`}
                              style={{ ...inputStyle, minHeight: 34, padding: '6px 8px', textAlign: 'center' }}
                            >
                              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
                            </select>
                          </td>
                        ))}
                        <td style={{ padding: 7 }}>
                          <input
                            type="number" min="0" max="100" value={option.confidence}
                            onChange={(event) => updateCollectionItem('options', option.id, { confidence: Math.max(0, Math.min(100, Number(event.target.value))) })}
                            aria-label={`${option.name} confidence`}
                            style={{ ...inputStyle, minHeight: 34, padding: '6px 8px', textAlign: 'center' }}
                          />
                        </td>
                        <td style={{ padding: 7, textAlign: 'center' }}>
                          <div style={{ color: isLeader ? COLORS.green : COLORS.text, fontSize: 16, fontWeight: 800 }}>{scorePercent(score)}%</div>
                          {isLeader && <div style={{ color: COLORS.green, fontSize: 9.5, fontWeight: 700, marginTop: 3 }}>LEADER</div>}
                        </td>
                        <td style={{ padding: 7 }}>
                          <button
                            type="button" onClick={() => removeOption(option.id)} disabled={selected.options.length <= 1}
                            aria-label={`Remove ${option.name}`}
                            style={{ width: 32, height: 32, border: 'none', background: 'transparent', color: COLORS.red, cursor: 'pointer', opacity: selected.options.length <= 1 ? .35 : 1 }}
                          >x</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
            <section style={sectionStyle}>
              <SectionHeader title="4. Evidence" description="Attach the facts that support or challenge each option." action={<ActionButton tone="neutral" onClick={addEvidence}>Add evidence</ActionButton>} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {selected.evidence.map((item) => (
                  <div key={item.id} style={{ paddingTop: 9, borderTop: `1px solid ${COLORS.border}` }}>
                    <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 120px', gap: 7 }}>
                      <input value={item.source} onChange={(event) => updateCollectionItem('evidence', item.id, { source: event.target.value })} placeholder="Source or URL" aria-label="Evidence source" style={inputStyle} />
                      <select value={item.stance} onChange={(event) => updateCollectionItem('evidence', item.id, { stance: event.target.value })} aria-label="Evidence stance" style={inputStyle}>
                        <option>Supports</option><option>Challenges</option><option>Neutral</option>
                      </select>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '150px 1fr 36px', gap: 7, marginTop: 7 }}>
                      <select value={item.optionId} onChange={(event) => updateCollectionItem('evidence', item.id, { optionId: event.target.value })} aria-label="Evidence option" style={inputStyle}>
                        {selected.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                      </select>
                      <input value={item.note} onChange={(event) => updateCollectionItem('evidence', item.id, { note: event.target.value })} placeholder="What does this evidence tell us?" aria-label="Evidence note" style={inputStyle} />
                      <button type="button" onClick={() => updateSelected((decision) => ({ evidence: decision.evidence.filter((entry) => entry.id !== item.id) }))} aria-label="Remove evidence" style={{ width: 36, height: 38, border: 'none', background: 'transparent', color: COLORS.red, cursor: 'pointer' }}>x</button>
                    </div>
                  </div>
                ))}
                {!selected.evidence.length && <div style={{ color: COLORS.muted, fontSize: 12, padding: '9px 0' }}>No evidence recorded yet.</div>}
              </div>
            </section>

            <section style={sectionStyle}>
              <SectionHeader title="5. Risk register" description="Estimate exposure and name the mitigation before committing." action={<ActionButton tone="neutral" onClick={addRisk}>Add risk</ActionButton>} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {selected.risks.map((risk) => {
                  const exposure = Number(risk.likelihood) * Number(risk.impact);
                  return (
                    <div key={risk.id} style={{ paddingTop: 9, borderTop: `1px solid ${COLORS.border}` }}>
                      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 36px' : '1fr 82px 82px 36px', gap: 7 }}>
                        <input value={risk.name} onChange={(event) => updateCollectionItem('risks', risk.id, { name: event.target.value })} placeholder="Risk" aria-label="Risk name" style={inputStyle} />
                        <select value={risk.likelihood} onChange={(event) => updateCollectionItem('risks', risk.id, { likelihood: Number(event.target.value) })} aria-label="Risk likelihood" style={inputStyle}>
                          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>L {value}</option>)}
                        </select>
                        <select value={risk.impact} onChange={(event) => updateCollectionItem('risks', risk.id, { impact: Number(event.target.value) })} aria-label="Risk impact" style={inputStyle}>
                          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>I {value}</option>)}
                        </select>
                        <button type="button" onClick={() => updateSelected((decision) => ({ risks: decision.risks.filter((entry) => entry.id !== risk.id) }))} aria-label="Remove risk" style={{ width: 36, height: 38, border: 'none', background: 'transparent', color: COLORS.red, cursor: 'pointer' }}>x</button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 130px', gap: 7, marginTop: 7 }}>
                        <input value={risk.mitigation} onChange={(event) => updateCollectionItem('risks', risk.id, { mitigation: event.target.value })} placeholder="Mitigation" aria-label="Risk mitigation" style={inputStyle} />
                        <input value={risk.owner} onChange={(event) => updateCollectionItem('risks', risk.id, { owner: event.target.value })} placeholder="Risk owner" aria-label="Risk owner" style={inputStyle} />
                      </div>
                      <div style={{ color: exposure >= 16 ? COLORS.red : exposure >= 8 ? COLORS.amber : COLORS.green, fontSize: 10.5, fontWeight: 700, marginTop: 6 }}>
                        Exposure {exposure}/25
                      </div>
                    </div>
                  );
                })}
                {!selected.risks.length && <div style={{ color: COLORS.muted, fontSize: 12, padding: '9px 0' }}>No risks recorded yet.</div>}
              </div>
            </section>
          </div>

          <section style={sectionStyle}>
            <SectionHeader title="6. Commit and monitor" description="Choose deliberately, document why, and define the signal that will tell you whether it worked." />
            <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) 260px', gap: 16 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr 180px', gap: 10 }}>
                  <Field label="Selected recommendation">
                    <select value={selected.recommendationId} onChange={(event) => updateSelected({ recommendationId: event.target.value })} style={inputStyle}>
                      <option value="">Select an option</option>
                      {ranked.map((option) => <option key={option.id} value={option.id}>{option.name} ({scorePercent(option.weighted)}%)</option>)}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select value={selected.status} onChange={(event) => updateSelected({ status: event.target.value })} style={inputStyle}>
                      {['Draft', 'Evaluating', 'Decided', 'Monitoring', 'Archived'].map((status) => <option key={status}>{status}</option>)}
                    </select>
                  </Field>
                </div>
                {leader && selected.recommendationId !== leader.id && (
                  <button type="button" onClick={() => updateSelected({ recommendationId: leader.id })} style={{ marginTop: 8, border: 'none', background: 'transparent', padding: 0, color: COLORS.green, fontSize: 11.5, cursor: 'pointer', fontWeight: 700 }}>
                    Use score leader: {leader.name} ({scorePercent(leader.weighted)}%)
                  </button>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) 150px', gap: 9, alignItems: 'end', marginTop: 12 }}>
                  <Field
                    label="Linked public action"
                    hint={linkedControl?.impact === 'critical' ? 'Critical actions require this record to be marked Decided.' : 'The action and its result are written to the execution history.'}
                  >
                    <select value={selected.controlId || ''} onChange={(event) => updateSelected({ controlId: event.target.value })} style={inputStyle}>
                      <option value="">Choose an action</option>
                      {controlCategories.filter((category) => category !== 'All controls').map((category) => (
                        <optgroup key={category} label={category}>
                          {controls.filter((control) => control.category === category).map((control) => (
                            <option key={control.id} value={control.id} disabled={control.available === false}>{control.label}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </Field>
                  <ActionButton
                    onClick={() => executeControl(linkedControl)}
                    disabled={!linkedControl || runningControlId === linkedControl?.id || linkedControl?.available === false}
                  >
                    {runningControlId === linkedControl?.id ? 'Running...' : linkedControl ? controlActionLabel(linkedControl) : 'Run action'}
                  </ActionButton>
                </div>
                <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                  <Field label="Decision rationale">
                    <textarea value={selected.rationale} onChange={(event) => updateSelected({ rationale: event.target.value })} rows={4} placeholder="Why this option, and which tradeoffs are being accepted?" style={{ ...inputStyle, resize: 'vertical' }} />
                  </Field>
                  <Field label="Success measure">
                    <textarea value={selected.successMeasure} onChange={(event) => updateSelected({ successMeasure: event.target.value })} rows={3} placeholder="Define a measurable result and its time horizon." style={{ ...inputStyle, resize: 'vertical' }} />
                  </Field>
                  <Field label="Review date">
                    <input type="date" value={selected.reviewDate} onChange={(event) => updateSelected({ reviewDate: event.target.value })} style={{ ...inputStyle, maxWidth: 220 }} />
                  </Field>
                </div>
              </div>

              <div style={{ borderLeft: compact ? 'none' : `1px solid ${COLORS.border}`, borderTop: compact ? `1px solid ${COLORS.border}` : 'none', paddingLeft: compact ? 0 : 16, paddingTop: compact ? 14 : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ color: COLORS.text, fontSize: 13, fontWeight: 800 }}>Readiness</span>
                  <span style={{ color: ready.complete === 5 ? COLORS.green : COLORS.amber, fontSize: 13, fontWeight: 800 }}>{ready.complete}/5</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ready.checks.map((check) => (
                    <div key={check.label} style={{ display: 'flex', alignItems: 'center', gap: 8, color: check.done ? COLORS.subtle : COLORS.muted, fontSize: 11.5 }}>
                      <span style={{ width: 17, height: 17, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: check.done ? 'rgba(34,197,94,.14)' : 'rgba(255,255,255,.05)', color: check.done ? COLORS.green : COLORS.muted, fontSize: 10, flexShrink: 0 }}>
                        {check.done ? 'OK' : '-'}
                      </span>
                      {check.label}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 16, padding: 12, borderRadius: 7, background: COLORS.panelSoft, border: `1px solid ${COLORS.border}` }}>
                  <div style={{ color: COLORS.muted, fontSize: 10.5, marginBottom: 5 }}>Current decision</div>
                  <div style={{ color: recommendation ? COLORS.green : COLORS.subtle, fontSize: 14, fontWeight: 800, lineHeight: 1.35 }}>
                    {recommendation?.name || 'No option selected'}
                  </div>
                  {selected.decidedAt && <div style={{ color: COLORS.muted, fontSize: 10.5, marginTop: 6 }}>{formatDate(selected.decidedAt)}</div>}
                  {linkedControl && <div style={{ color: COLORS.blue, fontSize: 10.5, marginTop: 7 }}>{linkedControl.label}</div>}
                </div>
                <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                  {selected.status === 'Decided'
                    ? <ActionButton tone="neutral" onClick={() => updateSelected({ status: 'Evaluating', decidedAt: '' })} style={{ width: '100%' }}>Reopen decision</ActionButton>
                    : <ActionButton tone="success" onClick={markDecided} disabled={!leader} style={{ width: '100%' }}>Mark decided</ActionButton>
                  }
                </div>
              </div>
            </div>
          </section>

          <div style={{ color: COLORS.muted, fontSize: 10.5, textAlign: 'right' }}>
            {syncState} | Browser backup updated {new Date(selected.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DecisionFoundry;
