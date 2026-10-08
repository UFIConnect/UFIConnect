import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../contexts/ToastContext';
import client, { publicOAuthRequestConfig } from '../api/client';
import { SOURCE_META, withCareerAccountFallback } from './sourceMeta';
import BrandIcon, { hasBrandIcon } from './BrandIcon';
import { normalizeSourceFavorites } from './sourceFavorites';
import AccountConnectionAction from './AccountConnectionAction';
import { sourceAuthorizationState } from './sourceAuthorization.mjs';
import AccountActionIcon from './AccountActionIcon';
import { DirectoryControls, AccountCategoryNavigation, AccountSiteLink } from './DirectoryControls';
import { SOURCE_CATEGORIES, sourceSections, accountSections, selectedAccountSections } from './sourceDirectory';
import UnavailableFeedSources from './UnavailableFeedSources';
import useTabMetrics from '../analytics/useTabMetrics';
import useLocationBasedAccounts from './useLocationBasedAccounts';
import AccountLocationNotice from './AccountLocationNotice';
import AccountLocationGroups from './AccountLocationGroups';
import { locationAccountSection } from '../../../shared/accountLocation.js';

const LINK_FIELDS = [
  { key: 'linkedin', label: 'LinkedIn', placeholder: 'https://linkedin.com/in/yourname' },
  { key: 'github', label: 'GitHub', placeholder: 'https://github.com/yourname' },
  { key: 'portfolio', label: 'Portfolio', placeholder: 'https://yourwebsite.com' },
  { key: 'resume', label: 'Resume / CV', placeholder: 'https://drive.google.com/...' },
  { key: 'twitter', label: 'X / Twitter', placeholder: 'https://x.com/yourhandle' },
];

function ToolPanel({ title, summary, open, onToggle, children, className = '' }) {
  return (
    <section className={`profile-panel ${className}`.trim()}>
      <button type="button" className="profile-panel-trigger" onClick={onToggle} aria-expanded={open}>
        <span>
          <span className="profile-panel-title">{title}</span>
          {summary && <span className="profile-panel-summary">{summary}</span>}
        </span>
        <span className="profile-panel-chevron" aria-hidden="true">{open ? '-' : '+'}</span>
      </button>
      {open && <div className="profile-panel-content">{children}</div>}
    </section>
  );
}

function SourceMark({ source }) {
  const meta = SOURCE_META[source] || {};
  if (hasBrandIcon(source)) {
    return (
      <span className="home-feed-source-mark" style={{ color: meta.color || 'var(--primary)' }}>
        <BrandIcon platform={source} size={18} />
      </span>
    );
  }
  return (
    <span className="home-feed-source-mark home-feed-source-mark--fallback" style={{ color: '#fff', background: meta.color || 'var(--primary)' }}>
      {String(meta.icon || source || 'SRC').slice(0, 3).toUpperCase()}
    </span>
  );
}

function scoreStyle(score) {
  if (score >= 80) return { color: '#047857', background: '#ECFDF5', border: '#A7F3D0' };
  if (score >= 50) return { color: '#B45309', background: '#FFFBEB', border: '#FDE68A' };
  return { color: '#B91C1C', background: '#FEF2F2', border: '#FECACA' };
}

export default function HomeFeedTools({
  showSources = true,
  showAccounts = true,
  showSkills = true,
  showAttachments = true,
  sourceIds = [],
  favoriteMode = 'feed',
  activePanel,
  onActivePanelChange,
}) {
  const { profile, updateProfileLocally } = useAuth();
  const currentAccount = useRef(''); currentAccount.current = `${profile?.id || ''}:${profile?.plan || ''}`;
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [uncontrolledOpenPanel, setUncontrolledOpenPanel] = useState(null);
  const [disabledSources, setDisabledSources] = useState(new Set());
  const [savingSourceId, setSavingSourceId] = useState(null);
  const [sourceCategory, setSourceCategory] = useState('social');
  const [accountPlatforms, setAccountPlatforms] = useState(null);
  const [accountOwner, setAccountOwner] = useState(null);
  const [accountConnected, setAccountConnected] = useState({});
  const [accountError, setAccountError] = useState('');
  const [accountAction, setAccountAction] = useState(null);
  const [accountCategory, setAccountCategory] = useState('social');
  const [blueskyHandle, setBlueskyHandle] = useState(null);
  const [skills, setSkills] = useState([]);
  const [skillInput, setSkillInput] = useState('');
  const [savingSkills, setSavingSkills] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [selectingAttachmentId, setSelectingAttachmentId] = useState(null);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState(null);
  const [links, setLinks] = useState(null);
  const [editingLinks, setEditingLinks] = useState(false);
  const [savingLinks, setSavingLinks] = useState(false);

  useEffect(() => { setSourceCategory('social'); }, [favoriteMode]);
  useEffect(() => { setSkills(Array.isArray(profile?.skills) ? profile.skills : []); }, [profile?.skills]);
  useEffect(() => {
    const stored = Array.isArray(profile?.roleSettings?.disabledSources) ? profile.roleSettings.disabledSources : [];
    setDisabledSources(new Set(stored));
  }, [profile?.roleSettings?.disabledSources]);

  const openPanel = activePanel === undefined ? uncontrolledOpenPanel : activePanel;
  useTabMetrics('home_panel', openPanel);
  useTabMetrics('home_directory', sourceCategory, openPanel === 'sources');
  useTabMetrics('home_accounts_category', accountCategory, openPanel === 'accounts');

  useEffect(() => {
    if (openPanel !== 'files' || attachmentsLoading || attachments.length) return;
    setAttachmentsLoading(true);
    client.get('/profile/attachments')
      .then(({ data }) => setAttachments(data.attachments || []))
      .catch(() => setAttachments([]))
      .finally(() => setAttachmentsLoading(false));
  }, [openPanel, attachments.length, attachmentsLoading]);

  useEffect(() => {
    setAccountPlatforms(null); setAccountConnected({}); setAccountOwner(null);
    setAccountAction(null); setBlueskyHandle(null); setAccountCategory('social');
  }, [profile?.id, profile?.plan]);

  useEffect(() => {
    if (!profile?.id || openPanel !== 'accounts' || accountPlatforms !== null) return;
    let cancelled = false;
    setAccountError('');
    client.get('/social/platforms')
      .then(({ data }) => {
        if (cancelled) return;
        const includeCareer = data.careerOnly === true || profile?.plan === 'business';
        setAccountPlatforms(withCareerAccountFallback(data.platforms, includeCareer));
        setAccountConnected(data.connected || {});
        setAccountOwner(profile.id);
      })
      .catch(error => {
        if (!cancelled) {
          setAccountPlatforms({});
          setAccountOwner(profile.id);
          setAccountError(error?.response?.data?.message || 'Could not load connected accounts.');
        }
      });
    return () => { cancelled = true; };
  }, [openPanel, accountPlatforms, profile?.id, profile?.plan]);

  const toggle = (key) => {
    const next = openPanel === key ? null : key;
    if (activePanel === undefined) setUncontrolledOpenPanel(next);
    onActivePanelChange?.(next);
  };
  const availableSources = useMemo(() => [...new Set(sourceIds)].filter(source => SOURCE_META[source]), [sourceIds]);
  const enabledSourceCount = availableSources.filter(source => !disabledSources.has(source)).length;
  const visibleAccountPlatforms = useMemo(() => {
    if (accountPlatforms === null || accountOwner !== profile?.id) return [];
    const entries = Object.entries(accountPlatforms);
    return profile?.plan === 'business'
      ? entries.filter(([key, platform]) => key === 'linkedin' || platform.category === 'career')
      : entries.filter(([, platform]) => !platform.commandCenterOnly);
  }, [accountPlatforms, accountOwner, profile?.id, profile?.plan]);
  const sourceGroups = sourceSections(availableSources, normalizeSourceFavorites(profile?.roleSettings?.feedSourceFavorites)[favoriteMode], sourceCategory, disabledSources);
  const visibleSources = sourceGroups.flatMap(section => section.items);
  const visibleEnabledCount = visibleSources.filter(source => !disabledSources.has(source)).length;
  const locationRanking = useLocationBasedAccounts(showAccounts && openPanel === 'accounts' && accountCategory === 'location'
    && accountPlatforms !== null && accountOwner === profile?.id && !accountError);
  const accountGroups = [...accountSections(visibleAccountPlatforms, { business: profile?.plan === 'business' }),
    locationAccountSection(visibleAccountPlatforms, locationRanking.data, { business: profile?.plan === 'business' })];
  const displayedAccountGroups = selectedAccountSections(accountGroups, accountCategory);

  async function persistDisabledSources(next, previous, pendingKey, successMessage) {
    setDisabledSources(next);
    setSavingSourceId(pendingKey);
    try {
      const { data } = await client.patch('/profile', {
        roleSettings: { ...(profile.roleSettings || {}), disabledSources: [...next] },
      });
      const savedProfile = data.profile || data;
      updateProfileLocally(savedProfile);
      const persisted = savedProfile?.roleSettings?.disabledSources;
      setDisabledSources(new Set(Array.isArray(persisted) ? persisted : [...next]));
      showToast(successMessage, 'success');
    } catch (error) {
      setDisabledSources(previous);
      showToast(error?.response?.data?.message || 'Could not save your source choice.', 'error');
    } finally {
      setSavingSourceId(null);
    }
  }

  async function toggleSource(source) {
    if (!profile || savingSourceId) return;
    const previous = new Set(disabledSources);
    const next = new Set(previous);
    if (next.has(source)) next.delete(source);
    else next.add(source);
    await persistDisabledSources(
      next,
      previous,
      source,
      `${SOURCE_META[source]?.label || source} is ${next.has(source) ? 'off' : 'on'} for your feed.`,
    );
  }

  async function setAllSources(enabled) {
    if (!profile || savingSourceId || visibleSources.length === 0) return;
    const previous = new Set(disabledSources);
    const next = new Set(previous);
    visibleSources.forEach(source => {
      if (enabled) next.delete(source);
      else next.add(source);
    });
    await persistDisabledSources(
      next,
      previous,
      '__all__',
      enabled ? 'Sources in this category are on.' : 'Sources in this category are off.',
    );
  }

  function reloadAccounts() {
    setAccountPlatforms(null);
    setAccountOwner(null); setAccountConnected({});
    setAccountError('');
  }

  async function startAccountConnection(platform, handle = '') {
    const state = sourceAuthorizationState(accountOwner === profile?.id ? accountPlatforms?.[platform] : null, { isConnected: accountConnected[platform] === true });
    if (!state.ready) { setAccountError(state.reason); return; }
    const owner = currentAccount.current;
    const handleParam = handle.trim() ? `?handle=${encodeURIComponent(handle.trim())}` : '';
    setAccountAction(`connect:${platform}`);
    setAccountError('');
    try {
      const { data } = await client.get(
        `/auth/social/${platform}/start${handleParam}`,
        publicOAuthRequestConfig(),
      );
      if (currentAccount.current !== owner) return;
      if (!data?.url) throw new Error('Missing provider authorization URL.');
      window.location.href = data.url;
    } catch (error) {
      if (currentAccount.current !== owner) return;
      setAccountError(error?.response?.data?.detail || error?.response?.data?.error || error.message || 'Could not start this connection.');
      setAccountAction(null);
    }
  }

  function connectAccount(platform) {
    const state = sourceAuthorizationState(accountOwner === profile?.id ? accountPlatforms?.[platform] : null, { isConnected: accountConnected[platform] === true });
    if (!state.ready) { setAccountError(state.reason); return; }
    if (platform === 'mastodon') {
      navigate('/connected-accounts?connect=mastodon');
      return;
    }
    if (platform === 'bluesky') {
      setBlueskyHandle('');
      return;
    }
    startAccountConnection(platform);
  }

  async function disconnectAccount(platform) {
    if (accountOwner !== profile?.id || accountConnected[platform] !== true) return;
    const owner = currentAccount.current;
    setAccountAction(`disconnect:${platform}`);
    setAccountError('');
    try {
      await client.delete(`/social/connect/${platform}`);
      if (currentAccount.current !== owner) return;
      setAccountConnected(current => ({ ...current, [platform]: false }));
      const linked = (profile?.connectedPlatforms || Object.keys(accountConnected).filter(key => accountConnected[key]
        && accountPlatforms?.[key]?.connectionMode !== 'external')).filter(key => key !== platform);
      updateProfileLocally({ connectedPlatforms: linked,
        connectedSocial: { ...(profile?.connectedSocial || {}), [platform]: false },
        socialConnected: { ...(profile?.socialConnected || {}), [platform]: false } });
      showToast(`${accountPlatforms?.[platform]?.name || platform} disconnected.`, 'success');
    } catch (error) {
      if (currentAccount.current !== owner) return;
      setAccountError(error?.response?.data?.error || 'Could not disconnect this account.');
    } finally {
      if (currentAccount.current === owner) setAccountAction(null);
    }
  }

  function addSkill() {
    const value = skillInput.trim();
    if (!value || skills.some(skill => skill.toLowerCase() === value.toLowerCase())) return setSkillInput('');
    setSkills(current => [...current, value]);
    setSkillInput('');
  }

  async function saveSkills() {
    setSavingSkills(true);
    try {
      const { data } = await client.patch('/profile', { skills });
      updateProfileLocally(data.profile || data);
      showToast('Skills saved', 'success');
    } catch {
      showToast('Could not save skills. Try again.', 'error');
    } finally { setSavingSkills(false); }
  }

  async function uploadAttachment(file) {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(ext)) return setUploadError('Use a PDF, DOCX, or TXT file.');
    setUploading(true);
    setUploadError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await client.post('/profile/attachments', form);
      setAttachments(current => [data, ...current.map(item => ({ ...item, isPrimary: false }))]);
      showToast('Resume uploaded and ready for matching', 'success');
    } catch (error) {
      setUploadError(error?.response?.data?.message || 'Upload failed. Try again.');
    } finally { setUploading(false); }
  }

  async function downloadAttachment(attachment) {
    try {
      const { data } = await client.get(`/profile/attachments/${attachment.id}/download`, { responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.filename || 'resume';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch { showToast('Could not download this file.', 'error'); }
  }

  async function selectAttachment(attachment) {
    if (!attachment?.id || attachment.isPrimary || selectingAttachmentId || deletingAttachmentId) return;
    setSelectingAttachmentId(attachment.id);
    try {
      await client.post(`/profile/attachments/${encodeURIComponent(attachment.id)}/select`);
      setAttachments(current => current.map(item => ({ ...item, isPrimary: item.id === attachment.id })));
      showToast('Resume selected for matching.', 'success');
    } catch (error) {
      showToast(error?.response?.data?.message || 'Could not select this resume.', 'error');
    } finally {
      setSelectingAttachmentId(null);
    }
  }

  async function deleteAttachment(attachment) {
    if (!attachment?.id || deletingAttachmentId || selectingAttachmentId) return;
    const filename = attachment.filename || 'this resume';
    if (!window.confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    setDeletingAttachmentId(attachment.id);
    try {
      const { data } = await client.delete(`/profile/attachments/${encodeURIComponent(attachment.id)}`);
      const nextPrimaryId = data?.primaryId || null;
      setAttachments(current => current
        .filter(item => item.id !== attachment.id)
        .map(item => ({
          ...item,
          isPrimary: nextPrimaryId ? item.id === nextPrimaryId : (attachment.isPrimary ? false : item.isPrimary),
        })));
      showToast('Resume deleted.', 'success');
    } catch (error) {
      showToast(error?.response?.data?.message || 'Could not delete this resume.', 'error');
    } finally {
      setDeletingAttachmentId(null);
    }
  }

  async function saveLinks(event) {
    event.preventDefault();
    setSavingLinks(true);
    try {
      const { data } = await client.patch('/profile', { links: links || {} });
      updateProfileLocally(data.profile || data);
      setEditingLinks(false);
      showToast('Profile links saved', 'success');
    } catch {
      showToast('Could not save links. Try again.', 'error');
    } finally { setSavingLinks(false); }
  }

  return (
    <div className="home-feed-side-tools" aria-label="Feed and account tools">
      {showSources && <ToolPanel
        className="home-feed-source-panel"
        title="Feed sources"
        summary={availableSources.length ? `${enabledSourceCount} of ${availableSources.length} on` : 'Personalized for you'}
        open={openPanel === 'sources'}
        onToggle={() => toggle('sources')}
      >
        <DirectoryControls label="feed sources" filter={sourceCategory} onFilterChange={setSourceCategory}
          options={[["favorites", "Favorites"], ...SOURCE_CATEGORIES]} />
        <div className="home-feed-source-actions" aria-label="Current category source controls">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAllSources(true)} disabled={savingSourceId !== null || visibleEnabledCount === visibleSources.length}>
            {savingSourceId === '__all__' ? 'Saving...' : 'Enable all'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAllSources(false)} disabled={savingSourceId !== null || visibleEnabledCount === 0}>
            {savingSourceId === '__all__' ? 'Saving...' : 'Disable all'}
          </button>
        </div>
        <div className="home-feed-source-list" aria-label="Feed source controls">
          {sourceGroups.map(section => <div key={section.id} className="source-directory-section">
            <h4 className="source-directory-heading">{section.label}<span>{section.items.length}</span></h4>
          {section.items.map(source => {
            const enabled = !disabledSources.has(source);
            const saving = savingSourceId === source;
            return (
              <div className={`home-feed-source-row${enabled ? '' : ' is-off'}`} key={source}>
                <SourceMark source={source} />
                <span className="home-feed-source-name">{SOURCE_META[source]?.label || source}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${enabled ? 'Turn off' : 'Turn on'} ${SOURCE_META[source]?.label || source}`}
                  disabled={savingSourceId !== null}
                  className={`home-feed-source-toggle${enabled ? ' is-on' : ''}`}
                  onClick={() => toggleSource(source)}
                >
                  <span className="home-feed-source-toggle-track" aria-hidden="true"><span /></span>
                  <span>{saving ? 'Saving' : enabled ? 'On' : 'Off'}</span>
                </button>
              </div>
            );
          })}
          </div>)}
          {!sourceGroups.length && <div className="source-directory-empty" role="status">No matching sources</div>}
        </div>
        <UnavailableFeedSources mode={favoriteMode} category={sourceCategory} plan={profile?.plan} />
      </ToolPanel>}

      {showAccounts && <ToolPanel title="Connected accounts" open={openPanel === 'accounts'} onToggle={() => toggle('accounts')}>
        <div className="home-connected-account-list" aria-label="Connected account controls">
          {accountPlatforms === null && <div className="home-connected-account-loading"><span className="spinner spinner-primary" /></div>}
          {accountError && (
            <div className="home-connected-account-error" role="alert">
              <span>{accountError}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={reloadAccounts}>Retry</button>
            </div>
          )}
          {accountPlatforms !== null && !!accountGroups.length && <AccountCategoryNavigation sections={accountGroups} category={accountCategory} onChange={setAccountCategory} compact />}
          {accountPlatforms !== null && displayedAccountGroups.map(section => (
            <section className="home-account-category" key={section.id} aria-label={`${section.label} accounts`}>
              <div className="home-account-category-heading">
                <h4>{section.label}</h4>
              </div>
              {section.id === 'location' && <AccountLocationNotice ranking={locationRanking} count={section.total} />}
              <AccountLocationGroups section={section} headingLevel={5}>{([key, platform]) => {
                const isConnected = platform.connectionMode !== 'external' && accountConnected[key] === true;
                const isConnecting = accountAction === `connect:${key}`;
                const isDisconnecting = accountAction === `disconnect:${key}`;
                return (
                  <div className="home-connected-account-row" key={key}>
                    <SourceMark source={key} />
                    <span className="home-connected-account-name">
                      {platform.name || SOURCE_META[key]?.label || key}
                    </span>
                    <div className="source-directory-account-actions">
                      {isConnected ? <>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => disconnectAccount(key)} disabled={accountAction !== null}>
                          {isDisconnecting ? 'Wait...' : 'Disconnect'}
                        </button>
                        <AccountSiteLink platform={key} name={platform.name} siteUrl={platform.siteUrl} className="account-connection-site-link" />
                      </> : (
                        <AccountConnectionAction platformKey={key} platform={platform} onConnect={() => connectAccount(key)}
                          connecting={isConnecting} disabled={accountAction !== null} className="btn btn-primary btn-sm" compact />
                      )}
                    </div>
                  </div>
                );
              }}</AccountLocationGroups>
            </section>
          ))}
          {accountPlatforms !== null && !accountError && accountGroups.length === 0 && (
            <div className="home-connected-account-empty" role="status">{visibleAccountPlatforms.length ? 'No matching accounts' : 'No account connections are available yet.'}</div>
          )}
          {blueskyHandle !== null && (
            <form className="home-connected-account-handle" onSubmit={event => {
              event.preventDefault();
              if (!blueskyHandle.trim()) return;
              const handle = blueskyHandle;
              setBlueskyHandle(null);
              startAccountConnection('bluesky', handle);
            }}>
              <input className="form-input" autoFocus value={blueskyHandle} onChange={event => setBlueskyHandle(event.target.value)} placeholder="name.bsky.social" />
              <button type="submit" className="btn btn-primary btn-sm account-icon-action" disabled={!blueskyHandle.trim()} aria-label="Sign in & connect" title="Sign in and connect Bluesky"><AccountActionIcon platform="bluesky" /></button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBlueskyHandle(null)}>Cancel</button>
            </form>
          )}
        </div>
      </ToolPanel>}

      {showSkills && <ToolPanel title="Skills" summary={skills.length ? `${skills.length} saved` : 'Add your skills'} open={openPanel === 'skills'} onToggle={() => toggle('skills')}>
        {skills.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {skills.map(skill => <span key={skill} className="tag tag-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '.76rem' }}>
            {skill}<button type="button" aria-label={`Remove ${skill}`} onClick={() => setSkills(current => current.filter(item => item !== skill))} style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}>x</button>
          </span>)}
        </div>}
        <div style={{ display: 'flex', gap: 7 }}>
          <input className="form-input" value={skillInput} placeholder="Add a skill" onChange={event => setSkillInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addSkill(); } }} style={{ minWidth: 0, flex: 1 }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={addSkill}>Add</button>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={saveSkills} disabled={savingSkills} style={{ marginTop: 9 }}>{savingSkills ? 'Saving...' : 'Save skills'}</button>
      </ToolPanel>}

      {showAttachments && <ToolPanel title="Attachments" summary={attachments.length ? `${attachments.length} saved` : 'Resumes and links'} open={openPanel === 'files'} onToggle={() => toggle('files')}>
        <label style={{ display: 'flex', alignItems: 'center', padding: '9px 10px', border: '1px dashed var(--border)', borderRadius: 6, cursor: uploading ? 'default' : 'pointer', color: 'var(--muted)', fontSize: '.8rem' }}>
          {uploading ? 'Uploading...' : 'Upload resume'}
          <input type="file" accept=".pdf,.docx,.txt" disabled={uploading} style={{ display: 'none' }} onChange={event => { const file = event.target.files[0]; event.target.value = ''; uploadAttachment(file); }} />
        </label>
        {uploadError && <div className="auth-error" style={{ marginTop: 8 }}>{uploadError}</div>}
        {attachmentsLoading ? <div style={{ padding: '12px 0', textAlign: 'center' }}><span className="spinner spinner-primary" /></div> : attachments.map(attachment => {
          const score = scoreStyle(attachment.atsScore);
          const selecting = selectingAttachmentId === attachment.id;
          const deleting = deletingAttachmentId === attachment.id;
          return <div key={attachment.id} style={{ marginTop: 8, padding: 8, border: '1px solid var(--border)', borderRadius: 6, background: attachment.isPrimary ? 'var(--primary-light)' : 'var(--card)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: '.78rem' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: attachment.isPrimary ? 700 : 500 }}>{attachment.filename}</span>
              {Number.isFinite(Number(attachment.atsScore)) && <span style={{ color: score.color, background: score.background, border: `1px solid ${score.border}`, padding: '2px 5px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>{attachment.atsScore}/100</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 7 }}>
              <button
                type="button"
                className={`btn btn-sm${attachment.isPrimary ? ' btn-primary' : ' btn-ghost'}`}
                onClick={() => selectAttachment(attachment)}
                disabled={attachment.isPrimary || selectingAttachmentId !== null || deletingAttachmentId !== null}
                title={attachment.isPrimary ? 'Used for job matching' : 'Use this resume for job matching'}
                style={{ padding: '4px 7px' }}
              >
                {selecting ? <span className="spinner" style={{ width: 11, height: 11 }} /> : attachment.isPrimary ? 'Selected' : 'Use'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadAttachment(attachment)} disabled={selectingAttachmentId !== null || deletingAttachmentId !== null} style={{ padding: '4px 7px' }}>Get</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteAttachment(attachment)} disabled={selectingAttachmentId !== null || deletingAttachmentId !== null} style={{ padding: '4px 7px' }}>
                {deleting ? <span className="spinner" style={{ width: 11, height: 11 }} /> : 'Delete'}
              </button>
            </div>
          </div>;
        })}
        {!editingLinks ? <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLinks({ ...(profile?.links || {}) }); setEditingLinks(true); }} style={{ marginTop: 10 }}>Edit links</button> : (
          <form onSubmit={saveLinks} style={{ marginTop: 12 }}>
            {LINK_FIELDS.map(field => <div className="form-group" key={field.key} style={{ marginBottom: 8 }}><label className="form-label">{field.label}</label><input className="form-input" type="url" value={links?.[field.key] || ''} placeholder={field.placeholder} onChange={event => setLinks(current => ({ ...current, [field.key]: event.target.value }))} /></div>)}
            <div style={{ display: 'flex', gap: 7 }}><button className="btn btn-primary btn-sm" disabled={savingLinks}>{savingLinks ? 'Saving...' : 'Save links'}</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditingLinks(false)}>Cancel</button></div>
          </form>
        )}
      </ToolPanel>}

    </div>
  );
}
