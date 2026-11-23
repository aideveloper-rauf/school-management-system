/**
 * Cron entry point. Example cPanel cron (every 5 minutes):
 *   cd /home/USER/apps/sms/apps/api && /path/to/node dist/cli/run-jobs.js >> ../../logs/jobs.log 2>&1
 */
import { loadConfig } from '../config/env.js';
import { createDb } from '../db/client.js';
import { drainQueue, releaseStaleJobs } from '../jobs/queue.js';
import { jobHandlers } from '../jobs/handlers.js';
import { housekeeping } from '../jobs/housekeeping.js';

const db = createDb(loadConfig());
try {
  await releaseStaleJobs(db);
  const n = await drainQueue(db, jobHandlers);
  await housekeeping(db);
  console.log(`${new Date().toISOString()} processed=${n}`);
} finally {
  await db.destroy();
}
