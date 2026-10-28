'use client';

import { useRef } from 'react';

/** True once `value` differs from the first non-null value it had (for <Modal dirty>). */
export function useDirty(value) {
  const base = useRef(undefined);
  if (value == null) return false;
  const now = JSON.stringify(value);
  if (base.current === undefined) base.current = now;
  return now !== base.current;
}
