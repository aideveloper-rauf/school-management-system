import { sql } from 'kysely';
import type { Db } from '../db/client.js';

/**
 * Database-backed job queue drained by cron (no Redis / always-on worker needed).
 * Requires MySQL 8.0+ or MariaDB 10.6+ for SKIP LOCKED.
 */
export type JobHandler = (payload: unknown, ctx: { db: Db }) => Promise<void>;

export async function enqueue(
  db: Db,
  type: string,
  payload: unknown,
  opts: { idempotencyKey?: string; runAfter?: Date; maxAttempts?: number } = {},
): Promise<void> {
  await db
    .insertInto('jobs')
    .values({
      type,
      payload: JSON.stringify(payload),
      // Default to the database clock: claim() compares against CURRENT_TIMESTAMP, and a
      // JS Date can be ahead of it (TIMESTAMP rounds fractional seconds; app/DB clocks differ).
      run_after: opts.runAfter ?? sql<Date>`CURRENT_TIMESTAMP`,
      max_attempts: opts.maxAttempts ?? 5,
      idempotency_key: opts.idempotencyKey ?? null,
      status: 'pending',
      attempts: 0,
    })
    // Duplicate idempotency key = already queued; ignore.
    .onDuplicateKeyUpdate({ id: sql`id` })
    .execute();
}

async function claim(db: Db) {
  return db.transaction().execute(async (trx) => {
    const job = await trx
      .selectFrom('jobs')
      .selectAll()
      .where('status', '=', 'pending')
      .where('run_after', '<=', sql<Date>`CURRENT_TIMESTAMP`)
      .orderBy('id')
      .limit(1)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!job) return null;
    await trx.updateTable('jobs').set({ status: 'running', locked_at: new Date(), attempts: job.attempts + 1 }).where('id', '=', job.id).execute();
    return { ...job, attempts: job.attempts + 1 };
  });
}

/** Process jobs until none are due or the time budget is spent. Returns the count processed. */
export async function drainQueue(db: Db, handlers: Record<string, JobHandler>, budgetMs = 50_000): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let processed = 0;
  while (Date.now() < deadline) {
    const job = await claim(db);
    if (!job) break;
    processed++;
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`No handler for job type ${job.type}`);
      const payload: unknown = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
      await handler(payload, { db });
      await db.updateTable('jobs').set({ status: 'done', locked_at: null, last_error: null }).where('id', '=', job.id).execute();
    } catch (err) {
      const failed = job.attempts >= job.max_attempts;
      const backoffMs = Math.min(60 * 60_000, 2 ** job.attempts * 30_000);
      await db.updateTable('jobs').set({
        status: failed ? 'failed' : 'pending',
        locked_at: null,
        run_after: new Date(Date.now() + backoffMs),
        // Error message only; handlers must not put personal data in error messages.
        last_error: String((err as Error).message ?? err).slice(0, 1000),
      }).where('id', '=', job.id).execute();
    }
  }
  return processed;
}

/** Requeue jobs stuck in "running" (e.g. process killed by host limits). */
export async function releaseStaleJobs(db: Db, olderThanMinutes = 15): Promise<void> {
  await db.updateTable('jobs').set({ status: 'pending', locked_at: null })
    .where('status', '=', 'running')
    .where('locked_at', '<', sql<Date>`CURRENT_TIMESTAMP - INTERVAL ${sql.lit(olderThanMinutes)} MINUTE`)
    .execute();
}
