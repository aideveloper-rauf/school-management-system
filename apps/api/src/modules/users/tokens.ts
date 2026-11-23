import { sql, type Kysely } from 'kysely';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import type { Database, UserTokenPurpose } from '../../db/types.js';
import { enqueue, type JobHandler } from '../../jobs/queue.js';
import { AppError } from '../../lib/errors.js';
import { newToken, sha256Hex } from '../../lib/tokens.js';
import type { Mailer } from '../../mail/mailer.js';
import { emailTemplate } from '../../mail/templates.js';

/**
 * One-time invitation and password-reset links.
 *
 * 1. requestUserToken() (inside the caller's transaction) replaces any unused token of the same
 *    purpose with a *pending* row (no hash yet) and queues `user_token.send`.
 * 2. The job mints the random token, stores only its SHA-256 and the real expiry, then emails the
 *    link. A retry mints a new token, invalidating the previous link — safe and idempotent enough.
 * 3. consumeUserToken() accepts the raw token once, before its expiry, for the matching purpose.
 *
 * The raw token exists only in the email and the user's browser (in the URL fragment, so it is
 * not sent to the server in request logs when the page loads).
 */
export const TOKEN_TTL_HOURS: Record<UserTokenPurpose, number> = { invite: 72, reset: 1 };
/** How long a pending (not yet emailed) request stays usable by the job. */
const PENDING_HOURS = 24;
export const SEND_USER_TOKEN_JOB = 'user_token.send';

const LINK_PATH: Record<UserTokenPurpose, string> = { invite: '/#/accept-invite', reset: '/#/reset-password' };
/** The account state each purpose applies to. */
const REQUIRED_STATUS: Record<UserTokenPurpose, 'invited' | 'active'> = { invite: 'invited', reset: 'active' };

type Trx = Kysely<Database>;

export async function requestUserToken(
  trx: Trx,
  opts: { userId: number; purpose: UserTokenPurpose; createdBy: number | null },
): Promise<void> {
  // Supersede (not delete) earlier links: the rows still count towards the hourly request cap.
  await revokeUserTokens(trx, opts.userId, opts.purpose);
  const res = await trx
    .insertInto('user_tokens')
    .values({
      user_id: opts.userId,
      purpose: opts.purpose,
      token_hash: null,
      expires_at: sql<Date>`CURRENT_TIMESTAMP + INTERVAL ${sql.lit(PENDING_HOURS)} HOUR`,
      created_by: opts.createdBy,
    })
    .executeTakeFirstOrThrow();
  const tokenId = Number(res.insertId);
  await enqueue(trx, SEND_USER_TOKEN_JOB, { tokenId }, { idempotencyKey: `user_token:${tokenId}`, maxAttempts: 6 });
}

/** Number of reset requests for a user in the last hour (to stop email flooding). */
export async function recentResetRequests(db: Db, userId: number): Promise<number> {
  const r = await db
    .selectFrom('user_tokens')
    .select(db.fn.countAll<number>().as('n'))
    .where('user_id', '=', userId)
    .where('purpose', '=', 'reset')
    .where('created_at', '>', sql<Date>`CURRENT_TIMESTAMP - INTERVAL 1 HOUR`)
    .executeTakeFirst();
  return Number(r?.n ?? 0);
}

export function sendUserTokenHandler(deps: { config: Pick<AppConfig, 'APP_ORIGIN'>; mailer: Mailer }): JobHandler {
  return async (payload, { db }) => {
    const tokenId = Number((payload as { tokenId?: unknown })?.tokenId);
    if (!Number.isInteger(tokenId) || tokenId <= 0) throw new Error('invalid payload');

    const row = await db
      .selectFrom('user_tokens as t')
      .innerJoin('users as u', 'u.id', 't.user_id')
      .select(['t.id', 't.purpose', 'u.identifier', 'u.display_name', 'u.locale', 'u.status'])
      .where('t.id', '=', tokenId)
      .where('t.used_at', 'is', null)
      .where('t.expires_at', '>', sql<Date>`CURRENT_TIMESTAMP`)
      .executeTakeFirst();
    // Superseded, used, expired or the account changed state: nothing to send.
    if (!row || row.status !== REQUIRED_STATUS[row.purpose]) return;

    const token = newToken();
    const ttl = TOKEN_TTL_HOURS[row.purpose];
    const updated = await db
      .updateTable('user_tokens')
      .set({ token_hash: sha256Hex(token), expires_at: sql<Date>`CURRENT_TIMESTAMP + INTERVAL ${sql.lit(ttl)} HOUR` })
      .where('id', '=', tokenId)
      .where('used_at', 'is', null)
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) === 0) return;

    const school = (await db.selectFrom('schools').select('name').executeTakeFirst())?.name ?? 'School';
    const link = `${deps.config.APP_ORIGIN}${LINK_PATH[row.purpose]}?token=${token}`;
    const tpl = emailTemplate(row.locale, row.purpose);
    await deps.mailer.send({
      to: row.identifier,
      subject: tpl.subject({ school }),
      text: tpl.text({ school, name: row.display_name, link, hours: ttl }),
    });
  };
}

/**
 * Accept a raw token once. Locks the row; marks it used; returns the user id.
 * Wrong, expired, used or mismatched-purpose tokens all give the same error.
 */
export async function consumeUserToken(trx: Trx, rawToken: string, purpose: UserTokenPurpose): Promise<number> {
  const row = await trx
    .selectFrom('user_tokens as t')
    .innerJoin('users as u', 'u.id', 't.user_id')
    .select(['t.id', 't.user_id', 'u.status'])
    .where('t.token_hash', '=', sha256Hex(rawToken))
    .where('t.purpose', '=', purpose)
    .where('t.used_at', 'is', null)
    .where('t.expires_at', '>', sql<Date>`CURRENT_TIMESTAMP`)
    .forUpdate()
    .executeTakeFirst();
  if (!row || row.status !== REQUIRED_STATUS[purpose]) throw new AppError('BAD_REQUEST', 'errors.invalidToken');
  await trx
    .updateTable('user_tokens')
    .set({ used_at: sql<Date>`CURRENT_TIMESTAMP` })
    .where('id', '=', row.id)
    .execute();
  return row.user_id;
}

/**
 * Invalidate every unused token of a user (on disable, password change, a newer request, …).
 * Rows are marked used rather than deleted so the hourly reset cap still counts them;
 * housekeeping removes them after 7 days.
 */
export async function revokeUserTokens(trx: Trx, userId: number, purpose?: UserTokenPurpose): Promise<void> {
  let q = trx
    .updateTable('user_tokens')
    .set({ used_at: sql<Date>`CURRENT_TIMESTAMP` })
    .where('user_id', '=', userId)
    .where('used_at', 'is', null);
  if (purpose) q = q.where('purpose', '=', purpose);
  await q.execute();
}
