'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';

type State<T> =
  { token: string; status: 'ready'; data: T } | { token: string; status: 'error'; message: string };

export type Async<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; message: string };

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';
}

/**
 * Runs `load` whenever `key` changes. State is only written from the promise
 * callbacks, and "loading" is derived from a stale token, so no effect body
 * sets state synchronously.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  key: string,
): Async<T> & { reload: () => void } {
  const loadRef = useRef(load);
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<State<T> | null>(null);
  const token = `${key}#${nonce}`;

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let cancelled = false;
    loadRef.current().then(
      (data) => {
        if (!cancelled) setState({ token, status: 'ready', data });
      },
      (error: unknown) => {
        if (!cancelled) setState({ token, status: 'error', message: errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  if (!state || state.token !== token) return { status: 'loading', reload };
  return { ...state, reload };
}
