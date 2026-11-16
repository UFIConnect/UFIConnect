import { useId } from 'react';

export default function BirthDateField({ value, onChange, disabled }) {
  const id = useId();
  return <div className="form-group">
    <label className="form-label" htmlFor={id}>Date of birth</label>
    <input id={id} className="form-input" name="birthDate" type="date"
      autoComplete="bday" value={value} onChange={onChange} disabled={disabled}
      max={new Date().toISOString().slice(0, 10)} required />
  </div>;
}
