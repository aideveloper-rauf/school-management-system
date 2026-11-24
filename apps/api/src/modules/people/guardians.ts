import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely, type Updateable } from 'kysely';
import {
  createGuardianSchema,
  guardianLinkQuerySchema,
  guardianListQuerySchema,
  linkGuardianSchema,
  pageWindow,
  toPaginated,
  updateGuardianLinkSchema,
  updateGuardianSchema,
  verifyGuardianLinkSchema,
} from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, invalid, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';
import { changedFields, likePattern, pairParams, routeId } from './common.js';

/**
 * Guardians and verified guardian ↔ student links (roadmap C-5). Managed by `guardians.link.manage`
 * (the registrar). A link starts `pending`; only a `verified` link lets the guardian's account see the
 * student (see scope.ts). Editing relationship/primary keeps the state; to re-point a link, unlink and link again.
 * Verification records who verified, when and how (method code). All changes are audited.
 */
type Trx = Kysely<Database>;
const canManage = requirePermission('guardians.link.manage');

async function assertLinkableUser(trx: Trx, userId: number | null | undefined, exceptGuardianId?: number): Promise<void> {
  if (userId === null || userId === undefined) return;
  const user = await trx.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst();
  if (!user) throw invalid('userId', 'Account not found');
  let q = trx.selectFrom('guardian_profiles').select('id').where('user_id', '=', userId);
  if (exceptGuardianId) q = q.where('id', '!=', exceptGuardianId);
  if (await q.executeTakeFirst()) throw new AppError('CONFLICT', 'errors.accountAlreadyLinked');
}

/** Only one primary guardian per student. */
async function clearOtherPrimary(trx: Trx, studentId: number, guardianId: number): Promise<void> {
  await trx
    .updateTable('student_guardians')
    .set({ is_primary: 0 })
    .where('student_id', '=', studentId)
    .where('guardian_id', '!=', guardianId)
    .execute();
}

export const guardianRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const GUARDIAN_COLUMNS = [
    'gp.id',
    'gp.full_name',
    'gp.phone',
    'gp.email',
    'gp.preferred_locale',
    'gp.notify_email',
    'gp.notify_sms',
    'gp.user_id',
    'u.identifier as user_identifier',
  ] as const;
  type GuardianRow = {
    id: number;
    full_name: string;
    phone: string | null;
    email: string | null;
    preferred_locale: string;
    notify_email: number;
    notify_sms: number;
    user_id: number | null;
    user_identifier: string | null;
  };
  const toGuardian = (r: GuardianRow) => ({
    id: r.id,
    fullName: r.full_name,
    phone: r.phone,
    email: r.email,
    preferredLocale: r.preferred_locale,
    notifyEmail: Boolean(r.notify_email),
    notifySms: Boolean(r.notify_sms),
    account: r.user_id === null ? null : { id: r.user_id, identifier: r.user_identifier },
  });
  const base = () => db.selectFrom('guardian_profiles as gp').leftJoin('users as u', 'u.id', 'gp.user_id');

  app.get('/guardians', { preHandler: canManage }, async (req) => {
    const q = guardianListQuerySchema.parse(req.query);
    let query = base();
    if (q.q) {
      const like = likePattern(q.q);
      query = query.where((eb) => eb.or([eb('gp.full_name', 'like', like), eb('gp.phone', 'like', like), eb('gp.email', 'like', like)]));
    }
    const { limit, offset } = pageWindow(q);
    const [rows, total] = await Promise.all([
      query
        .select(GUARDIAN_COLUMNS)
        .select((eb) =>
          eb
            .selectFrom('student_guardians as sg')
            .select(eb.fn.countAll<number>().as('n'))
            .whereRef('sg.guardian_id', '=', 'gp.id')
            .as('student_count'),
        )
        .orderBy('gp.full_name')
        .orderBy('gp.id')
        .limit(limit)
        .offset(offset)
        .execute(),
      query.select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return toPaginated(
      rows.map((r) => ({ ...toGuardian(r as GuardianRow), studentCount: Number(r.student_count ?? 0) })),
      total.n,
      q,
    );
  });

  app.get('/guardians/:id', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    const row = await base().select(GUARDIAN_COLUMNS).where('gp.id', '=', id).executeTakeFirst();
    if (!row) throw notFound();
    const students = await db
      .selectFrom('student_guardians as sg')
      .innerJoin('student_profiles as s', 's.id', 'sg.student_id')
      .select([
        's.id',
        's.admission_no',
        's.full_name',
        's.status',
        'sg.relationship',
        'sg.is_primary',
        'sg.verification_status',
        'sg.verification_method',
        'sg.verified_at',
      ])
      .where('sg.guardian_id', '=', id)
      .orderBy('s.full_name')
      .execute();
    await recordAudit(db, req, { action: 'guardian.viewed', entityType: 'guardian', entityId: id });
    return {
      ...toGuardian(row as GuardianRow),
      students: students.map((s) => ({
        id: s.id,
        admissionNo: s.admission_no,
        fullName: s.full_name,
        status: s.status,
        relationship: s.relationship,
        isPrimary: Boolean(s.is_primary),
        verificationStatus: s.verification_status,
        verificationMethod: s.verification_method,
        verifiedAt: s.verified_at ? new Date(s.verified_at).toISOString() : null,
      })),
    };
  });

  app.post('/guardians', { preHandler: canManage }, async (req, reply) => {
    const input = createGuardianSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      await assertLinkableUser(trx, input.userId);
      const res = await trx
        .insertInto('guardian_profiles')
        .values({
          full_name: input.fullName,
          phone: input.phone,
          email: input.email,
          preferred_locale: input.preferredLocale,
          notify_email: input.notifyEmail ? 1 : 0,
          notify_sms: input.notifySms ? 1 : 0,
          user_id: input.userId,
        })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, { action: 'guardian.created', entityType: 'guardian', entityId: newId });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.patch('/guardians/:id', { preHandler: canManage }, async (req) => {
    const id = routeId(req);
    const input = updateGuardianSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('guardian_profiles')
        .select(['id', 'user_id'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!current) throw notFound();
      await assertLinkableUser(trx, input.userId, id);
      const row: Updateable<Database['guardian_profiles']> = {};
      if (input.fullName !== undefined) row.full_name = input.fullName;
      if (input.phone !== undefined) row.phone = input.phone;
      if (input.email !== undefined) row.email = input.email;
      if (input.preferredLocale !== undefined) row.preferred_locale = input.preferredLocale;
      if (input.notifyEmail !== undefined) row.notify_email = input.notifyEmail ? 1 : 0;
      if (input.notifySms !== undefined) row.notify_sms = input.notifySms ? 1 : 0;
      if (input.userId !== undefined) row.user_id = input.userId;
      await trx.updateTable('guardian_profiles').set(row).where('id', '=', id).execute();
      const meta: Record<string, unknown> = { fields: changedFields(input) };
      if (input.userId !== undefined && input.userId !== current.user_id) meta.userId = input.userId;
      await recordAudit(trx, req, { action: 'guardian.updated', entityType: 'guardian', entityId: id, metadata: meta });
    });
    return { ok: true };
  });

  app.delete('/guardians/:id', { preHandler: canManage }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const links = await trx.selectFrom('student_guardians').select('student_id').where('guardian_id', '=', id).executeTakeFirst();
      if (links) throw new AppError('CONFLICT', 'errors.inUse');
      const res = await trx.deleteFrom('guardian_profiles').where('id', '=', id).executeTakeFirst();
      if (Number(res.numDeletedRows) === 0) throw notFound();
      await recordAudit(trx, req, { action: 'guardian.deleted', entityType: 'guardian', entityId: id });
    });
    return reply.status(204).send();
  });

  // Links --------------------------------------------------------------------
  app.post('/students/:id/guardians', { preHandler: canManage }, async (req, reply) => {
    const studentId = routeId(req);
    const input = linkGuardianSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const student = await trx.selectFrom('student_profiles').select('id').where('id', '=', studentId).forUpdate().executeTakeFirst();
      if (!student) throw notFound();
      const guardian = await trx.selectFrom('guardian_profiles').select('id').where('id', '=', input.guardianId).executeTakeFirst();
      if (!guardian) throw invalid('guardianId', 'Guardian not found');
      if (input.isPrimary) await clearOtherPrimary(trx, studentId, input.guardianId);
      await trx
        .insertInto('student_guardians')
        .values({
          student_id: studentId,
          guardian_id: input.guardianId,
          relationship: input.relationship,
          is_primary: input.isPrimary ? 1 : 0,
        })
        .execute(); // duplicate link → 409
      await recordAudit(trx, req, {
        action: 'guardian.linked',
        entityType: 'student',
        entityId: studentId,
        metadata: { guardianId: input.guardianId, relationship: input.relationship },
      });
    });
    return reply.status(201).send({ ok: true });
  });

  app.patch('/students/:id/guardians/:guardianId', { preHandler: canManage }, async (req) => {
    const { id: studentId, other: guardianId } = pairParams(req, 'guardianId');
    const input = updateGuardianLinkSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const link = await trx
        .selectFrom('student_guardians')
        .select('student_id')
        .where('student_id', '=', studentId)
        .where('guardian_id', '=', guardianId)
        .forUpdate()
        .executeTakeFirst();
      if (!link) throw notFound();
      if (input.isPrimary) await clearOtherPrimary(trx, studentId, guardianId);
      const row: Updateable<Database['student_guardians']> = {};
      if (input.relationship !== undefined) row.relationship = input.relationship;
      if (input.isPrimary !== undefined) row.is_primary = input.isPrimary ? 1 : 0;
      await trx
        .updateTable('student_guardians')
        .set(row)
        .where('student_id', '=', studentId)
        .where('guardian_id', '=', guardianId)
        .execute();
      await recordAudit(trx, req, {
        action: 'guardian.link_updated',
        entityType: 'student',
        entityId: studentId,
        metadata: { guardianId, fields: changedFields(input) },
      });
    });
    return { ok: true };
  });

  app.post('/students/:id/guardians/:guardianId/verify', { preHandler: canManage }, async (req) => {
    const { id: studentId, other: guardianId } = pairParams(req, 'guardianId');
    const input = verifyGuardianLinkSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const link = await trx
        .selectFrom('student_guardians')
        .select('verification_status')
        .where('student_id', '=', studentId)
        .where('guardian_id', '=', guardianId)
        .forUpdate()
        .executeTakeFirst();
      if (!link) throw notFound();
      await trx
        .updateTable('student_guardians')
        .set({
          verification_status: input.decision,
          verification_method: input.decision === 'verified' ? input.method : null,
          verified_by: req.auth!.user.id,
          verified_at: sql<Date>`CURRENT_TIMESTAMP`,
        })
        .where('student_id', '=', studentId)
        .where('guardian_id', '=', guardianId)
        .execute();
      await recordAudit(trx, req, {
        action: input.decision === 'verified' ? 'guardian.link_verified' : 'guardian.link_rejected',
        entityType: 'student',
        entityId: studentId,
        metadata: { guardianId, from: link.verification_status, ...(input.decision === 'verified' && { method: input.method }) },
      });
    });
    return { ok: true };
  });

  app.delete('/students/:id/guardians/:guardianId', { preHandler: canManage }, async (req, reply) => {
    const { id: studentId, other: guardianId } = pairParams(req, 'guardianId');
    await db.transaction().execute(async (trx) => {
      const res = await trx
        .deleteFrom('student_guardians')
        .where('student_id', '=', studentId)
        .where('guardian_id', '=', guardianId)
        .executeTakeFirst();
      if (Number(res.numDeletedRows) === 0) throw notFound();
      await recordAudit(trx, req, { action: 'guardian.unlinked', entityType: 'student', entityId: studentId, metadata: { guardianId } });
    });
    return reply.status(204).send();
  });

  /** Registrar work queue: links by verification state (default: pending), oldest first. */
  app.get('/guardian-links', { preHandler: canManage }, async (req) => {
    const q = guardianLinkQuerySchema.parse(req.query);
    const query = db
      .selectFrom('student_guardians as sg')
      .innerJoin('student_profiles as s', 's.id', 'sg.student_id')
      .innerJoin('guardian_profiles as gp', 'gp.id', 'sg.guardian_id')
      .where('sg.verification_status', '=', q.status ?? 'pending');
    const { limit, offset } = pageWindow(q);
    const [rows, total] = await Promise.all([
      query
        .select([
          's.id as student_id',
          's.admission_no',
          's.full_name as student_name',
          'gp.id as guardian_id',
          'gp.full_name as guardian_name',
          'gp.phone',
          'gp.email',
          'gp.user_id',
          'sg.relationship',
          'sg.is_primary',
          'sg.verification_status',
          'sg.created_at',
        ])
        .orderBy('sg.created_at')
        .orderBy('sg.student_id')
        .limit(limit)
        .offset(offset)
        .execute(),
      query.select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return toPaginated(
      rows.map((r) => ({
        student: { id: r.student_id, admissionNo: r.admission_no, fullName: r.student_name },
        guardian: { id: r.guardian_id, fullName: r.guardian_name, phone: r.phone, email: r.email, hasAccount: r.user_id !== null },
        relationship: r.relationship,
        isPrimary: Boolean(r.is_primary),
        verificationStatus: r.verification_status,
        linkedAt: new Date(r.created_at).toISOString(),
      })),
      total.n,
      q,
    );
  });
};
