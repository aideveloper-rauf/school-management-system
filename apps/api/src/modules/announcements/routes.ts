import type { FastifyPluginAsync } from 'fastify';
import { sql, type ExpressionBuilder, type Kysely } from 'kysely';
import { announcementListQuerySchema, createAnnouncementSchema, pageWindow, toPaginated, updateAnnouncementSchema } from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import type { AuthContext } from '../../plugins/auth.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, invalid, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';
import { routeId, todayIn } from '../people/common.js';
import { taughtSectionIds } from '../people/scope.js';
import { queueAnnouncementNotify } from './notify.js';

/**
 * Announcements with audience targeting (roadmap C-12).
 *
 * Who sees a published, unexpired, not-withdrawn announcement:
 * - school: everyone signed in;
 * - role: users holding that role;
 * - grade / class: students currently enrolled there, verified guardians of those students, and staff who
 *   teach or are class teacher there;
 * - guardians_of_class: verified guardians of students currently in that class.
 * Publishers (`announcements.publish`) see everything published. Read receipts are recorded per user.
 */
type Trx = Kysely<Database>;
type AnnEb = ExpressionBuilder<Database & { a: Database['announcements'] }, 'a'>;

/** Section ids where the user is a student now, or a verified guardian of a student now. */
function familySectionIds(eb: AnnEb, userId: number, as: 'student_or_guardian' | 'guardian') {
  const viaGuardian = eb
    .selectFrom('enrollments as e')
    .innerJoin('student_guardians as sg', 'sg.student_id', 'e.student_id')
    .innerJoin('guardian_profiles as gp', 'gp.id', 'sg.guardian_id')
    .select('e.class_section_id')
    .where('e.ends_on', 'is', null)
    .where('sg.verification_status', '=', 'verified')
    .where('gp.user_id', '=', userId);
  if (as === 'guardian') return viaGuardian;
  return viaGuardian.union(
    eb
      .selectFrom('enrollments as e')
      .innerJoin('student_profiles as s', 's.id', 'e.student_id')
      .select('e.class_section_id')
      .where('e.ends_on', 'is', null)
      .where('s.user_id', '=', userId),
  );
}

export function visibleTo(db: Trx, auth: AuthContext) {
  const userId = auth.user.id;
  return (eb: AnnEb) => {
    if (auth.permissions.has('announcements.publish')) return eb.lit(true);
    const memberSections = familySectionIds(eb, userId, 'student_or_guardian');
    const taught = taughtSectionIds(db, userId);
    const roles = auth.user.roles.length ? auth.user.roles : ['__none__'];
    return eb.or([
      eb('a.audience', '=', 'school'),
      eb.and([eb('a.audience', '=', 'role'), eb('a.audience_role', 'in', roles)]),
      eb.and([
        eb('a.audience', '=', 'class'),
        eb.or([eb('a.audience_class_section_id', 'in', memberSections), eb('a.audience_class_section_id', 'in', taught)]),
      ]),
      eb.and([
        eb('a.audience', '=', 'guardians_of_class'),
        eb('a.audience_class_section_id', 'in', familySectionIds(eb, userId, 'guardian')),
      ]),
      eb.and([
        eb('a.audience', '=', 'grade'),
        eb.or([
          eb(
            'a.audience_grade_id',
            'in',
            eb
              .selectFrom('class_sections as cs')
              .select('cs.grade_id')
              .where('cs.id', 'in', familySectionIds(eb, userId, 'student_or_guardian')),
          ),
          eb(
            'a.audience_grade_id',
            'in',
            eb.selectFrom('class_sections as cs').select('cs.grade_id').where('cs.id', 'in', taughtSectionIds(db, userId)),
          ),
        ]),
      ]),
    ]);
  };
}

async function assertAudienceRefs(
  trx: Trx,
  input: { audience: string; audienceGradeId: number | null; audienceClassSectionId: number | null },
) {
  if (input.audience === 'grade') {
    const g = await trx.selectFrom('grades').select('id').where('id', '=', input.audienceGradeId!).executeTakeFirst();
    if (!g) throw invalid('audienceGradeId', 'Grade not found');
  }
  if (input.audience === 'class' || input.audience === 'guardians_of_class') {
    const c = await trx.selectFrom('class_sections').select('id').where('id', '=', input.audienceClassSectionId!).executeTakeFirst();
    if (!c) throw invalid('audienceClassSectionId', 'Class not found');
  }
}

/** Keep only the reference that matches the audience. */
const audienceColumns = (i: {
  audience: string;
  audienceRole: string | null;
  audienceGradeId: number | null;
  audienceClassSectionId: number | null;
}) => ({
  audience: i.audience as Database['announcements']['audience'],
  audience_role: i.audience === 'role' ? i.audienceRole : null,
  audience_grade_id: i.audience === 'grade' ? i.audienceGradeId : null,
  audience_class_section_id: i.audience === 'class' || i.audience === 'guardians_of_class' ? i.audienceClassSectionId : null,
});

export const announcementRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const canPublish = requirePermission('announcements.publish');
  const base = () =>
    db
      .selectFrom('announcements as a')
      .leftJoin('users as u', 'u.id', 'a.created_by')
      .leftJoin('grades as g', 'g.id', 'a.audience_grade_id')
      .leftJoin('class_sections as c', 'c.id', 'a.audience_class_section_id')
      .leftJoin('grades as cg', 'cg.id', 'c.grade_id')
      .select([
        'a.id',
        'a.title',
        'a.body',
        'a.audience',
        'a.audience_role',
        'a.audience_grade_id',
        'a.audience_class_section_id',
        'a.published_at',
        'a.expires_on',
        'a.withdrawn_at',
        'a.notify_guardians',
        'a.created_at',
        'u.display_name as author',
        'g.name as grade_name',
        'c.name as class_name',
        'cg.name as class_grade_name',
      ]);
  type Row = Awaited<ReturnType<ReturnType<typeof base>['execute']>>[number];
  const toItem = (r: Row) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    audience: r.audience,
    audienceRole: r.audience_role,
    audienceGrade: r.audience_grade_id === null ? null : { id: r.audience_grade_id, name: r.grade_name },
    audienceClass:
      r.audience_class_section_id === null ? null : { id: r.audience_class_section_id, name: r.class_name, gradeName: r.class_grade_name },
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    expiresOn: r.expires_on,
    withdrawnAt: r.withdrawn_at ? new Date(r.withdrawn_at).toISOString() : null,
    notifyGuardians: Boolean(r.notify_guardians),
    author: r.author,
    createdAt: new Date(r.created_at).toISOString(),
  });
  const today = async () => todayIn((await db.selectFrom('schools').select('timezone').executeTakeFirst())?.timezone ?? 'Asia/Colombo');

  /** My feed: published announcements addressed to me, newest first, with my read state. */
  app.get('/announcements', { preHandler: requirePermission('announcements.read') }, async (req) => {
    const q = announcementListQuerySchema.parse(req.query);
    const day = await today();
    const userId = req.auth!.user.id;
    const feed = base()
      .where('a.published_at', 'is not', null)
      .where('a.withdrawn_at', 'is', null)
      .where((eb) => eb.or([eb('a.expires_on', 'is', null), eb('a.expires_on', '>=', day)]))
      .where(visibleTo(db, req.auth!));
    const { limit, offset } = pageWindow(q);
    const [rows, total, unread] = await Promise.all([
      feed
        .select((eb) =>
          eb
            .exists(
              eb
                .selectFrom('announcement_reads as ar')
                .select('ar.user_id')
                .whereRef('ar.announcement_id', '=', 'a.id')
                .where('ar.user_id', '=', userId),
            )
            .as('is_read'),
        )
        .orderBy('a.published_at', 'desc')
        .orderBy('a.id', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
      feed.clearSelect().select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
      feed
        .clearSelect()
        .select(db.fn.countAll<number>().as('n'))
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('announcement_reads as ar')
                .select('ar.user_id')
                .whereRef('ar.announcement_id', '=', 'a.id')
                .where('ar.user_id', '=', userId),
            ),
          ),
        )
        .executeTakeFirstOrThrow(),
    ]);
    return {
      ...toPaginated(
        rows.map((r) => ({ ...toItem(r), isRead: Boolean(r.is_read) })),
        total.n,
        q,
      ),
      unread: Number(unread.n),
    };
  });

  app.post('/announcements/:id/read', { preHandler: requirePermission('announcements.read') }, async (req) => {
    const id = routeId(req);
    const visible = await db
      .selectFrom('announcements as a')
      .select('a.id')
      .where('a.id', '=', id)
      .where('a.published_at', 'is not', null)
      .where('a.withdrawn_at', 'is', null)
      .where(visibleTo(db, req.auth!))
      .executeTakeFirst();
    if (!visible) throw notFound();
    await db
      .insertInto('announcement_reads')
      .values({ announcement_id: id, user_id: req.auth!.user.id })
      .onDuplicateKeyUpdate({ read_at: sql`read_at` })
      .execute();
    return { ok: true };
  });

  /** Publisher view: every announcement (drafts too), with read counts. */
  app.get('/announcements/manage', { preHandler: canPublish }, async (req) => {
    const q = announcementListQuerySchema.parse(req.query);
    let query = base();
    if (q.state === 'draft') query = query.where('a.published_at', 'is', null);
    if (q.state === 'published') query = query.where('a.published_at', 'is not', null).where('a.withdrawn_at', 'is', null);
    if (q.state === 'withdrawn') query = query.where('a.withdrawn_at', 'is not', null);
    const { limit, offset } = pageWindow(q);
    const [rows, total] = await Promise.all([
      query
        .select((eb) =>
          eb
            .selectFrom('announcement_reads as ar')
            .select(eb.fn.countAll<number>().as('n'))
            .whereRef('ar.announcement_id', '=', 'a.id')
            .as('reads'),
        )
        .orderBy('a.created_at', 'desc')
        .orderBy('a.id', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
      query.clearSelect().select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return toPaginated(
      rows.map((r) => ({ ...toItem(r), reads: Number(r.reads ?? 0) })),
      total.n,
      q,
    );
  });

  app.post('/announcements', { preHandler: canPublish }, async (req, reply) => {
    const input = createAnnouncementSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      await assertAudienceRefs(trx, input);
      const res = await trx
        .insertInto('announcements')
        .values({
          title: input.title,
          body: input.body,
          ...audienceColumns(input),
          expires_on: input.expiresOn,
          notify_guardians: input.notifyGuardians ? 1 : 0,
          published_at: input.publish ? sql<Date>`CURRENT_TIMESTAMP` : null,
          created_by: req.auth!.user.id,
        })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, {
        action: input.publish ? 'announcement.published' : 'announcement.drafted',
        entityType: 'announcement',
        entityId: newId,
        metadata: { audience: input.audience },
      });
      if (input.publish && input.notifyGuardians) await queueAnnouncementNotify(trx, newId);
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.put('/announcements/:id', { preHandler: canPublish }, async (req) => {
    const id = routeId(req);
    const input = updateAnnouncementSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const cur = await trx.selectFrom('announcements').select(['published_at']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!cur) throw notFound();
      // Published notices are not silently rewritten: withdraw and publish a new one instead.
      if (cur.published_at) throw new AppError('CONFLICT', 'errors.announcementPublished');
      await assertAudienceRefs(trx, input);
      await trx
        .updateTable('announcements')
        .set({
          title: input.title,
          body: input.body,
          ...audienceColumns(input),
          expires_on: input.expiresOn,
          notify_guardians: input.notifyGuardians ? 1 : 0,
        })
        .where('id', '=', id)
        .execute();
      await recordAudit(trx, req, { action: 'announcement.updated', entityType: 'announcement', entityId: id });
    });
    return { ok: true };
  });

  app.post('/announcements/:id/publish', { preHandler: canPublish }, async (req) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const cur = await trx
        .selectFrom('announcements')
        .select(['published_at', 'audience', 'notify_guardians'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!cur) throw notFound();
      if (cur.published_at) throw new AppError('CONFLICT', 'errors.announcementPublished');
      await trx
        .updateTable('announcements')
        .set({ published_at: sql<Date>`CURRENT_TIMESTAMP` })
        .where('id', '=', id)
        .execute();
      if (cur.notify_guardians) await queueAnnouncementNotify(trx, id);
      await recordAudit(trx, req, {
        action: 'announcement.published',
        entityType: 'announcement',
        entityId: id,
        metadata: { audience: cur.audience },
      });
    });
    return { ok: true };
  });

  app.post('/announcements/:id/withdraw', { preHandler: canPublish }, async (req) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const cur = await trx
        .selectFrom('announcements')
        .select(['published_at', 'withdrawn_at'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!cur) throw notFound();
      if (!cur.published_at || cur.withdrawn_at) throw new AppError('CONFLICT', 'errors.announcementNotLive');
      await trx
        .updateTable('announcements')
        .set({ withdrawn_at: sql<Date>`CURRENT_TIMESTAMP` })
        .where('id', '=', id)
        .execute();
      await recordAudit(trx, req, { action: 'announcement.withdrawn', entityType: 'announcement', entityId: id });
    });
    return { ok: true };
  });

  app.delete('/announcements/:id', { preHandler: canPublish }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const cur = await trx.selectFrom('announcements').select(['published_at']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!cur) throw notFound();
      if (cur.published_at) throw new AppError('CONFLICT', 'errors.announcementPublished');
      await trx.deleteFrom('announcements').where('id', '=', id).execute();
      await recordAudit(trx, req, { action: 'announcement.deleted', entityType: 'announcement', entityId: id });
    });
    return reply.status(204).send();
  });
};
