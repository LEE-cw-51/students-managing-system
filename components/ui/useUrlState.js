'use client';

import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * A list filter kept in the query string (?status=휴원) so back/refresh keep it.
 * The default value is left out of the URL. Uses history.replaceState: no navigation, no new history entry.
 */
export function useUrlState(key, def = '') {
  const params = useSearchParams();
  const raw = params.get(key);
  const value = raw === null ? def : raw;
  const setValue = useCallback((next) => {
    const p = new URLSearchParams(window.location.search);
    if (next === def) p.delete(key);
    else p.set(key, next);
    const qs = p.toString();
    // Next.js syncs native replaceState into useSearchParams (state is managed by the router).
    window.history.replaceState(null, '',window.location.pathname + (qs ? '?' + qs : ''));
  }, [key, def]);
  return [value, setValue];
}
