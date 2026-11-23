import type { ApiErrorBody, ErrorCode } from '@sms/shared';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  CSRF_FAILED: 403,
  SETUP_REQUIRED: 503,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly statusCode: number;
  constructor(
    readonly code: ErrorCode,
    message: string = code,
    readonly details?: ApiErrorBody['error']['details'],
  ) {
    super(message);
    this.statusCode = STATUS[code];
  }
}

export const unauthenticated = () => new AppError('UNAUTHENTICATED', 'errors.unauthenticated');
export const forbidden = () => new AppError('FORBIDDEN', 'errors.forbidden');
/** Use NOT_FOUND (not FORBIDDEN) for out-of-scope records to avoid leaking existence. */
export const notFound = () => new AppError('NOT_FOUND', 'errors.notFound');
