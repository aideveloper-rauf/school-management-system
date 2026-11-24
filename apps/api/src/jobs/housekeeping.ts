import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import { deleteStoredFile } from '../lib/files.js';

/** Retention housekeeping run by cron. Retention periods are a pilot-school decision. */
export async function housekeeping(db: Db, storageDir?: string): Promise<void> {
  if (storageDir) await removeOrphanFiles(db, storageDir);
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

/**
 * Uploaded files never attached (or detached by an edit/resubmission) for a day are removed from the
 * database and the disk. Attached files are never touched here.
 */
export async function removeOrphanFiles(db: Db, storageDir: string): Promise<number> {
  const orphans = await db
    .selectFrom('stored_files as f')
    .select(['f.id', 'f.storage_key'])
    .where('f.created_at', '<', sql<Date>`CURRENT_TIMESTAMP - INTERVAL 1 DAY`)
    .where((eb) => eb.not(eb.exists(eb.selectFrom('learning_item_files as l').select('l.file_id').whereRef('l.file_id', '=', 'f.id'))))
    .where((eb) => eb.not(eb.exists(eb.selectFrom('submission_files as s').select('s.file_id').whereRef('s.file_id', '=', 'f.id'))))
    .limit(500)
    .execute();
  for (const f of orphans) {
    const res = await db
      .deleteFrom('stored_files')
      .where('id', '=', f.id)
      .executeTakeFirst()
      .catch(() => null); // attached meanwhile → FK refuses
    if (res && Number(res.numDeletedRows) > 0) await deleteStoredFile(storageDir, f.storage_key);
  }
  return orphans.length;
}
