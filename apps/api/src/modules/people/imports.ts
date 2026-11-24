import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import {
  GENDERS,
  GUARDIAN_RELATIONSHIPS,
  IMPORT_MAX_ROWS,
  importListQuerySchema,
  importUploadSchema,
  isoDateSchema,
  pageWindow,
  toPaginated,
  type ImportKind,
  type Permission,
} from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { CsvError, csvObjects, parseCsv } from '../../lib/csv.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';
import { actorId, routeId } from './common.js';
import { enrollStudent } from './students.js';

/**
 * CSV import as an idempotent ImportJob (roadmap C-4).
 *
 * 1. `POST /imports` (preview): parse + validate every row and run the real import inside a transaction
 *    that is then rolled back, so the preview counts are exactly what applying would do. Stores an
 *    `import_jobs` row (status `previewed`) with counts and row errors (row/field/message — never cell values).
 * 2. `POST /imports/:id/apply`: the browser sends the same file again (the server never stores CSV content,
 *    which is personal data); its SHA-256 must match the preview. Refused while any row has errors.
 *    Runs in one transaction. A file already applied (same kind + hash) is refused.
 *
 * Rows are upserts keyed on school numbers (admission no / staff no; guardians by phone, email, or name
 * among the student's guardians), so re-running a corrected file only changes what differs.
 * Permissions: students → students.manage, staff → staff.manage, guardians → guardians.link.manage.
 */
type Trx = Kysely<Database>;
type RowError = { row: number; field: string; message: string };
interface Outcome {
  created: number;
  updated: number;
  unchanged: number;
  errors: RowError[];
}
const MAX_STORED_ERRORS = 200;
const KIND_PERMISSION: Record<ImportKind, Permission> = {
  students: 'students.manage',
  staff: 'staff.manage',
  guardians: 'guardians.link.manage',
};
/** Thrown to roll back a preview transaction. */
class PreviewRollback extends Error {
  constructor(readonly outcome: Outcome) {
    super('preview');
  }
}

export const IMPORT_COLUMNS: Record<ImportKind, { required: string[]; optional: string[] }> = {
  students: {
    required: ['admission_no', 'full_name', 'admitted_on'],
    optional: ['name_with_initials', 'date_of_birth', 'gender', 'grade', 'class'],
  },
  staff: { required: ['staff_no', 'full_name'], optional: ['name_with_initials', 'designation', 'work_email', 'work_phone', 'joined_on'] },
  guardians: { required: ['student_admission_no', 'full_name', 'relationship'], optional: ['phone', 'email', 'is_primary'] },
};

// Cell parsing ---------------------------------------------------------------
/** Empty cells and absent optional columns both mean "no value". */
const blankToNull = (v: unknown) => (v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v);
/** Accepts YYYY-MM-DD and day-first DD/MM/YYYY (common in Sri Lankan spreadsheets). */
const csvDate = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : v.trim();
}, isoDateSchema);
const optDate = z.preprocess(blankToNull, csvDate.nullable());
const optText = (max: number) => z.preprocess(blankToNull, z.string().max(max).nullable());
const refNo = z
  .string()
  .min(1, 'Required')
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9/.-]*$/, 'Use letters, digits, / - .');
const name = z.string().min(1, 'Required').max(191);
const lower = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

const studentRow = z.object({
  admission_no: refNo,
  full_name: name,
  name_with_initials: optText(191),
  date_of_birth: optDate,
  gender: z.preprocess((v) => blankToNull(lower(v)), z.enum(GENDERS).nullable()),
  admitted_on: csvDate,
  grade: optText(64),
  class: optText(32),
});
const staffRow = z.object({
  staff_no: refNo,
  full_name: name,
  name_with_initials: optText(191),
  designation: optText(64),
  work_email: z.preprocess((v) => blankToNull(lower(v)), z.email('Not a valid email address').max(191).nullable()),
  work_phone: z.preprocess(
    blankToNull,
    z
      .string()
      .max(32)
      .regex(/^\+?[0-9 ()-]{7,}$/, 'Not a valid phone number')
      .nullable(),
  ),
  joined_on: optDate,
});
const guardianRow = z.object({
  student_admission_no: refNo,
  full_name: name,
  relationship: z.preprocess(lower, z.enum(GUARDIAN_RELATIONSHIPS)),
  phone: z.preprocess(
    blankToNull,
    z
      .string()
      .max(32)
      .regex(/^\+?[0-9 ()-]{7,}$/, 'Not a valid phone number')
      .nullable(),
  ),
  email: z.preprocess((v) => blankToNull(lower(v)), z.email('Not a valid email address').max(191).nullable()),
  is_primary: z.preprocess((v) => ['yes', 'y', 'true', '1'].includes(String(lower(v) ?? '')), z.boolean()),
});

/** Spreadsheet line number for a data row (header is line 1). */
const lineOf = (index: number) => index + 2;

function zodErrors(index: number, err: z.ZodError): RowError[] {
  return err.issues.map((i) => ({ row: lineOf(index), field: String(i.path[0] ?? ''), message: i.message }));
}

// Importers ------------------------------------------------------------------
async function importStudents(trx: Trx, req: FastifyRequest, rows: Record<string, string>[]): Promise<Outcome> {
  const out: Outcome = { created: 0, updated: 0, unchanged: 0, errors: [] };
  const seen = new Set<string>();
  const currentYear = await trx.selectFrom('academic_years').select(['id', 'starts_on']).where('is_current', '=', 1).executeTakeFirst();
  const sections = currentYear
    ? await trx
        .selectFrom('class_sections as c')
        .innerJoin('grades as g', 'g.id', 'c.grade_id')
        .select(['c.id', 'c.name', 'g.name as grade_name'])
        .where('c.academic_year_id', '=', currentYear.id)
        .execute()
    : [];
  const sectionKey = (g: string, c: string) => `${g.toLowerCase()}\u0000${c.toLowerCase()}`;
  const sectionByKey = new Map(sections.map((s) => [sectionKey(s.grade_name, s.name), s.id]));

  for (const [index, raw] of rows.entries()) {
    const parsed = studentRow.safeParse(raw);
    if (!parsed.success) {
      out.errors.push(...zodErrors(index, parsed.error));
      continue;
    }
    const r = parsed.data;
    const key = r.admission_no.toLowerCase();
    if (seen.has(key)) {
      out.errors.push({ row: lineOf(index), field: 'admission_no', message: 'Appears more than once in this file' });
      continue;
    }
    seen.add(key);
    let sectionId: number | null = null;
    if (r.grade || r.class) {
      if (!r.grade || !r.class) {
        out.errors.push({ row: lineOf(index), field: r.grade ? 'class' : 'grade', message: 'Give both grade and class, or neither' });
        continue;
      }
      sectionId = sectionByKey.get(sectionKey(r.grade, r.class)) ?? null;
      if (!sectionId) {
        out.errors.push({ row: lineOf(index), field: 'class', message: 'No such class in the current academic year' });
        continue;
      }
    }

    const values = {
      admission_no: r.admission_no,
      full_name: r.full_name,
      name_with_initials: r.name_with_initials,
      date_of_birth: r.date_of_birth,
      gender: r.gender,
      admitted_on: r.admitted_on,
    };
    const existing = await trx.selectFrom('student_profiles').selectAll().where('admission_no', '=', r.admission_no).executeTakeFirst();
    let studentId: number;
    let changed = false;
    if (!existing) {
      const res = await trx.insertInto('student_profiles').values(values).executeTakeFirstOrThrow();
      studentId = Number(res.insertId);
      await trx
        .insertInto('student_status_events')
        .values({
          student_id: studentId,
          from_status: null,
          to_status: 'active',
          effective_on: r.admitted_on,
          reason: 'admitted',
          recorded_by: actorId(req),
        })
        .execute();
      out.created++;
    } else {
      studentId = existing.id;
      const diff = (Object.keys(values) as (keyof typeof values)[]).filter((k) => (existing[k] ?? null) !== (values[k] ?? null));
      if (diff.length > 0) {
        await trx.updateTable('student_profiles').set(values).where('id', '=', studentId).execute();
        changed = true;
      }
    }

    if (sectionId) {
      const open = await trx
        .selectFrom('enrollments')
        .select('class_section_id')
        .where('student_id', '=', studentId)
        .where('ends_on', 'is', null)
        .executeTakeFirst();
      if (!open) {
        const status = existing?.status ?? 'active';
        if (status !== 'active') {
          out.errors.push({ row: lineOf(index), field: 'class', message: 'Student is not active; re-admit them first' });
          continue;
        }
        const startsOn = r.admitted_on < currentYear!.starts_on ? currentYear!.starts_on : r.admitted_on;
        await enrollStudent(trx, req, studentId, { classSectionId: sectionId, startsOn, rollNo: null, endReason: 'section_change' });
        if (existing) changed = true;
      } else if (open.class_section_id !== sectionId) {
        out.errors.push({
          row: lineOf(index),
          field: 'class',
          message: 'Already enrolled in a different class; move them from their profile',
        });
        continue;
      }
    }
    if (existing) {
      if (changed) out.updated++;
      else out.unchanged++;
    }
  }
  return out;
}

async function importStaff(trx: Trx, rows: Record<string, string>[]): Promise<Outcome> {
  const out: Outcome = { created: 0, updated: 0, unchanged: 0, errors: [] };
  const seen = new Set<string>();
  for (const [index, raw] of rows.entries()) {
    const parsed = staffRow.safeParse(raw);
    if (!parsed.success) {
      out.errors.push(...zodErrors(index, parsed.error));
      continue;
    }
    const r = parsed.data;
    if (seen.has(r.staff_no.toLowerCase())) {
      out.errors.push({ row: lineOf(index), field: 'staff_no', message: 'Appears more than once in this file' });
      continue;
    }
    seen.add(r.staff_no.toLowerCase());
    const values = {
      staff_no: r.staff_no,
      full_name: r.full_name,
      name_with_initials: r.name_with_initials,
      designation: r.designation,
      work_email: r.work_email,
      work_phone: r.work_phone,
      joined_on: r.joined_on,
    };
    const existing = await trx.selectFrom('staff_profiles').selectAll().where('staff_no', '=', r.staff_no).executeTakeFirst();
    if (!existing) {
      await trx.insertInto('staff_profiles').values(values).execute();
      out.created++;
    } else if ((Object.keys(values) as (keyof typeof values)[]).some((k) => (existing[k] ?? null) !== (values[k] ?? null))) {
      await trx.updateTable('staff_profiles').set(values).where('id', '=', existing.id).execute();
      out.updated++;
    } else {
      out.unchanged++;
    }
  }
  return out;
}

async function importGuardians(trx: Trx, rows: Record<string, string>[]): Promise<Outcome> {
  const out: Outcome = { created: 0, updated: 0, unchanged: 0, errors: [] };
  for (const [index, raw] of rows.entries()) {
    const parsed = guardianRow.safeParse(raw);
    if (!parsed.success) {
      out.errors.push(...zodErrors(index, parsed.error));
      continue;
    }
    const r = parsed.data;
    const student = await trx
      .selectFrom('student_profiles')
      .select('id')
      .where('admission_no', '=', r.student_admission_no)
      .executeTakeFirst();
    if (!student) {
      out.errors.push({ row: lineOf(index), field: 'student_admission_no', message: 'No student with this admission number' });
      continue;
    }
    // Match an existing guardian: phone, then email, then same name already linked to this student.
    let guardian = r.phone
      ? await trx.selectFrom('guardian_profiles').selectAll().where('phone', '=', r.phone).executeTakeFirst()
      : undefined;
    if (!guardian && r.email)
      guardian = await trx.selectFrom('guardian_profiles').selectAll().where('email', '=', r.email).executeTakeFirst();
    if (!guardian) {
      guardian = await trx
        .selectFrom('guardian_profiles as gp')
        .innerJoin('student_guardians as sg', 'sg.guardian_id', 'gp.id')
        .selectAll('gp')
        .where('sg.student_id', '=', student.id)
        .where('gp.full_name', '=', r.full_name)
        .executeTakeFirst();
    }
    let changed = false;
    let guardianId: number;
    let created = false;
    if (!guardian) {
      const res = await trx
        .insertInto('guardian_profiles')
        .values({ full_name: r.full_name, phone: r.phone, email: r.email })
        .executeTakeFirstOrThrow();
      guardianId = Number(res.insertId);
      created = true;
    } else {
      guardianId = guardian.id;
      const next = { full_name: r.full_name, phone: r.phone ?? guardian.phone, email: r.email ?? guardian.email };
      if (next.full_name !== guardian.full_name || next.phone !== guardian.phone || next.email !== guardian.email) {
        await trx.updateTable('guardian_profiles').set(next).where('id', '=', guardianId).execute();
        changed = true;
      }
    }
    const link = await trx
      .selectFrom('student_guardians')
      .select(['relationship', 'is_primary'])
      .where('student_id', '=', student.id)
      .where('guardian_id', '=', guardianId)
      .executeTakeFirst();
    if (r.is_primary && !(link && link.is_primary)) {
      await trx
        .updateTable('student_guardians')
        .set({ is_primary: 0 })
        .where('student_id', '=', student.id)
        .where('guardian_id', '!=', guardianId)
        .execute();
    }
    if (!link) {
      // New links always start pending: the registrar verifies them before the guardian sees anything.
      await trx
        .insertInto('student_guardians')
        .values({ student_id: student.id, guardian_id: guardianId, relationship: r.relationship, is_primary: r.is_primary ? 1 : 0 })
        .execute();
      changed = true;
    } else if (link.relationship !== r.relationship || Boolean(link.is_primary) !== r.is_primary) {
      await trx
        .updateTable('student_guardians')
        .set({ relationship: r.relationship, is_primary: r.is_primary ? 1 : 0 })
        .where('student_id', '=', student.id)
        .where('guardian_id', '=', guardianId)
        .execute();
      changed = true;
    }
    if (created) out.created++;
    else if (changed) out.updated++;
    else out.unchanged++;
  }
  return out;
}

function runImporter(trx: Trx, req: FastifyRequest, kind: ImportKind, rows: Record<string, string>[]): Promise<Outcome> {
  if (kind === 'students') return importStudents(trx, req, rows);
  if (kind === 'staff') return importStaff(trx, rows);
  return importGuardians(trx, rows);
}

/** Parse the file and check headers. Throws a 422 with a file-level message. */
function readRows(kind: ImportKind, content: string): Record<string, string>[] {
  let parsed;
  try {
    parsed = parseCsv(content);
  } catch (e) {
    if (e instanceof CsvError) throw new AppError('VALIDATION_FAILED', 'errors.importBadFile', [{ path: 'content', message: e.message }]);
    throw e;
  }
  const cols = IMPORT_COLUMNS[kind];
  const missing = cols.required.filter((c) => !parsed.headers.includes(c));
  if (missing.length > 0) {
    throw new AppError('VALIDATION_FAILED', 'errors.importMissingColumns', [
      { path: 'content', message: `Missing columns: ${missing.join(', ')}` },
    ]);
  }
  if (parsed.rows.length === 0)
    throw new AppError('VALIDATION_FAILED', 'errors.importBadFile', [{ path: 'content', message: 'No data rows' }]);
  if (parsed.rows.length > IMPORT_MAX_ROWS) {
    throw new AppError('VALIDATION_FAILED', 'errors.importBadFile', [
      { path: 'content', message: `At most ${IMPORT_MAX_ROWS} rows per file` },
    ]);
  }
  return csvObjects(parsed);
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const toJob = (j: {
  id: number;
  kind: ImportKind;
  status: string;
  file_name: string;
  total_rows: number;
  created_rows: number;
  updated_rows: number;
  unchanged_rows: number;
  error_rows: number;
  errors: string | null;
  created_at: Date;
  applied_at: Date | null;
}) => ({
  id: j.id,
  kind: j.kind,
  status: j.status,
  fileName: j.file_name,
  totalRows: j.total_rows,
  created: j.created_rows,
  updated: j.updated_rows,
  unchanged: j.unchanged_rows,
  errorRows: j.error_rows,
  errors: j.errors ? (JSON.parse(j.errors) as RowError[]) : [],
  createdAt: new Date(j.created_at).toISOString(),
  appliedAt: j.applied_at ? new Date(j.applied_at).toISOString() : null,
});
export type ImportJobItem = ReturnType<typeof toJob>;

export const importRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  const anyImport = requirePermission('students.manage', 'staff.manage', 'guardians.link.manage');
  const assertKind = (req: FastifyRequest, kind: ImportKind) => {
    if (!req.auth!.permissions.has(KIND_PERMISSION[kind])) throw forbidden();
  };
  /** Kinds this user may import (list/detail only show those). */
  const allowedKinds = (req: FastifyRequest) =>
    (Object.keys(KIND_PERMISSION) as ImportKind[]).filter((k) => req.auth!.permissions.has(KIND_PERMISSION[k]));
  const BODY_LIMIT = 4 * 1024 * 1024;

  app.get('/imports', { preHandler: anyImport }, async (req) => {
    const q = importListQuerySchema.parse(req.query);
    const kinds = q.kind ? [q.kind].filter((k) => allowedKinds(req).includes(k)) : allowedKinds(req);
    if (kinds.length === 0) return toPaginated([], 0, q);
    const base = db.selectFrom('import_jobs').where('kind', 'in', kinds);
    const { limit, offset } = pageWindow(q);
    const [rows, total] = await Promise.all([
      base.selectAll().orderBy('id', 'desc').limit(limit).offset(offset).execute(),
      base.select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return toPaginated(
      rows.map((r) => ({ ...toJob(r), errors: undefined })),
      total.n,
      q,
    );
  });

  app.get('/imports/:id', { preHandler: anyImport }, async (req) => {
    const job = await db.selectFrom('import_jobs').selectAll().where('id', '=', routeId(req)).executeTakeFirst();
    if (!job || !allowedKinds(req).includes(job.kind)) throw notFound();
    return toJob(job);
  });

  /** Upload + preview. Nothing is written except the import_jobs row. */
  app.post('/imports', { preHandler: anyImport, bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const input = importUploadSchema.parse(req.body);
    assertKind(req, input.kind);
    const rows = readRows(input.kind, input.content);
    const hash = sha256(input.content);

    let outcome: Outcome;
    try {
      await db.transaction().execute(async (trx) => {
        throw new PreviewRollback(await runImporter(trx, req, input.kind, rows));
      });
      throw new Error('unreachable');
    } catch (e) {
      if (!(e instanceof PreviewRollback)) throw e;
      outcome = e.outcome;
    }
    const errorRows = new Set(outcome.errors.map((x) => x.row)).size;
    const res = await db
      .insertInto('import_jobs')
      .values({
        kind: input.kind,
        status: 'previewed',
        file_name: input.fileName,
        file_sha256: hash,
        total_rows: rows.length,
        created_rows: outcome.created,
        updated_rows: outcome.updated,
        unchanged_rows: outcome.unchanged,
        error_rows: errorRows,
        errors: outcome.errors.length ? JSON.stringify(outcome.errors.slice(0, MAX_STORED_ERRORS)) : null,
        created_by: actorId(req),
      })
      .executeTakeFirstOrThrow();
    const job = await db.selectFrom('import_jobs').selectAll().where('id', '=', Number(res.insertId)).executeTakeFirstOrThrow();
    const applied = await db
      .selectFrom('import_jobs')
      .select(['id', 'applied_at'])
      .where('kind', '=', input.kind)
      .where('file_sha256', '=', hash)
      .where('status', '=', 'applied')
      .executeTakeFirst();
    return reply.status(201).send({ ...toJob(job), alreadyAppliedAs: applied?.id ?? null });
  });

  app.post('/imports/:id/apply', { preHandler: anyImport, bodyLimit: BODY_LIMIT }, async (req) => {
    const id = routeId(req);
    const { content } = z.object({ content: importUploadSchema.shape.content }).parse(req.body);
    return db.transaction().execute(async (trx) => {
      const job = await trx.selectFrom('import_jobs').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!job || !allowedKinds(req).includes(job.kind)) throw notFound();
      if (job.status !== 'previewed') throw new AppError('CONFLICT', 'errors.importAlreadyApplied');
      if (sha256(content) !== job.file_sha256) throw new AppError('CONFLICT', 'errors.importFileChanged');
      const duplicate = await trx
        .selectFrom('import_jobs')
        .select('id')
        .where('kind', '=', job.kind)
        .where('file_sha256', '=', job.file_sha256)
        .where('status', '=', 'applied')
        .forUpdate()
        .executeTakeFirst();
      if (duplicate) throw new AppError('CONFLICT', 'errors.importAlreadyApplied');

      const outcome = await runImporter(trx, req, job.kind, readRows(job.kind, content));
      if (outcome.errors.length > 0) {
        throw new AppError(
          'VALIDATION_FAILED',
          'errors.importHasErrors',
          outcome.errors.slice(0, 50).map((e) => ({ path: `${e.row}.${e.field}`, message: e.message })),
        );
      }
      await trx
        .updateTable('import_jobs')
        .set({
          status: 'applied',
          created_rows: outcome.created,
          updated_rows: outcome.updated,
          unchanged_rows: outcome.unchanged,
          error_rows: 0,
          errors: null,
          applied_at: sql<Date>`CURRENT_TIMESTAMP`,
        })
        .where('id', '=', id)
        .execute();
      await recordAudit(trx, req, {
        action: 'import.applied',
        entityType: 'import_job',
        entityId: id,
        metadata: { kind: job.kind, created: outcome.created, updated: outcome.updated, unchanged: outcome.unchanged },
      });
      return toJob(await trx.selectFrom('import_jobs').selectAll().where('id', '=', id).executeTakeFirstOrThrow());
    });
  });
};
