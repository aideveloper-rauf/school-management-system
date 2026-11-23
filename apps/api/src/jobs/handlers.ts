import type { JobHandler } from './queue.js';

/**
 * Register job handlers here, e.g. 'notification.email', 'report.generate'.
 * Handlers must be idempotent (a job can run more than once after a crash).
 */
export const jobHandlers: Record<string, JobHandler> = {};
