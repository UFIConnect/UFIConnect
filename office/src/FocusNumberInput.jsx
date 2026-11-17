import { useState } from 'react';

export default function FocusNumberInput({ value, min, max, onChange, ...props }) {
  const [draft, setDraft] = useState(null);
  return <input {...props} type="number" min={min} max={max} step="1" value={draft ?? value}
    onChange={event => setDraft(event.target.value)}
    onBlur={event => {
      const input = event.currentTarget.valueAsNumber;
      setDraft(null);
      if (Number.isFinite(input) && input !== value) onChange(Math.min(max, Math.max(min, Math.round(input))));
    }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />;
}
