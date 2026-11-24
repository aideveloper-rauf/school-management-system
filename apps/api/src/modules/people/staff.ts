import type { FastifyPluginAsync } from 'fastify';
import type { Kysely, Updateable } from 'kysely';
import { createStaffSchema, pageWindow, staffListQuerySchema, toPaginated, updateStaffSchema } from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, invalid, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';
import { changedFields, likePattern, routeId } from './common.js';

/**
 * Staff records (roadmap C-2). staff.read lists/views; staff.manage creates and edits.
 * A profile may be linked to one sign-in account; that link is what gives a teacher scope over the
 * classes they are assigned to, so linking and unlinking are audited.
 */
type Trx = Kysely<Database>;

async function assertLinkableUser(trx: Trx, userId: number | null | undefined, exceptStaffId?: number): Promise<void> {
  if (userId === null || userId === undefined) return;
  const user = await trx.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst();
  if (!user) throw invalid('userId', 'Account not found');
  let q = trx.selectFrom('staff_profiles').select('id').where('user_id', '=', userId);
  if (exceptStaffId) q = q.where('id', '!=', exceptStaffId);
  if (await q.executeTakeFirst()) throw new AppError('CONFLICT', 'errors.accountAlreadyLinked');
}

const STAFF_COLUMNS = [
  'sp.id',
  'sp.staff_no',
  'sp.full_name',
  'sp.name_with_initials',
  'sp.designation',
  'sp.work_email',
  'sp.work_phone',
  'sp.joined_on',
  'sp.status',
  'sp.left_on',
  'sp.user_id',
  'u.display_name as user_display_name',
  'u.identifier as user_identifier',
] as const;
type StaffRow = {
  id: number;
  staff_no: string;
  full_name: string;
  name_with_initials: string | null;
  designation: string | null;
  work_email: string | null;
  work_phone: string | null;
  joined_on: string | null;
  status: string;
  left_on: string | null;
  user_id: number | null;
  user_display_name: string | null;
  user_identifier: string | null;
};
const toStaff = (r: StaffRow) => ({
  id: r.id,
  staffNo: r.staff_no,
  fullName: r.full_name,
  nameWithInitials: r.name_with_initials,
  designation: r.designation,
  workEmail: r.work_email,
  workPhone: r.work_phone,
  joinedOn: r.joined_on,
  status: r.status,
  leftOn: r.left_on,
  account: r.user_id === null ? null : { id: r.user_id, displayName: r.user_display_name, identifier: r.user_identifier },
});

export const staffRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const base = () => db.selectFrom('staff_profiles as sp').leftJoin('users as u', 'u.id', 'sp.user_id');

  app.get('/staff', { preHandler: requirePermission('staff.read') }, async (req) => {
    const q = staffListQuerySchema.parse(req.query);
    let query = base();
    if (q.status) query = query.where('sp.status', '=', q.status);
    if (q.q) {
      const like = likePattern(q.q);
      query = query.where((eb) =>
        eb.or([eb('sp.full_name', 'like', like), eb('sp.staff_no', 'like', like), eb('sp.designation', 'like', like)]),
      );
    }
    const { limit, offset } = pageWindow(q);
    const [rows, total] = await Promise.all([
      query.select(STAFF_COLUMNS).orderBy('sp.full_name').orderBy('sp.id').limit(limit).offset(offset).execute(),
      query.select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return toPaginated(
      rows.map((r) => toStaff(r as StaffRow)),
      total.n,
      q,
    );
  });

  app.get('/staff/:id', { preHandler: requirePermission('staff.read') }, async (req) => {
    const id = routeId(req);
    const row = await base().select(STAFF_COLUMNS).where('sp.id', '=', id).executeTakeFirst();
    if (!row) throw notFound();
    const assignments = await db
      .selectFrom('teacher_assignments as ta')
      .innerJoin('class_sections as c', 'c.id', 'ta.class_section_id')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .innerJoin('academic_years as y', 'y.id', 'c.academic_year_id')
      .innerJoin('subjects as sub', 'sub.id', 'ta.subject_id')
      .select([
        'ta.id',
        'c.id as class_id',
        'c.name as class_name',
        'g.name as grade_name',
        'y.label as year_label',
        'sub.id as subject_id',
        'sub.name as subject_name',
      ])
      .where('ta.staff_id', '=', id)
      .orderBy('y.starts_on', 'desc')
      .orderBy('g.level')
      .orderBy('c.name')
      .execute();
    const classTeacherOf = await db
      .selectFrom('class_sections as c')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .innerJoin('academic_years as y', 'y.id', 'c.academic_year_id')
      .select(['c.id', 'c.name', 'g.name as grade_name', 'y.label as year_label'])
      .where('c.class_teacher_id', '=', id)
      .orderBy('y.starts_on', 'desc')
      .execute();
    return {
      ...toStaff(row as StaffRow),
      assignments: assignments.map((a) => ({
        id: a.id,
        class: { id: a.class_id, name: a.class_name, gradeName: a.grade_name, yearLabel: a.year_label },
        subject: { id: a.subject_id, name: a.subject_name },
      })),
      classTeacherOf: classTeacherOf.map((c) => ({ id: c.id, name: c.name, gradeName: c.grade_name, yearLabel: c.year_label })),
    };
  });

  app.post('/staff', { preHandler: requirePermission('staff.manage') }, async (req, reply) => {
    const input = createStaffSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      await assertLinkableUser(trx, input.userId);
      const res = await trx
        .insertInto('staff_profiles')
        .values({
          staff_no: input.staffNo,
          full_name: input.fullName,
          name_with_initials: input.nameWithInitials,
          designation: input.designation,
          work_email: input.workEmail,
          work_phone: input.workPhone,
          joined_on: input.joinedOn,
          user_id: input.userId,
        })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, {
        action: 'staff.created',
        entityType: 'staff',
        entityId: newId,
        metadata: input.userId ? { userId: input.userId } : undefined,
      });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/staff/:id', { preHandler: requirePermission('staff.manage') }, async (req) => {
    const id = routeId(req);
    const input = updateStaffSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('staff_profiles')
        .select(['id', 'user_id', 'status'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw notFound();
      await assertLinkableUser(trx, input.userId, id);
      const row: Updateable<Database['staff_profiles']> = {};
      if (input.staffNo !== undefined) row.staff_no = input.staffNo;
      if (input.fullName !== undefined) row.full_name = input.fullName;
      if (input.nameWithInitials !== undefined) row.name_with_initials = input.nameWithInitials;
      if (input.designation !== undefined) row.designation = input.designation;
      if (input.workEmail !== undefined) row.work_email = input.workEmail;
      if (input.workPhone !== undefined) row.work_phone = input.workPhone;
      if (input.joinedOn !== undefined) row.joined_on = input.joinedOn;
      if (input.userId !== undefined) row.user_id = input.userId;
      if (input.status !== undefined) {
        row.status = input.status;
        if (input.status === 'active') row.left_on = null;
      }
      if (input.leftOn !== undefined) row.left_on = input.leftOn;
      await trx.updateTable('staff_profiles').set(row).where('id', '=', id).execute();
      const meta: Record<string, unknown> = { fields: changedFields(input) };
      if (input.userId !== undefined && input.userId !== current.user_id) meta.userId = input.userId;
      await recordAudit(trx, req, { action: 'staff.updated', entityType: 'staff', entityId: id, metadata: meta });
    });
    return { ok: true };
  });
};
