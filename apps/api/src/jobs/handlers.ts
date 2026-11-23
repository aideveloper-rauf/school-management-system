import type { AppConfig } from '../config/env.js';
import type { Mailer } from '../mail/mailer.js';
import { SEND_USER_TOKEN_JOB, sendUserTokenHandler } from '../modules/users/tokens.js';
import type { JobHandler } from './queue.js';

/**
 * Job handler registry. Handlers must be idempotent (a job can run more than once after a crash)
 * and must not put personal data or tokens in thrown error messages (they are stored in jobs.last_error).
 */
export function buildJobHandlers(deps: { config: AppConfig; mailer: Mailer }): Record<string, JobHandler> {
  return {
    [SEND_USER_TOKEN_JOB]: sendUserTokenHandler(deps),
  };
}
