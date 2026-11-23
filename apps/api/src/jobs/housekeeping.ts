import { sql } from 'kysely';
import type { Db } from '../db/client.js';

/** Retention housekeeping run by cron. Retention periods are a pilot-school decision. */
export async function housekeeping(db: Db): Promise<void> {
  await db
    .deleteFrom('sessions')
    .where('expires_at', '<', sql<Date>`CURRENT_TIMESTAMP`)
    .execute();
  await db
    .deleteFrom('login_attempts')
    .where('attempted_at', '<', sql<Date>`CURRENT_TIMESTAMP - INTERVAL 30 DAY`)
    .execute();
  // Expired or used one-time tokens (kept 7 days after use for support questions).
  await db
    .deleteFrom('user_tokens')
    .where((eb) =>
      eb.or([eb('expires_at', '<', sql<Date>`CURRENT_TIMESTAMP`), eb('used_at', '<', sql<Date>`CURRENT_TIMESTAMP - INTERVAL 7 DAY`)]),
    )
    .execute();
  await db
    .deleteFrom('jobs')
    .where('status', '=', 'done')
    .where('updated_at', '<', sql<Date>`CURRENT_TIMESTAMP - INTERVAL 14 DAY`)
    .execute();
}
