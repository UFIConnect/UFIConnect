import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { useAuth } from '../contexts/AuthContext';
import client from '../api/client';

function coverLetterTemplate(format) {
  return {
    modern: { fontFamily: 'Arial, sans-serif', accent: '#102A6B', header: '#102A6B', text: '#172033' },
    classic: { fontFamily: 'Georgia, serif', accent: '#172033', header: '#FFFFFF', text: '#172033' },
    minimal: { fontFamily: 'Arial, sans-serif', accent: '#4B5563', header: '#FFFFFF', text: '#172033' },
  }[format] || { fontFamily: 'Arial, sans-serif', accent: '#102A6B', header: '#102A6B', text: '#172033' };
}

export default function CoverLetterPreview() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (!profile?.resumeBuilderAddon) return undefined;
    let cancelled = false;
    client.get('/resume-builder/draft')
      .then(({ data }) => {
        if (!cancelled) setDraft(data?.data || {});
      })
      .catch(() => {
        if (!cancelled) setDraft({});
      });
    return () => { cancelled = true; };
  }, [profile?.resumeBuilderAddon]);

  const contact = draft?.contact || {};
  const letter = draft?.coverLetter || {};
  const format = ['modern', 'classic', 'minimal'].includes(letter.format) ? letter.format : 'modern';
  const template = coverLetterTemplate(format);
  const contactLine = [contact.email, contact.phone, contact.location].filter(Boolean).join(' | ');

  return (
    <>
      <Helmet><title>Cover Letter Preview | UFIconnect</title></Helmet>
      <Layout>
        <div style={{ width: 'min(100%, 900px)', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
            <button type="button" className="btn-back" onClick={() => navigate('/resume-builder?tab=cover-letter')}>
              <span className="btn-back-icon" aria-hidden="true">&#8249;</span> Back to cover letter
            </button>
            <span style={{ color: 'var(--muted)', fontSize: '.8rem' }}>Cover letter preview</span>
          </div>

          {!profile ? (
            <div className="empty-state"><span className="spinner spinner-primary" /></div>
          ) : !profile.resumeBuilderAddon ? (
            <div className="card" style={{ textAlign: 'center', padding: 36 }}>Resume Builder access is required to view this cover letter.</div>
          ) : draft === null ? (
            <div className="empty-state"><span className="spinner spinner-primary" /></div>
          ) : !String(letter.body || '').trim() ? (
            <div className="card" style={{ textAlign: 'center', padding: 36 }}>Draft a cover letter before opening its preview page.</div>
          ) : (
            <article style={{ minHeight: 'calc(100dvh - 210px)', background: '#fff', color: template.text, boxShadow: '0 8px 24px rgb(15 23 42 / 14%)', fontFamily: template.fontFamily, overflow: 'hidden' }}>
              <header style={{ minHeight: 118, padding: '30px clamp(24px, 6vw, 58px)', background: template.header, borderTop: format === 'minimal' ? '1px solid #D1D5DB' : 'none', borderBottom: format === 'classic' ? '5px solid #172033' : 'none', color: format === 'modern' ? '#fff' : '#172033', textAlign: format === 'classic' ? 'center' : 'left' }}>
                <h1 style={{ margin: 0, fontSize: '1.75rem', color: 'inherit' }}>{contact.name || 'Your name'}</h1>
                {contact.title && <p style={{ margin: '6px 0 0', fontSize: '.92rem', opacity: .78 }}>{contact.title}</p>}
                {contactLine && <p style={{ margin: '10px 0 0', fontSize: '.76rem', opacity: .78 }}>{contactLine}</p>}
              </header>
              <div style={{ padding: 'clamp(28px, 6vw, 64px)', maxWidth: 760, margin: '0 auto' }}>
                <div style={{ color: template.accent, fontSize: '.78rem', fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', marginBottom: 18 }}>Cover letter</div>
                <h2 style={{ margin: '0 0 6px', fontSize: '1.15rem', color: template.text }}>{letter.role || 'Role'}</h2>
                {letter.company && <p style={{ margin: '0 0 28px', color: 'var(--muted)', fontSize: '.9rem' }}>{letter.company}</p>}
                <div style={{ whiteSpace: 'pre-wrap', fontSize: '1rem', lineHeight: 1.8 }}>{letter.body}</div>
              </div>
            </article>
          )}
        </div>
      </Layout>
    </>
  );
}
