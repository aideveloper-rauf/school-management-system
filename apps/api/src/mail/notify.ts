import type { Db } from '../db/client.js';
import type { Mailer } from './mailer.js';
import { maskAddress, normalizePhone, type SmsSender } from './sms.js';

/**
 * One place to send a notification and log the outcome (roadmap N-1). Returns true when sent.
 * Errors are logged (status + short reason) and re-thrown only when `rethrow` is set, so one bad address does
 * not stop the rest of a batch. Message text is never logged.
 */
export interface Delivery {
  channel: 'email' | 'sms';
  purpose: string;
  recipientKind: 'guardian' | 'user';
  recipientRef: number | null;
  to: string;
  subject?: string;
  text: string;
  entityType?: string;
  entityRef?: string | number;
}

export async function deliver(db: Db, deps: { mailer: Mailer; sms: SmsSender }, d: Delivery): Promise<boolean> {
  const to = d.channel === 'sms' ? normalizePhone(d.to) : d.to.trim().toLowerCase();
  const log = (status: 'sent' | 'failed' | 'skipped', error: string | null) =>
    db
      .insertInto('notification_deliveries')
      .values({
        channel: d.channel,
        purpose: d.purpose,
        recipient_kind: d.recipientKind,
        recipient_ref: d.recipientRef,
        to_masked: maskAddress(to ?? d.to),
        status,
        error,
        entity_type: d.entityType ?? null,
        entity_ref: d.entityRef === undefined ? null : String(d.entityRef),
      })
      .execute();
  if (!to) {
    await log('skipped', 'invalid address');
    return false;
  }
  if (d.channel === 'sms' && !deps.sms.enabled) {
    await log('skipped', 'sms disabled');
    return false;
  }
  try {
    if (d.channel === 'email') await deps.mailer.send({ to, subject: d.subject ?? '', text: d.text });
    else await deps.sms.send(to, d.text);
    await log('sent', null);
    return true;
  } catch (err) {
    await log('failed', String((err as Error).message ?? err).slice(0, 255));
    return false;
  }
}
