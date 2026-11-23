import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from './api';

/** Load a GET endpoint; `reload()` re-fetches. Aborts on unmount or path change. */
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (path === null) return;
    const ctrl = new AbortController();
    setLoading(true);
    api<T>(path, { signal: ctrl.signal })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setError(e instanceof ApiError ? e : new ApiError(0, 'INTERNAL', 'errors.network'));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

export interface SubmitState {
  busy: boolean;
  /** Translated general error. */
  error: string | null;
  /** Field path → message from the API's validation details. */
  fieldErrors: Record<string, string>;
}

/**
 * Wrap a mutation: tracks busy state and turns ApiError into a translated message plus
 * per-field messages. Field messages from the API are translation keys when they start
 * with "errors."; otherwise they are English validator text (translations: backlog).
 */
export function useSubmit() {
  const { t } = useTranslation();
  const [state, setState] = useState<SubmitState>({ busy: false, error: null, fieldErrors: {} });

  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setState({ busy: true, error: null, fieldErrors: {} });
      try {
        const result = await fn();
        setState({ busy: false, error: null, fieldErrors: {} });
        return result;
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, 'INTERNAL', 'errors.network');
        const fieldErrors: Record<string, string> = {};
        for (const d of err.details ?? []) {
          const key = d.path || '_';
          if (!fieldErrors[key]) fieldErrors[key] = d.message.startsWith('errors.') ? t(d.message) : d.message;
        }
        setState({ busy: false, error: t(err.message), fieldErrors });
        return undefined;
      }
    },
    [t],
  );
  const reset = useCallback(() => setState({ busy: false, error: null, fieldErrors: {} }), []);
  return { ...state, run, reset };
}

/** `?a=1&b=` → only non-empty params. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const q = s.toString();
  return q ? `?${q}` : '';
}
