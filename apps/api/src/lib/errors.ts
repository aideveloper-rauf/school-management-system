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
  PASSWORD_CHANGE_REQUIRED: 403,
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
export const conflict = (key = 'errors.duplicate') => new AppError('CONFLICT', key);
/** Field-level validation failure discovered after parsing (e.g. against stored rows). */
export const invalid = (path: string, message: string) => new AppError('VALIDATION_FAILED', 'errors.validation', [{ path, message }]);

/**
 * Map MySQL/MariaDB constraint errors to API errors. Routes check these conditions first
 * for friendly messages; this is the backstop for races. Returns null for anything else.
 * Never echoes the driver message (it can contain row values).
 */
export function fromDbError(err: unknown): AppError | null {
  const errno = (err as { errno?: unknown })?.errno;
  switch (errno) {
    case 1062: // ER_DUP_ENTRY
      return conflict('errors.duplicate');
    case 1451: // ER_ROW_IS_REFERENCED_2
    case 1217:
      return conflict('errors.inUse');
    case 1452: // ER_NO_REFERENCED_ROW_2
    case 1216:
      return new AppError('VALIDATION_FAILED', 'errors.invalidReference');
    case 3819: // MySQL ER_CHECK_CONSTRAINT_VIOLATED
    case 4025: // MariaDB ER_CONSTRAINT_FAILED
      return new AppError('VALIDATION_FAILED', 'errors.validation');
    default:
      return null;
  }
}
