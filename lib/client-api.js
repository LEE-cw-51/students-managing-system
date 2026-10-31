'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {}

export const DATA_CHANGED_EVENT = 'lms:data-changed';

/** Tell every screen loaded with useApi to read its data again. */
export function notifyDataChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(DATA_CHANGED_EVENT));
}

function handleAuth(res) {
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.href = '/login';
    throw new ApiError('로그인이 필요합니다.');
  }
}

/** Call one service function through /api/[name]. Throws ApiError with the server message. */
export async function api(name, ...args) {
  let res;
  try {
    res = await fetch('/api/' + name, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args })
    });
  } catch (e) {
    throw new ApiError('서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.');
  }
  handleAuth(res);
  const body = await res.json().catch(() => null);
  if (!body) throw new ApiError('서버 응답을 읽을 수 없습니다.');
  if (!body.ok) throw new ApiError(body.error || '요청을 처리하지 못했습니다.');
  return body.data;
}

/** Several service calls in one request (one transaction, one table load). */
export function apiBatch(calls) {
  return api('apiBatch', calls.map(([name, ...args]) => ({ name, args })));
}

/**
 * Load data for a screen. `load` returns a promise; it re-runs when `deps` change.
 * Returns { data, error, loading, reload, setData }.
 */
export function useApi(load, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const id = ++seq.current;
    setState((s) => ({ data: s.data, error: null, loading: true }));
    return Promise.resolve()
      .then(load)
      .then((data) => {
        if (id === seq.current) setState({ data, error: null, loading: false });
        return data;
      })
      .catch((error) => {
        if (id === seq.current) setState((s) => ({ data: s.data, error, loading: false }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  // Changes made outside the screen (e.g. an approved AI assistant proposal) reload its data.
  useEffect(() => {
    window.addEventListener(DATA_CHANGED_EVENT, run);
    return () => window.removeEventListener(DATA_CHANGED_EVENT, run);
  }, [run]);
  const setData = useCallback((updater) => {
    setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater }));
  }, []);
  return { ...state, reload: run, setData };
}
