import { EMAIL_TEMPLATES } from './office-email-templates.mjs';

export default function EmailTemplatePicker({ value, onChange, disabled }) {
  const chosen = EMAIL_TEMPLATES.find(template => template.id === value);
  return <div className="ou-email-template"><label>Email template<select aria-label="Email template" value={value} disabled={disabled} onChange={event => onChange(EMAIL_TEMPLATES.find(template => template.id === event.target.value) || null)}><option value="">Write a custom message</option>{[...new Set(EMAIL_TEMPLATES.map(template => template.group))].map(group => <optgroup key={group} label={group}>{EMAIL_TEMPLATES.filter(template => template.group === group).map(template => <option key={template.id} value={template.id}>{template.label}</option>)}</optgroup>)}</select></label>{chosen?.requiresVerifiedFacts && <p className="ou-warning">Use this notice only when the facts have been verified. Replace every bracketed field with confirmed information before sending.</p>}</div>;
}
