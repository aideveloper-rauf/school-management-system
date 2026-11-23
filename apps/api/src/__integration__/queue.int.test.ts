import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import type { Db } from '../db/client.js';
import { drainQueue, enqueue, releaseStaleJobs, type JobHandler } from '../jobs/queue.js';
import { freshDb } from './test-db.js';

let db: Db;

beforeAll(async () => {
  ({ db } = await freshDb());
});
afterAll(async () => db?.destroy());
beforeEach(async () => {
  await db.deleteFrom('jobs').execute();
});

describe('DB-backed job queue (real MySQL)', () => {
  it('runs a job enqueued just now', async () => {
    const seen: unknown[] = [];
    await enqueue(db, 'echo', { n: 1 });
    const processed = await drainQueue(
      db,
      {
        echo: async (p) => {
          seen.push(p);
        },
      },
      5_000,
    );
    expect(processed).toBe(1);
    expect(seen).toEqual([{ n: 1 }]);
    const job = await db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow();
    expect(job.status).toBe('done');
  });

  it('ignores a duplicate idempotency key', async () => {
    await enqueue(db, 'echo', { n: 1 }, { idempotencyKey: 'k-1' });
    await enqueue(db, 'echo', { n: 2 }, { idempotencyKey: 'k-1' });
    const rows = await db.selectFrom('jobs').select('payload').execute();
    expect(rows).toHaveLength(1);
  });

  it('processes each job exactly once with concurrent workers (SKIP LOCKED)', async () => {
    const total = 12;
    for (let i = 0; i < total; i++) await enqueue(db, 'count', { i });
    const counts = new Map<number, number>();
    const handler: JobHandler = async (p) => {
      const i = (p as { i: number }).i;
      counts.set(i, (counts.get(i) ?? 0) + 1);
      await new Promise((r) => setTimeout(r, 20));
    };
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => drainQueue(db, { count: handler }, 10_000)));
    expect(a! + b! + c!).toBe(total);
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    expect(counts.size).toBe(total);
  });

  it('retries a failing job later and keeps only the error message', async () => {
    await enqueue(db, 'boom', {}, { maxAttempts: 2 });
    await drainQueue(
      db,
      {
        boom: async () => {
          throw new Error('upstream unavailable');
        },
      },
      5_000,
    );
    let job = await db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow();
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(1);
    expect(job.last_error).toBe('upstream unavailable');
    expect(new Date(job.run_after).getTime()).toBeGreaterThan(Date.now());

    // Make it due again; the second failure exhausts max_attempts.
    await db
      .updateTable('jobs')
      .set({ run_after: sql<Date>`CURRENT_TIMESTAMP - INTERVAL 1 SECOND` })
      .execute();
    await drainQueue(
      db,
      {
        boom: async () => {
          throw new Error('still down');
        },
      },
      5_000,
    );
    job = await db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow();
    expect(job.status).toBe('failed');
  });

  it('fails a job with no registered handler instead of looping', async () => {
    await enqueue(db, 'unknown', {}, { maxAttempts: 1 });
    expect(await drainQueue(db, {}, 5_000)).toBe(1);
    const job = await db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow();
    expect(job.status).toBe('failed');
  });

  it('releases jobs stuck in running', async () => {
    await enqueue(db, 'echo', {});
    await db
      .updateTable('jobs')
      .set({ status: 'running', locked_at: sql<Date>`CURRENT_TIMESTAMP - INTERVAL 30 MINUTE` })
      .execute();
    await releaseStaleJobs(db, 15);
    const job = await db.selectFrom('jobs').selectAll().executeTakeFirstOrThrow();
    expect(job.status).toBe('pending');
  });
});
