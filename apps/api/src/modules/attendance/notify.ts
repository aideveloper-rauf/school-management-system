import { sql } from 'kysely';
import type { Db } from '../../db/client.js';
import type { JobHandler } from '../../jobs/queue.js';
import { enqueue } from '../../jobs/queue.js';
import type { Mailer } from '../../mail/mailer.js';
import { absenceEmail, absenceSms } from '../../mail/templates.js';
import { deliver } from '../../mail/notify.js';
import { noSms, type SmsSender } from '../../mail/sms.js';

/**
 * Guardian absence notices (roadmap C-10).
 *
 * Marking a student absent queues one job per student per day (idempotency key), delayed so a quick
 * correction cancels it, and moved out of quiet hours (school time). When the job runs it re-checks
 * that the student is still absent and sends to verified guardians who opted in to email notices.
 * Each guardian gets email and/or SMS according to their preferences; every attempt is logged (masked address).
 */
export const ABSENCE_NOTICE_JOB = 'attendance.absence_notice';
const DELAY_MINUTES = 30;
const QUIET_FROM_HOUR = 20; // 8 pm
const QUIET_UNTIL_HOUR = 7; // 7 am

/** Wall-clock hour/minute of `at` in `timezone`. */
function localTime(at: Date, timezone: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  return { hour: Number(parts.find((p) => p.type === 'hour')!.value), minute: Number(parts.find((p) => p.type === 'minute')!.value) };
}

/** `now + delay`, moved to the next QUIET_UNTIL_HOUR (school time) if that falls in quiet hours. */
export function noticeRunAfter(now: Date, timezone: string): Date {
  const at = new Date(now.getTime() + DELAY_MINUTES * 60_000);
  const { hour, minute } = localTime(at, timezone);
  if (hour >= QUIET_UNTIL_HOUR && hour < QUIET_FROM_HOUR) return at;
  const minutesUntil = hour >= QUIET_FROM_HOUR ? (24 - hour + QUIET_UNTIL_HOUR) * 60 - minute : (QUIET_UNTIL_HOUR - hour) * 60 - minute;
  return new Date(at.getTime() + minutesUntil * 60_000);
}

export async function queueAbsenceNotice(db: Db, studentId: number, date: string, timezone: string): Promise<void> {
  await enqueue(
    db,
    ABSENCE_NOTICE_JOB,
    { studentId, date },
    { idempotencyKey: `absence:${studentId}:${date}`, runAfter: noticeRunAfter(new Date(), timezone) },
  );
}

export function absenceNoticeHandler(deps: { mailer: Mailer; sms?: SmsSender }): JobHandler {
  return async (payload, { db }) => {
    const p = payload as { studentId?: unknown; date?: unknown };
    const studentId = Number(p?.studentId);
    const date = String(p?.date ?? '');
    if (!Number.isInteger(studentId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid payload');

    const still = await db
      .selectFrom('attendance_records as r')
      .innerJoin('attendance_sessions as s', 's.id', 'r.session_id')
      .innerJoin('student_profiles as st', 'st.id', 'r.student_id')
      .select(['st.full_name', 'st.status'])
      .where('r.student_id', '=', studentId)
      .where('s.session_date', '=', sql<string>`${date}`)
      .where('r.status', '=', 'absent')
      .executeTakeFirst();
    if (!still || still.status !== 'active') return; // corrected, or no longer a student: nothing to send

    const guardians = await db
      .selectFrom('student_guardians as sg')
      .innerJoin('guardian_profiles as g', 'g.id', 'sg.guardian_id')
      .select(['g.id', 'g.full_name', 'g.email', 'g.phone', 'g.notify_email', 'g.notify_sms', 'g.preferred_locale'])
      .where('sg.student_id', '=', studentId)
      .where('sg.verification_status', '=', 'verified')
      .execute();
    if (guardians.length === 0) return;
    const school = (await db.selectFrom('schools').select('name').executeTakeFirst())?.name ?? 'School';
    const sender = { mailer: deps.mailer, sms: deps.sms ?? noSms() };
    for (const g of guardians) {
      const v = { school, guardian: g.full_name, student: still.full_name, date };
      const common = {
        purpose: 'absence_notice',
        recipientKind: 'guardian' as const,
        recipientRef: g.id,
        entityType: 'student',
        entityRef: studentId,
      };
      if (g.notify_email && g.email) {
        const tpl = absenceEmail(g.preferred_locale, v);
        await deliver(db, sender, { ...common, channel: 'email', to: g.email, subject: tpl.subject, text: tpl.text });
      }
      if (g.notify_sms && g.phone) {
        await deliver(db, sender, { ...common, channel: 'sms', to: g.phone, text: absenceSms(g.preferred_locale, v) });
      }
    }
  };
}
