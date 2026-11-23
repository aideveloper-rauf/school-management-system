/**
 * API contract primitives shared by the API and the web client.
 * Every error response from /api/v1 uses ApiErrorBody.
 */
export const API_VERSION = 'v1' as const;
export const API_PREFIX = `/api/${API_VERSION}` as const;

/** Header the web client must send on every state-changing request. */
export const CSRF_HEADER = 'x-csrf-token' as const;

export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'CSRF_FAILED',
  /** Signed in with a temporary password: only /auth/session, /auth/password and logout are allowed. */
  'PASSWORD_CHANGE_REQUIRED',
  'SETUP_REQUIRED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    /** Translation key or English fallback; never contains personal data. */
    message: string;
    /** Field-level problems for VALIDATION_FAILED. */
    details?: Array<{ path: string; message: string }>;
    /** Correlates with server logs. */
    requestId?: string;
  };
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const MAX_PAGE_SIZE = 100;
