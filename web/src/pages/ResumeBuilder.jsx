import { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import Layout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import client from '../api/client';

const TEMPLATES = [
  { key: 'modern',  label: 'Modern',  desc: 'Colored header band, clean sections.' },
  { key: 'minimal', label: 'Minimal', desc: 'Plain black-on-white, no color.' },
];

function emptyDraft() {
  return {
    contact: { name: '', title: '', email: '', phone: '', location: '', links: [] },
    summary: '',
    experience: [],
    education: [],
    skills: [],
    coverLetter: { role: '', company: '', jobDescription: '', tone: 'Warm and professional', body: '' },
    outreach: { recipientName: '', recipientRole: '', company: '', context: '', tone: 'Warm and professional', body: '' },
  };
}

function normalizeDraft(draft) {
  const base = emptyDraft();
  const next = draft && typeof draft === 'object' ? draft : {};
  return {
    ...base,
    ...next,
    contact: { ...base.contact, ...(next.contact || {}) },
    experience: Array.isArray(next.experience) ? next.experience : base.experience,
    education: Array.isArray(next.education) ? next.education : base.education,
    skills: Array.isArray(next.skills) ? next.skills : base.skills,
    coverLetter: { ...base.coverLetter, ...(next.coverLetter || {}) },
    outreach: { ...base.outreach, ...(next.outreach || {}) },
  };
}

function priceCadence(price) {
  if (!price?.interval) return '';
  const count = Math.max(1, Number(price.intervalCount) || 1);
  return count === 1 ? ` / ${price.interval}` : ` every ${count} ${price.interval}s`;
}

function LockedState({ onUnlock, unlocking, billingReady, price }) {
  const priceLabel = price?.active && price?.matchesRequiredPrice && price?.display ? price.display + priceCadence(price) : null;
  return (
    <div className="card" style={{ textAlign: 'center', padding: '52px 24px' }}>
      <h2 style={{ fontSize: '1.15rem', fontWeight: 800, margin: '0 0 8px' }}>Resume Builder</h2>
      <p style={{ color: 'var(--muted)', fontSize: '.88rem', maxWidth: 440, margin: '0 auto 22px', lineHeight: 1.6 }}>
        Build an ATS-friendly resume from scratch with original templates, AI-assisted writing help,
        and a one-click PDF export that's automatically scored and saved to your profile.
      </p>
      <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, marginBottom: 18, fontSize: '.86rem' }}>
        <span style={{ color: 'var(--muted)' }}>Resume Builder add-on</span>
        <strong>{priceLabel || 'Price shown at checkout'}</strong>
      </div>
      <button className="btn btn-primary" type="button" onClick={onUnlock} disabled={unlocking || billingReady === false}>
        {unlocking ? <span className="spinner" style={{ width: 14, height: 14 }} /> : billingReady === false ? 'Billing unavailable' : priceLabel ? `Unlock for ${priceLabel}` : 'Unlock Resume Builder'}
      </button>
    </div>
  );
}

function AIAssistButton({ onResult, field, context, label = 'AI Assist' }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!context?.trim() || loading) return;
    setLoading(true);
    try {
      const { data } = await client.post('/resume-builder/ai-assist', { field, context });
      onResult(data.suggestion || '');
    } catch (err) {
      showToast(err?.response?.data?.message || 'Could not generate a suggestion.', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={run} disabled={loading || !context?.trim()}>
      {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : label}
    </button>
  );
}

function Field({ label, ...props }) {
  return (
    <div style={{ flex: 1, minWidth: 140 }}>
      <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{label}</label>
      <input className="form-input" style={{ fontSize: '.85rem', padding: '8px 10px' }} {...props} />
    </div>
  );
}

export default function ResumeBuilder() {
  const { profile, refreshProfile } = useAuth();
  const { showToast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [billingReady, setBillingReady] = useState(null);
  const [resumeBuilderPrice, setResumeBuilderPrice] = useState(null);
  const [unlocking, setUnlocking] = useState(false);
  const [template, setTemplate] = useState('modern');
  const [data, setData] = useState(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [drafting, setDrafting] = useState(null);

  const unlocked = !!profile?.resumeBuilderAddon;

  useEffect(() => {
    let cancelled = false;
    client.get('/billing/config')
      .then(({ data: config }) => {
        if (cancelled) return;
        const price = config?.pricing?.resume_builder || null;
        setResumeBuilderPrice(price);
        setBillingReady(!!config?.stripeConfigured && !!config?.webhookConfigured && !!config?.tiers?.resume_builder && price?.matchesRequiredPrice === true);
      })
      .catch(() => {
        if (!cancelled) setBillingReady(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const upgrade = new URLSearchParams(window.location.search).get('upgrade');
    if (!upgrade) return;
    window.history.replaceState({}, '', window.location.pathname);
    if (upgrade === 'cancelled') {
      showToast('Checkout cancelled - no charge was made.', 'info');
      return;
    }
    refreshProfile()
      .then((nextProfile) => {
        showToast(nextProfile?.resumeBuilderAddon
          ? 'Resume Builder is unlocked.'
          : 'Payment received. Resume Builder will unlock in a moment.', 'success');
      })
      .catch(() => showToast('Payment received. Refresh in a moment if access has not appeared yet.', 'success'));
  }, [refreshProfile, showToast]);

  useEffect(() => {
    if (!unlocked) return;
    client.get('/resume-builder/draft')
      .then(({ data: res }) => {
        setTemplate(res.template || 'modern');
        setData(normalizeDraft(res.data));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [unlocked]);

  async function unlockResumeBuilder() {
    if (unlocking) return;
    setUnlocking(true);
    try {
      const { data: checkout } = await client.post('/billing/create-checkout-session', { tier: 'resume_builder' });
      window.location.assign(checkout.url);
    } catch (err) {
      showToast(err?.response?.data?.message || 'Could not start checkout. Please try again.', 'error');
      setUnlocking(false);
    }
  }

  async function saveDraft(nextData = data, successMessage = 'All changes saved.') {
    setSaving(true);
    try {
      await client.put('/resume-builder/draft', { template, data: nextData });
      showToast(successMessage, 'success');
      return true;
    } catch (err) {
      showToast(err?.response?.data?.message || 'Could not save your draft.', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setExportResult(null);
    try {
      await client.put('/resume-builder/draft', { template, data });
      const { data: res } = await client.post('/resume-builder/export', { template, data });
      setExportResult(res);
    } catch (err) {
      showToast(err?.response?.data?.message || 'Could not export your resume.', 'error');
    } finally {
      setExporting(false);
    }
  }

  function setContact(field, value) {
    setData(prev => ({ ...prev, contact: { ...prev.contact, [field]: value } }));
  }

  function addExperience() {
    setData(prev => ({ ...prev, experience: [...prev.experience, { company: '', role: '', location: '', startDate: '', endDate: '', current: false, bullets: [''] }] }));
  }
  function updateExperience(i, field, value) {
    setData(prev => ({ ...prev, experience: prev.experience.map((job, idx) => idx === i ? { ...job, [field]: value } : job) }));
  }
  function removeExperience(i) {
    setData(prev => ({ ...prev, experience: prev.experience.filter((_, idx) => idx !== i) }));
  }
  function addBullet(i) {
    setData(prev => ({ ...prev, experience: prev.experience.map((job, idx) => idx === i ? { ...job, bullets: [...job.bullets, ''] } : job) }));
  }
  function updateBullet(i, bi, value) {
    setData(prev => ({ ...prev, experience: prev.experience.map((job, idx) => idx === i ? { ...job, bullets: job.bullets.map((b, bidx) => bidx === bi ? value : b) } : job) }));
  }
  function removeBullet(i, bi) {
    setData(prev => ({ ...prev, experience: prev.experience.map((job, idx) => idx === i ? { ...job, bullets: job.bullets.filter((_, bidx) => bidx !== bi) } : job) }));
  }

  function addEducation() {
    setData(prev => ({ ...prev, education: [...prev.education, { school: '', degree: '', field: '', startDate: '', endDate: '' }] }));
  }
  function updateEducation(i, field, value) {
    setData(prev => ({ ...prev, education: prev.education.map((ed, idx) => idx === i ? { ...ed, [field]: value } : ed) }));
  }
  function removeEducation(i) {
    setData(prev => ({ ...prev, education: prev.education.filter((_, idx) => idx !== i) }));
  }

  function updateWriting(section, field, value) {
    setData(prev => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
  }

  async function generateApplicationDraft(type) {
    if (drafting) return;
    const section = type === 'cover_letter' ? 'coverLetter' : 'outreach';
    const writing = data[section];
    setDrafting(type);
    try {
      const payload = type === 'cover_letter'
        ? {
          type,
          resume: data,
          role: writing.role,
          company: writing.company,
          jobDescription: writing.jobDescription,
          tone: writing.tone,
        }
        : {
          type,
          resume: data,
          recipientName: writing.recipientName,
          recipientRole: writing.recipientRole,
          company: writing.company,
          context: writing.context,
          tone: writing.tone,
        };
      const { data: response } = await client.post('/resume-builder/application-draft', payload);
      const body = String(response?.draft || '').trim();
      if (!body) throw new Error('No draft was returned.');
      const nextData = { ...data, [section]: { ...writing, body } };
      setData(nextData);
      const label = type === 'cover_letter' ? 'Cover letter' : 'Outreach message';
      const saved = await saveDraft(nextData, `${label} drafted and saved.`);
      if (!saved) showToast(`${label} is ready here. Save it once storage is available.`, 'info');
    } catch (err) {
      showToast(err?.response?.data?.message || err.message || 'Could not generate a draft.', 'error');
    } finally {
      setDrafting(null);
    }
  }

  async function copyWriting(text, label) {
    const value = String(text || '').trim();
    if (!value) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement('textarea');
        input.value = value;
        input.style.position = 'fixed';
        input.style.opacity = '0';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        if (!copied) throw new Error('Copy was blocked.');
      }
      showToast(`${label} copied.`, 'success');
    } catch {
      showToast('Copy was blocked. Select the text and copy it manually.', 'error');
    }
  }

  return (
    <>
      <Helmet><title>Resume Builder | UFIconnect</title></Helmet>
      <Layout>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            Resume Builder
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '.85rem', margin: '4px 0 0' }}>
            Original templates. AI-assisted writing. Exports straight into your Attachments with an ATS score.
          </p>
        </div>

        {!profile ? (
          <div className="empty-state"><span className="spinner spinner-primary" /></div>
        ) : !unlocked ? (
          <LockedState onUnlock={unlockResumeBuilder} unlocking={unlocking} billingReady={billingReady} price={resumeBuilderPrice} />
        ) : !loaded ? (
          <div className="empty-state"><span className="spinner spinner-primary" /></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 760 }}>
            <div className="card">
              <div style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Template</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {TEMPLATES.map(t => (
                  <button
                    key={t.key} type="button" onClick={() => setTemplate(t.key)}
                    className="btn btn-sm"
                    style={{ background: template === t.key ? 'var(--primary)' : 'var(--bg-secondary)', color: template === t.key ? '#fff' : 'var(--text)', border: 'none' }}
                    title={t.desc}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <h3 style={{ margin: '0 0 12px', fontSize: '.9rem' }}>Contact</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                <Field label="Full name" value={data.contact.name} onChange={e => setContact('name', e.target.value)} />
                <Field label="Title" value={data.contact.title} onChange={e => setContact('title', e.target.value)} placeholder="e.g. Senior Product Designer" />
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <Field label="Email" value={data.contact.email} onChange={e => setContact('email', e.target.value)} />
                <Field label="Phone" value={data.contact.phone} onChange={e => setContact('phone', e.target.value)} />
                <Field label="Location" value={data.contact.location} onChange={e => setContact('location', e.target.value)} />
              </div>
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <h3 style={{ margin: 0, fontSize: '.9rem' }}>Summary</h3>
                <AIAssistButton
                  field="summary"
                  context={data.summary || `${data.contact.title || 'professional'} with experience in ${(data.skills || []).slice(0, 5).join(', ') || 'their field'}`}
                  onResult={s => setData(prev => ({ ...prev, summary: s }))}
                />
              </div>
              <textarea
                value={data.summary} onChange={e => setData(prev => ({ ...prev, summary: e.target.value }))}
                rows={3} placeholder="2-3 sentence professional summary..."
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: '.85rem', fontFamily: 'inherit', resize: 'vertical' }}
              />
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: '.9rem' }}>Experience</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addExperience}>+ Add</button>
              </div>
              {data.experience.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '.82rem', margin: 0 }}>No experience added yet.</p>}
              {data.experience.map((job, i) => (
                <div key={i} style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)', marginBottom: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <Field label="Role" value={job.role} onChange={e => updateExperience(i, 'role', e.target.value)} />
                    <Field label="Company" value={job.company} onChange={e => updateExperience(i, 'company', e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <Field label="Location" value={job.location} onChange={e => updateExperience(i, 'location', e.target.value)} />
                    <Field label="Start" placeholder="e.g. 2021" value={job.startDate} onChange={e => updateExperience(i, 'startDate', e.target.value)} />
                    <Field label="End" placeholder="e.g. 2023" value={job.endDate} disabled={job.current} onChange={e => updateExperience(i, 'endDate', e.target.value)} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.78rem', color: 'var(--muted)', marginTop: 20 }}>
                      <input type="checkbox" checked={!!job.current} onChange={e => updateExperience(i, 'current', e.target.checked)} /> Current
                    </label>
                  </div>
                  <div style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>Bullet points</div>
                  {job.bullets.map((b, bi) => (
                    <div key={bi} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                      <input
                        className="form-input" style={{ fontSize: '.83rem', padding: '7px 10px' }}
                        value={b} onChange={e => updateBullet(i, bi, e.target.value)}
                        placeholder="e.g. led a redesign that increased signups 18%"
                      />
                      <AIAssistButton field="bullets" context={b} label="AI" onResult={s => updateBullet(i, bi, s)} />
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeBullet(i, bi)}>Remove</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => addBullet(i)}>+ Bullet</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeExperience(i)} style={{ color: '#DC2626' }}>Remove role</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: '.9rem' }}>Education</h3>
                <button type="button" className="btn btn-ghost btn-sm" onClick={addEducation}>+ Add</button>
              </div>
              {data.education.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '.82rem', margin: 0 }}>No education added yet.</p>}
              {data.education.map((ed, i) => (
                <div key={i} style={{ padding: 14, borderRadius: 10, border: '1px solid var(--border)', marginBottom: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <Field label="School" value={ed.school} onChange={e => updateEducation(i, 'school', e.target.value)} />
                    <Field label="Degree" value={ed.degree} onChange={e => updateEducation(i, 'degree', e.target.value)} placeholder="e.g. B.S." />
                    <Field label="Field of study" value={ed.field} onChange={e => updateEducation(i, 'field', e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <Field label="Start" value={ed.startDate} onChange={e => updateEducation(i, 'startDate', e.target.value)} />
                    <Field label="End" value={ed.endDate} onChange={e => updateEducation(i, 'endDate', e.target.value)} />
                  </div>
                  <div style={{ textAlign: 'right', marginTop: 8 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeEducation(i)} style={{ color: '#DC2626' }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <h3 style={{ margin: '0 0 8px', fontSize: '.9rem' }}>Skills</h3>
              <input
                className="form-input" style={{ fontSize: '.85rem' }}
                value={data.skills.join(', ')}
                onChange={e => setData(prev => ({ ...prev, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                placeholder="Comma-separated, e.g. React, Figma, SQL"
              />
            </div>

            <div className="card">
              <div style={{ marginBottom: 16 }}>
                <h3 style={{ margin: '0 0 4px', fontSize: '.95rem' }}>Application writing</h3>
                <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--muted)', lineHeight: 1.5 }}>
                  Draft from the resume above, then edit the result. Each generated draft is saved with your resume.
                </p>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 22 }}>
                <div style={{ minWidth: 0 }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: '.86rem' }}>Cover letter</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <Field label="Role" value={data.coverLetter.role} onChange={e => updateWriting('coverLetter', 'role', e.target.value)} placeholder="e.g. Product Designer" />
                    <Field label="Company" value={data.coverLetter.company} onChange={e => updateWriting('coverLetter', 'company', e.target.value)} />
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tone</label>
                    <select className="form-input" value={data.coverLetter.tone} onChange={e => updateWriting('coverLetter', 'tone', e.target.value)} style={{ fontSize: '.85rem', padding: '8px 10px' }}>
                      <option>Warm and professional</option>
                      <option>Confident and direct</option>
                      <option>Thoughtful and conversational</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Job description</label>
                    <textarea
                      value={data.coverLetter.jobDescription}
                      onChange={e => updateWriting('coverLetter', 'jobDescription', e.target.value)}
                      rows={4}
                      placeholder="Paste the responsibilities or a few details to tailor the letter."
                      style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: '.84rem', fontFamily: 'inherit', resize: 'vertical' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button className="btn btn-primary btn-sm" type="button" onClick={() => generateApplicationDraft('cover_letter')} disabled={!!drafting}>
                      {drafting === 'cover_letter' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Draft cover letter'}
                    </button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => copyWriting(data.coverLetter.body, 'Cover letter')} disabled={!data.coverLetter.body}>Copy</button>
                  </div>
                  <textarea
                    value={data.coverLetter.body}
                    onChange={e => updateWriting('coverLetter', 'body', e.target.value)}
                    rows={11}
                    placeholder="Your cover letter will appear here."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: '.85rem', fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical' }}
                  />
                </div>

                <div style={{ minWidth: 0 }}>
                  <h4 style={{ margin: '0 0 12px', fontSize: '.86rem' }}>Reach-out message</h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <Field label="Recipient" value={data.outreach.recipientName} onChange={e => updateWriting('outreach', 'recipientName', e.target.value)} placeholder="e.g. Alex Morgan" />
                    <Field label="Their role" value={data.outreach.recipientRole} onChange={e => updateWriting('outreach', 'recipientRole', e.target.value)} placeholder="e.g. Design Director" />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    <Field label="Company" value={data.outreach.company} onChange={e => updateWriting('outreach', 'company', e.target.value)} />
                    <div style={{ flex: 1, minWidth: 140 }}>
                      <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Tone</label>
                      <select className="form-input" value={data.outreach.tone} onChange={e => updateWriting('outreach', 'tone', e.target.value)} style={{ fontSize: '.85rem', padding: '8px 10px' }}>
                        <option>Warm and professional</option>
                        <option>Confident and direct</option>
                        <option>Thoughtful and conversational</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <label style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Why you are reaching out</label>
                    <textarea
                      value={data.outreach.context}
                      onChange={e => updateWriting('outreach', 'context', e.target.value)}
                      rows={4}
                      placeholder="For example: their product talk stood out, and you would value a short conversation about the team."
                      style={{ width: '100%', padding: '9px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: '.84rem', fontFamily: 'inherit', resize: 'vertical' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <button className="btn btn-primary btn-sm" type="button" onClick={() => generateApplicationDraft('outreach')} disabled={!!drafting}>
                      {drafting === 'outreach' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : 'Draft message'}
                    </button>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => copyWriting(data.outreach.body, 'Reach-out message')} disabled={!data.outreach.body}>Copy</button>
                  </div>
                  <textarea
                    value={data.outreach.body}
                    onChange={e => updateWriting('outreach', 'body', e.target.value)}
                    rows={11}
                    placeholder="Your reach-out message will appear here."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: '.85rem', fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" type="button" onClick={() => saveDraft()} disabled={saving}>
                {saving ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Save all changes'}
              </button>
              <button className="btn btn-primary" type="button" onClick={handleExport} disabled={exporting || !data.contact.name}>
                {exporting ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Export PDF'}
              </button>
            </div>

            {exportResult && (
              <div className="card" style={{ background: 'var(--primary-light)', border: '1px solid var(--primary)' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Exported - ATS score {exportResult.atsScore}/100</div>
                <p style={{ margin: 0, fontSize: '.82rem', color: 'var(--muted)' }}>
                    Saved to your Attachments as your primary resume. Visit Profile attachments to review, re-select, or download it.
                </p>
              </div>
            )}
          </div>
        )}
      </Layout>
    </>
  );
}
