import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely } from 'kysely';
import {
  certificateListQuerySchema,
  certificateSerialSchema,
  certificateTemplateSchema,
  issueCertificateSchema,
  pageWindow,
  revokeCertificateSchema,
  toPaginated,
} from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, invalid, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';
import { likePattern, routeId } from '../people/common.js';
import { resolveFamilyStudent } from '../people/scope.js';

/**
 * Certificates (roadmap K-1…K-3).
 *
 * - Templates per language with {{placeholders}}; `certificates.issue` manages them and issues certificates.
 * - Issuing renders title + body with the student's details and FREEZES the text in the certificate row.
 *   Serials are `<SCHOOL>-<YEAR>-<6 digits>-<4 random>`: unique (DB constraint) and not guessable.
 * - `certificates.revoke` revokes with a reason (kept on the certificate; audit holds ids only).
 * - Public verification: `GET /public/certificates/:serial`, rate-limited, returns only validity, title,
 *   the student's name, issue date and school name — no admission number, class or body text.
 * - Students and verified guardians can list their own certificates.
 */
type Trx = Kysely<Database>;
const canIssue = requirePermission('certificates.issue');

const fill = (text: string, values: Record<string, string>) => text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => values[k] ?? m);

async function newSerial(trx: Trx, issuedOn: string): Promise<string> {
  const school = await trx.selectFrom('schools').select(['short_name', 'name']).executeTakeFirst();
  const prefix =
    (school?.short_name ?? school?.name ?? 'SCH')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 8)
      .toUpperCase() || 'SCH';
  for (let i = 0; i < 5; i++) {
    const n = String(Number.parseInt(randomBytes(4).toString('hex'), 16) % 1_000_000).padStart(6, '0');
    const check = randomBytes(3)
      .toString('base64url')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, 'X')
      .slice(0, 4);
    const serial = `${prefix}-${issuedOn.slice(0, 4)}-${n}-${check}`;
    if (!(await trx.selectFrom('certificates').select('id').where('serial', '=', serial).executeTakeFirst())) return serial;
  }
  throw new Error('could not allocate a certificate serial');
}

export const certificateRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  // Templates -------------------------------------------------------------------
  app.get('/certificate-templates', { preHandler: canIssue }, async () => {
    const rows = await db.selectFrom('certificate_templates').selectAll().orderBy('name').orderBy('locale').execute();
    return {
      items: rows.map((r) => ({ id: r.id, name: r.name, locale: r.locale, title: r.title, body: r.body, isActive: Boolean(r.is_active) })),
    };
  });
  app.post('/certificate-templates', { preHandler: canIssue }, async (req, reply) => {
    const input = certificateTemplateSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      const res = await trx
        .insertInto('certificate_templates')
        .values({
          name: input.name,
          locale: input.locale,
          title: input.title,
          body: input.body,
          is_active: input.isActive ? 1 : 0,
          created_by: req.auth!.user.id,
        })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, { action: 'certificate.template_created', entityType: 'certificate_template', entityId: newId });
      return newId;
    });
    return reply.status(201).send({ id });
  });
  /** Editing a template never changes certificates already issued from it. */
  app.put('/certificate-templates/:id', { preHandler: canIssue }, async (req) => {
    const id = routeId(req);
    const input = certificateTemplateSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const res = await trx
        .updateTable('certificate_templates')
        .set({ name: input.name, locale: input.locale, title: input.title, body: input.body, is_active: input.isActive ? 1 : 0 })
        .where('id', '=', id)
        .executeTakeFirst();
      if (Number(res.numUpdatedRows) === 0) throw notFound();
      await recordAudit(trx, req, { action: 'certificate.template_updated', entityType: 'certificate_template', entityId: id });
    });
    return { ok: true };
  });

  // Issue / list / revoke ------------------------------------------------------------
  app.post('/certificates', { preHandler: canIssue }, async (req, reply) => {
    const input = issueCertificateSchema.parse(req.body);
    const issued = await db.transaction().execute(async (trx) => {
      const tpl = await trx.selectFrom('certificate_templates').selectAll().where('id', '=', input.templateId).executeTakeFirst();
      if (!tpl || !tpl.is_active) throw invalid('templateId', 'Template not found or inactive');
      const school = await trx.selectFrom('schools').select('name').executeTakeFirst();
      const out: Array<{ id: number; serial: string; studentId: number }> = [];
      for (const studentId of new Set(input.studentIds)) {
        const s = await trx
          .selectFrom('student_profiles as s')
          .leftJoin('enrollments as e', (j) => j.onRef('e.student_id', '=', 's.id').on('e.ends_on', 'is', null))
          .leftJoin('class_sections as c', 'c.id', 'e.class_section_id')
          .leftJoin('grades as g', 'g.id', 'c.grade_id')
          .select(['s.id', 's.full_name', 's.name_with_initials', 's.admission_no', 'c.name as class_name', 'g.name as grade_name'])
          .where('s.id', '=', studentId)
          .executeTakeFirst();
        if (!s) throw invalid('studentIds', 'Student not found');
        const values = {
          student_name: s.full_name,
          name_with_initials: s.name_with_initials ?? s.full_name,
          admission_no: s.admission_no,
          class: s.class_name ? `${s.grade_name} / ${s.class_name}` : '',
          issued_on: input.issuedOn,
          details: input.details ?? '',
          school: school?.name ?? '',
        };
        const serial = await newSerial(trx, input.issuedOn);
        const res = await trx
          .insertInto('certificates')
          .values({
            serial,
            template_id: tpl.id,
            student_id: s.id,
            locale: tpl.locale,
            issued_on: input.issuedOn,
            title: fill(tpl.title, values),
            body: fill(tpl.body, values),
            issued_by: req.auth!.user.id,
          })
          .executeTakeFirstOrThrow();
        const id = Number(res.insertId);
        await recordAudit(trx, req, {
          action: 'certificate.issued',
          entityType: 'student',
          entityId: s.id,
          metadata: { certificateId: id, templateId: tpl.id },
        });
        out.push({ id, serial, studentId: s.id });
      }
      return out;
    });
    return reply.status(201).send({ items: issued });
  });

  const listQuery = () =>
    db
      .selectFrom('certificates as c')
      .innerJoin('student_profiles as s', 's.id', 'c.student_id')
      .leftJoin('users as u', 'u.id', 'c.issued_by')
      .select([
        'c.id',
        'c.serial',
        'c.title',
        'c.body',
        'c.locale',
        'c.issued_on',
        'c.status',
        'c.issued_at',
        'c.revoked_at',
        'c.revoke_reason',
        's.id as student_id',
        's.full_name',
        's.admission_no',
        'u.display_name as issued_by',
      ]);
  type Row = Awaited<ReturnType<ReturnType<typeof listQuery>['execute']>>[number];
  const toItem = (r: Row) => ({
    id: r.id,
    serial: r.serial,
    title: r.title,
    body: r.body,
    locale: r.locale,
    issuedOn: r.issued_on,
    status: r.status,
    issuedBy: r.issued_by,
    revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
    revokeReason: r.revoke_reason,
    student: { id: r.student_id, fullName: r.full_name, admissionNo: r.admission_no },
  });

  app.get('/certificates', { preHandler: requirePermission('certificates.issue', 'certificates.revoke') }, async (req) => {
    const q = certificateListQuerySchema.parse(req.query);
    let query = listQuery();
    if (q.studentId) query = query.where('c.student_id', '=', q.studentId);
    if (q.status) query = query.where('c.status', '=', q.status);
    if (q.q)
      query = query.where((eb) =>
        eb.or([eb('c.serial', 'like', likePattern(q.q!.toUpperCase())), eb('s.full_name', 'like', likePattern(q.q!))]),
      );
    const { limit, offset } = pageWindow(q);
    const [rows, total] = await Promise.all([
      query.orderBy('c.issued_at', 'desc').orderBy('c.id', 'desc').limit(limit).offset(offset).execute(),
      query.clearSelect().select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return toPaginated(rows.map(toItem), total.n, q);
  });

  app.post('/certificates/:id/revoke', { preHandler: requirePermission('certificates.revoke') }, async (req) => {
    const id = routeId(req);
    const input = revokeCertificateSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const c = await trx.selectFrom('certificates').select(['status', 'student_id']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!c) throw notFound();
      if (c.status === 'revoked') throw new AppError('CONFLICT', 'errors.alreadyRevoked');
      await trx
        .updateTable('certificates')
        .set({ status: 'revoked', revoked_by: req.auth!.user.id, revoked_at: sql<Date>`CURRENT_TIMESTAMP`, revoke_reason: input.reason })
        .where('id', '=', id)
        .execute();
      await recordAudit(trx, req, {
        action: 'certificate.revoked',
        entityType: 'student',
        entityId: c.student_id,
        metadata: { certificateId: id },
      });
    });
    return { ok: true };
  });

  /** A student's own certificates, or a verified child's. */
  app.get('/me/certificates', { preHandler: requirePermission('self.profile.read') }, async (req) => {
    const { studentId } = certificateListQuerySchema.pick({ studentId: true }).parse(req.query);
    const target = await resolveFamilyStudent(db, req.auth!.user.id, studentId);
    if (!target) return { items: [] };
    const rows = await listQuery().where('c.student_id', '=', target).orderBy('c.issued_on', 'desc').execute();
    return { items: rows.map(toItem) };
  });

  /** One certificate for printing: issuers, or the student / a verified guardian. Others get 404. */
  app.get(
    '/certificates/:id',
    { preHandler: requirePermission('certificates.issue', 'certificates.revoke', 'self.profile.read') },
    async (req) => {
      const row = await listQuery().where('c.id', '=', routeId(req)).executeTakeFirst();
      if (!row) throw notFound();
      const p = req.auth!.permissions;
      if (!p.has('certificates.issue') && !p.has('certificates.revoke')) {
        const mine = await resolveFamilyStudent(db, req.auth!.user.id, row.student_id).catch(() => null);
        if (mine !== row.student_id) throw notFound();
      }
      return toItem(row);
    },
  );

  /** Public verification: minimal fields only; rate-limited; same 404 for unknown serials. */
  app.get('/public/certificates/:serial', { config: { public: true, rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { serial } = certificateSerialSchema.parse(req.params);
    const c = await db
      .selectFrom('certificates as c')
      .innerJoin('student_profiles as s', 's.id', 'c.student_id')
      .select(['c.serial', 'c.title', 'c.issued_on', 'c.status', 'c.revoked_at', 's.full_name', 's.name_with_initials'])
      .where('c.serial', '=', serial)
      .executeTakeFirst();
    if (!c) throw notFound();
    const school = await db.selectFrom('schools').select('name').executeTakeFirst();
    return {
      serial: c.serial,
      valid: c.status === 'issued',
      status: c.status,
      title: c.title,
      holder: c.name_with_initials ?? c.full_name,
      issuedOn: c.issued_on,
      revokedOn: c.revoked_at ? new Date(c.revoked_at).toISOString().slice(0, 10) : null,
      school: school?.name ?? null,
    };
  });
};
