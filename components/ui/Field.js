'use client';

import { useId } from 'react';

/** Label + control + hint/error. Children receive the generated id via render prop or cloneless id. */
export default function Field({ label, hint, error, wide, children, className = '' }) {
  const id = useId();
  const control = typeof children === 'function' ? children(id) : children;
  return (
    <div className={'field ' + (wide ? 'span-all ' : '') + className}>
      {label ? <label htmlFor={id}>{label}</label> : null}
      {control}
      {error ? <span className="error-text" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
