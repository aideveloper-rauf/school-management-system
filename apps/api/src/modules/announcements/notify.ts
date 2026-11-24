import type { Db } from '../../db/client.js';
import type { JobHandler } from '../../jobs/queue.js';
import { enqueue } from '../../jobs/queue.js';
import type { Mailer } from '../../mail/mailer.js';
import { deliver } from '../../mail/notify.js';
import { noSms, type SmsSender } from '../../mail/sms.js';
import { announcementEmail, announcementSms } from '../../mail/templates.js';

/**
 * Announcement notifications to guardians (roadmap N-1). When an announcement with `notify_guardians` is
 * published, one job sends it to the **verified** guardians of students in the audience (students enrolled now),
 * by email and/or SMS per each guardian's preferences. Re-running is safe: guardians already sent this
 * announcement on a channel are skipped. Staff-only audiences (role other than guardian) notify nobody.
 */
export const ANNOUNCEMENT_NOTIFY_JOB = 'announcement.notify';

export async function queueAnnouncementNotify(db: Db, announcementId: number): Promise<void> {
  await enqueue(db, ANNOUNCEMENT_NOTIFY_JOB, { announcementId }, { idempotencyKey: `announcement:${announcementId}` });
}

export function announcementNotifyHandler(deps: { mailer: Mailer; sms?: SmsSender }): JobHandler {
  return async (payload, { db }) => {
    const id = Number((payload as { announcementId?: unknown })?.announcementId);
    if (!Number.isInteger(id)) throw new Error('invalid payload');
    const a = await db.selectFrom('announcements').selectAll().where('id', '=', id).executeTakeFirst();
    if (!a || !a.published_at || a.withdrawn_at || !a.notify_guardians) return;
    if (a.audience === 'role' && a.audience_role !== 'guardian') return;

    let students = db.selectFrom('enrollments as e').select('e.student_id').where('e.ends_on', 'is', null);
    if (a.audience === 'grade') {
      students = students.innerJoin('class_sections as cs', 'cs.id', 'e.class_section_id').where('cs.grade_id', '=', a.audience_grade_id!);
    } else if (a.audience === 'class' || a.audience === 'guardians_of_class') {
      students = students.where('e.class_section_id', '=', a.audience_class_section_id!);
    }
    const guardians = await db
      .selectFrom('guardian_profiles as g')
      .select(['g.id', 'g.full_name', 'g.email', 'g.phone', 'g.notify_email', 'g.notify_sms', 'g.preferred_locale'])
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('student_guardians as sg')
            .select('sg.student_id')
            .whereRef('sg.guardian_id', '=', 'g.id')
            .where('sg.verification_status', '=', 'verified')
            .where('sg.student_id', 'in', students),
        ),
      )
      .execute();
    const done = new Set(
      (
        await db
          .selectFrom('notification_deliveries')
          .select(['recipient_ref', 'channel'])
          .where('purpose', '=', 'announcement')
          .where('entity_ref', '=', String(id))
          .where('status', '=', 'sent')
          .execute()
      ).map((d) => `${d.channel}:${d.recipient_ref}`),
    );
    const school = (await db.selectFrom('schools').select('name').executeTakeFirst())?.name ?? 'School';
    const sender = { mailer: deps.mailer, sms: deps.sms ?? noSms() };
    for (const g of guardians) {
      const common = {
        purpose: 'announcement',
        recipientKind: 'guardian' as const,
        recipientRef: g.id,
        entityType: 'announcement',
        entityRef: id,
      };
      if (g.notify_email && g.email && !done.has(`email:${g.id}`)) {
        const tpl = announcementEmail(g.preferred_locale, { school, guardian: g.full_name, title: a.title, body: a.body });
        await deliver(db, sender, { ...common, channel: 'email', to: g.email, subject: tpl.subject, text: tpl.text });
      }
      if (g.notify_sms && g.phone && !done.has(`sms:${g.id}`)) {
        await deliver(db, sender, {
          ...common,
          channel: 'sms',
          to: g.phone,
          text: announcementSms(g.preferred_locale, { school, title: a.title }),
        });
      }
    }
  };
}
