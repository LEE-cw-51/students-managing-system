'use client';

import { useEffect, useState } from 'react';
import { normalizeTime } from '@/lib/time';

/**
 * Typed time entry: "1800" → 18:00 on blur. Calls onChange with "HH:MM" or '' and
 * reports invalid text through onInvalid(true/false) so the form can block saving.
 */
export default function TimeInput({ value, onChange, onInvalid, id, label, placeholder = '0000' }) {
  const [text, setText] = useState(value || '');
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value || '');
    setBad(false);
  }, [value]);
  const commit = () => {
    const t = normalizeTime(text);
    if (t === null) {
      setBad(true);
      onInvalid?.(true);
      return;
    }
    setBad(false);
    onInvalid?.(false);
    setText(t);
    if (t !== (value || '')) onChange(t);
  };
  return (
    <input
      id={id}
      className="time-input"
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      aria-label={label}
      aria-invalid={bad ? 'true' : undefined}
      title={bad ? '예: 1800, 930, 18:30' : undefined}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[^\d:]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
    />
  );
}
