import { API_PREFIX, CSRF_HEADER, type ApiErrorBody, type ErrorCode } from '@sms/shared';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: ErrorCode, message: string, readonly details?: ApiErrorBody['error']['details']) {
    super(message);
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => { csrfToken = t; };

/** Same-origin JSON client. Cookies carry the session; unsafe methods send the CSRF header. */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers[CSRF_HEADER] = csrfToken;

  const res = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  if (res.ok) return (await res.json()) as T;

  let err: ApiErrorBody['error'] = { code: 'INTERNAL', message: 'errors.internal' };
  try { err = ((await res.json()) as ApiErrorBody).error; } catch { /* non-JSON */ }
  throw new ApiError(res.status, err.code, err.message, err.details);
}
