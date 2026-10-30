'use client';

import { useRef } from 'react';

/**
 * True once `value` differs from the first non-null value it had (for <Modal dirty>).
 * Change `resetKey` when `value` is replaced by freshly loaded data to take that as the new baseline.
 */
export function useDirty(value, resetKey) {
  const base = useRef(undefined);
  const key = useRef(resetKey);
  if (key.current !== resetKey) {
    key.current = resetKey;
    base.current = undefined;
  }
  if (value == null) return false;
  const now = JSON.stringify(value);
  if (base.current === undefined) base.current = now;
  return now !== base.current;
}
