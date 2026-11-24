import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import {
  createComponentSchema,
  createExamSeriesSchema,
  createGradingScaleSchema,
  publishResultsSchema,
  reviseGradingScaleSchema,
  saveMarksSchema,
  sheetActionSchema,
} from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database, MarkSheetStatus } from '../../db/types.js';
import type { AuthContext } from '../../plugins/auth.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, forbidden, invalid, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';
import { routeId } from '../people/common.js';
import { staffIdOf } from '../people/scope.js';
import { calculateResults, type Band } from './calculate.js';

/**
 * Exams, marks, moderation, approval and result releases (roadmap E-1…E-6).
 *
 * Roles: `exams.manage` sets up scales, series and components (coordinator). `marks.enter.scoped` enters marks
 * for classes + subjects the teacher is assigned to, while the sheet is open. `marks.moderate` moderates and
 * may change marks after submission (reason required, logged in mark_changes). `results.approve` approves
 * sheets and may reopen them with a reason. `results.publish` publishes a class's results as an immutable,
 * versioned snapshot; a correction is a new version with a reason. Released results are what students and
 * guardians see (`results.read.own`), never live marks.
 */
type Trx = Kysely<Database>;
const canSetup = requirePermission('exams.manage');
const canReadExams = requirePermission('exams.manage', 'marks.enter.scoped', 'marks.moderate', 'results.approve', 'results.publish');
const sheetParams = z.object({ id: z.coerce.number().int().positive(), classSectionId: z.coerce.number().int().positive() });
const parseBands = (json: string) => JSON.parse(json) as Band[];

async function teachesSubject(db: Trx, auth: AuthContext, classSectionId: number, subjectId: number): Promise<boolean> {
  const staffId = await staffIdOf(db, auth.user.id);
  if (!staffId) return false;
  return Boolean(
    await db
      .selectFrom('teacher_assignments')
      .select('id')
      .where('staff_id', '=', staffId)
      .where('class_section_id', '=', classSectionId)
      .where('subject_id', '=', subjectId)
      .executeTakeFirst(),
  );
}

/** Component + section, checked to belong together (same grade, same academic year). */
async function loadSheetContext(db: Trx, componentId: number, classSectionId: number) {
  const ctx = await db
    .selectFrom('exam_components as c')
    .innerJoin('exam_series as s', 's.id', 'c.series_id')
    .innerJoin('subjects as sub', 'sub.id', 'c.subject_id')
    .select([
      'c.id',
      'c.series_id',
      'c.grade_id',
      'c.subject_id',
      'c.name',
      'c.max_marks',
      's.academic_year_id',
      's.name as series_name',
      'sub.name as subject_name',
    ])
    .where('c.id', '=', componentId)
    .executeTakeFirst();
  const section = await db
    .selectFrom('class_sections')
    .select(['id', 'grade_id', 'academic_year_id', 'name'])
    .where('id', '=', classSectionId)
    .executeTakeFirst();
  if (!ctx || !section || section.grade_id !== ctx.grade_id || section.academic_year_id !== ctx.academic_year_id) return null;
  return { ...ctx, sectionName: section.name };
}

/** Students on the sheet: those enrolled in the section now. */
async function sheetStudents(db: Trx, classSectionId: number) {
  const enrolled = await db
    .selectFrom('enrollments as e')
    .innerJoin('student_profiles as s', 's.id', 'e.student_id')
    .select(['s.id', 's.full_name', 's.admission_no', 'e.roll_no'])
    .where('e.class_section_id', '=', classSectionId)
    .where('e.ends_on', 'is', null)
    .orderBy('e.roll_no')
    .orderBy('s.full_name')
    .execute();
  return enrolled.map((r) => ({ id: r.id, fullName: r.full_name, admissionNo: r.admission_no, rollNo: r.roll_no }));
}

async function sheetStatus(db: Trx, componentId: number, classSectionId: number): Promise<MarkSheetStatus> {
  const row = await db
    .selectFrom('mark_sheets')
    .select('status')
    .where('component_id', '=', componentId)
    .where('class_section_id', '=', classSectionId)
    .executeTakeFirst();
  return row?.status ?? 'open';
}

export const examRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  // Grading scales ------------------------------------------------------------------
  app.get('/grading-scales', { preHandler: canReadExams }, async () => {
    const scales = await db.selectFrom('grading_scales').selectAll().orderBy('name').execute();
    const versions = await db.selectFrom('grading_scale_versions').selectAll().orderBy('scale_id').orderBy('version', 'desc').execute();
    return {
      items: scales.map((s) => ({
        id: s.id,
        name: s.name,
        versions: versions
          .filter((v) => v.scale_id === s.id)
          .map((v) => ({ id: v.id, version: v.version, bands: parseBands(v.bands), createdAt: new Date(v.created_at).toISOString() })),
      })),
    };
  });

  app.post('/grading-scales', { preHandler: canSetup }, async (req, reply) => {
    const input = createGradingScaleSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      const res = await trx.insertInto('grading_scales').values({ name: input.name }).executeTakeFirstOrThrow();
      const sid = Number(res.insertId);
      await trx
        .insertInto('grading_scale_versions')
        .values({ scale_id: sid, version: 1, bands: JSON.stringify(sortBands(input.bands)), created_by: req.auth!.user.id })
        .execute();
      await recordAudit(trx, req, { action: 'grading_scale.created', entityType: 'grading_scale', entityId: sid });
      return sid;
    });
    return reply.status(201).send({ id });
  });

  /** A changed scale is a new version; series keep the version they were set up with. */
  app.post('/grading-scales/:id/versions', { preHandler: canSetup }, async (req, reply) => {
    const id = routeId(req);
    const input = reviseGradingScaleSchema.parse(req.body);
    const out = await db.transaction().execute(async (trx) => {
      const scale = await trx.selectFrom('grading_scales').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      if (!scale) throw notFound();
      const last = await trx
        .selectFrom('grading_scale_versions')
        .select(trx.fn.max('version').as('v'))
        .where('scale_id', '=', id)
        .executeTakeFirstOrThrow();
      const version = Number(last.v ?? 0) + 1;
      const res = await trx
        .insertInto('grading_scale_versions')
        .values({ scale_id: id, version, bands: JSON.stringify(sortBands(input.bands)), created_by: req.auth!.user.id })
        .executeTakeFirstOrThrow();
      await recordAudit(trx, req, { action: 'grading_scale.revised', entityType: 'grading_scale', entityId: id, metadata: { version } });
      return { id: Number(res.insertId), version };
    });
    return reply.status(201).send(out);
  });

  // Series and components --------------------------------------------------------------
  app.get('/exam-series', { preHandler: canReadExams }, async (req) => {
    const { academicYearId } = z.object({ academicYearId: z.coerce.number().int().positive().optional() }).parse(req.query);
    let q = db
      .selectFrom('exam_series as s')
      .innerJoin('academic_years as y', 'y.id', 's.academic_year_id')
      .leftJoin('terms as t', 't.id', 's.term_id')
      .innerJoin('grading_scale_versions as gv', 'gv.id', 's.grading_scale_version_id')
      .innerJoin('grading_scales as g', 'g.id', 'gv.scale_id')
      .select([
        's.id',
        's.name',
        'y.id as year_id',
        'y.label as year_label',
        't.label as term_label',
        'g.name as scale_name',
        'gv.version as scale_version',
      ]);
    if (academicYearId) q = q.where('s.academic_year_id', '=', academicYearId);
    const rows = await q.orderBy('y.starts_on', 'desc').orderBy('s.id', 'desc').execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        academicYear: { id: r.year_id, label: r.year_label },
        term: r.term_label,
        scale: `${r.scale_name} v${r.scale_version}`,
      })),
    };
  });

  app.post('/exam-series', { preHandler: canSetup }, async (req, reply) => {
    const input = createExamSeriesSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      if (input.termId) {
        const term = await trx.selectFrom('terms').select('academic_year_id').where('id', '=', input.termId).executeTakeFirst();
        if (!term || term.academic_year_id !== input.academicYearId) throw invalid('termId', 'Term is not in that year');
      }
      const res = await trx
        .insertInto('exam_series')
        .values({
          academic_year_id: input.academicYearId,
          term_id: input.termId,
          name: input.name,
          grading_scale_version_id: input.gradingScaleVersionId,
          created_by: req.auth!.user.id,
        })
        .executeTakeFirstOrThrow();
      const sid = Number(res.insertId);
      await recordAudit(trx, req, { action: 'exam.series_created', entityType: 'exam_series', entityId: sid });
      return sid;
    });
    return reply.status(201).send({ id });
  });

  /** Series detail: components with per-class sheet status. Teachers see only their own class/subject sheets. */
  app.get('/exam-series/:id', { preHandler: canReadExams }, async (req) => {
    const id = routeId(req);
    const auth = req.auth!;
    const series = await db
      .selectFrom('exam_series as s')
      .innerJoin('grading_scale_versions as gv', 'gv.id', 's.grading_scale_version_id')
      .innerJoin('grading_scales as g', 'g.id', 'gv.scale_id')
      .select([
        's.id',
        's.name',
        's.academic_year_id',
        'gv.id as scale_version_id',
        'gv.bands',
        'gv.version as scale_version',
        'g.name as scale_name',
      ])
      .where('s.id', '=', id)
      .executeTakeFirst();
    if (!series) throw notFound();
    const comps = await db
      .selectFrom('exam_components as c')
      .innerJoin('grades as gr', 'gr.id', 'c.grade_id')
      .innerJoin('subjects as sub', 'sub.id', 'c.subject_id')
      .select([
        'c.id',
        'c.name',
        'c.max_marks',
        'c.weight',
        'c.grade_id',
        'c.subject_id',
        'c.paper_version_id',
        'gr.name as grade_name',
        'gr.level',
        'sub.name as subject_name',
      ])
      .where('c.series_id', '=', id)
      .orderBy('gr.level')
      .orderBy('sub.name')
      .orderBy('c.name')
      .execute();
    const sections = await db
      .selectFrom('class_sections')
      .select(['id', 'name', 'grade_id'])
      .where('academic_year_id', '=', series.academic_year_id)
      .orderBy('name')
      .execute();
    const sheets = await db
      .selectFrom('mark_sheets')
      .select(['component_id', 'class_section_id', 'status'])
      .where('component_id', 'in', comps.length ? comps.map((c) => c.id) : [0])
      .execute();
    const sheetMap = new Map(sheets.map((s) => [`${s.component_id}:${s.class_section_id}`, s.status]));
    const fullView =
      auth.permissions.has('exams.manage') ||
      auth.permissions.has('marks.moderate') ||
      auth.permissions.has('results.approve') ||
      auth.permissions.has('results.publish');
    const staffId = fullView ? null : await staffIdOf(db, auth.user.id);
    const mine = staffId
      ? await db.selectFrom('teacher_assignments').select(['class_section_id', 'subject_id']).where('staff_id', '=', staffId).execute()
      : [];
    const allowed = (sectionId: number, subjectId: number) =>
      fullView || mine.some((m) => m.class_section_id === sectionId && m.subject_id === subjectId);
    return {
      id: series.id,
      name: series.name,
      academicYearId: series.academic_year_id,
      scale: {
        versionId: series.scale_version_id,
        name: series.scale_name,
        version: series.scale_version,
        bands: parseBands(series.bands),
      },
      components: comps
        .map((c) => ({
          id: c.id,
          name: c.name,
          maxMarks: Number(c.max_marks),
          weight: Number(c.weight),
          paperVersionId: c.paper_version_id,
          grade: { id: c.grade_id, name: c.grade_name },
          subject: { id: c.subject_id, name: c.subject_name },
          sheets: sections
            .filter((s) => s.grade_id === c.grade_id && allowed(s.id, c.subject_id))
            .map((s) => ({ classSectionId: s.id, className: s.name, status: sheetMap.get(`${c.id}:${s.id}`) ?? 'open' })),
        }))
        .filter((c) => fullView || c.sheets.length > 0),
      classes: fullView ? sections.map((s) => ({ id: s.id, name: s.name, gradeId: s.grade_id })) : [],
    };
  });

  app.post('/exam-series/:id/components', { preHandler: canSetup }, async (req, reply) => {
    const id = routeId(req);
    const input = createComponentSchema.parse(req.body);
    const cid = await db.transaction().execute(async (trx) => {
      const series = await trx.selectFrom('exam_series').select('id').where('id', '=', id).executeTakeFirst();
      if (!series) throw notFound();
      const taken = await trx
        .selectFrom('grade_subjects')
        .select('subject_id')
        .where('grade_id', '=', input.gradeId)
        .where('subject_id', '=', input.subjectId)
        .executeTakeFirst();
      if (!taken) throw invalid('subjectId', 'This grade does not take that subject');
      if (input.paperVersionId) {
        const pv = await trx
          .selectFrom('exam_paper_versions as v')
          .innerJoin('exam_papers as p', 'p.id', 'v.paper_id')
          .select(['v.status', 'p.subject_id', 'p.grade_id'])
          .where('v.id', '=', input.paperVersionId)
          .executeTakeFirst();
        if (!pv || pv.status !== 'final' || pv.subject_id !== input.subjectId || pv.grade_id !== input.gradeId)
          throw invalid('paperVersionId', 'Choose a final paper for this grade and subject');
      }
      const res = await trx
        .insertInto('exam_components')
        .values({
          series_id: id,
          grade_id: input.gradeId,
          subject_id: input.subjectId,
          name: input.name,
          max_marks: input.maxMarks.toFixed(2),
          weight: input.weight.toFixed(2),
          paper_version_id: input.paperVersionId,
        })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      await recordAudit(trx, req, {
        action: 'exam.component_created',
        entityType: 'exam_series',
        entityId: id,
        metadata: { componentId: newId, gradeId: input.gradeId, subjectId: input.subjectId },
      });
      return newId;
    });
    return reply.status(201).send({ id: cid });
  });

  app.delete('/exam-components/:id', { preHandler: canSetup }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const c = await trx.selectFrom('exam_components').select('series_id').where('id', '=', id).executeTakeFirst();
      if (!c) throw notFound();
      const used = await trx.selectFrom('marks').select('student_id').where('component_id', '=', id).executeTakeFirst();
      if (used) throw new AppError('CONFLICT', 'errors.inUse');
      await trx.deleteFrom('mark_sheets').where('component_id', '=', id).execute();
      await trx.deleteFrom('exam_components').where('id', '=', id).execute();
      await recordAudit(trx, req, {
        action: 'exam.component_deleted',
        entityType: 'exam_series',
        entityId: c.series_id,
        metadata: { componentId: id },
      });
    });
    return reply.status(204).send();
  });

  // Mark sheets ----------------------------------------------------------------------
  const sheetAccess = async (trx: Trx, req: FastifyRequest, componentId: number, classSectionId: number) => {
    const ctx = await loadSheetContext(trx, componentId, classSectionId);
    if (!ctx) throw notFound();
    const p = req.auth!.permissions;
    const teacher = p.has('marks.enter.scoped') && (await teachesSubject(trx, req.auth!, classSectionId, ctx.subject_id));
    const staffView = p.has('marks.moderate') || p.has('results.approve') || p.has('exams.manage') || p.has('results.publish');
    if (!teacher && !staffView) throw notFound();
    return { ctx, teacher, moderator: p.has('marks.moderate'), approver: p.has('results.approve') };
  };

  app.get('/exam-components/:id/sheets/:classSectionId', { preHandler: canReadExams }, async (req) => {
    const { id, classSectionId } = sheetParams.parse(req.params);
    const { ctx, teacher, moderator, approver } = await sheetAccess(db, req, id, classSectionId);
    const status = await sheetStatus(db, id, classSectionId);
    const students = await sheetStudents(db, classSectionId);
    const marks = await db.selectFrom('marks').selectAll().where('component_id', '=', id).execute();
    const changes = await db
      .selectFrom('mark_changes as mc')
      .leftJoin('users as u', 'u.id', 'mc.changed_by')
      .select([
        'mc.student_id',
        'mc.from_mark',
        'mc.from_status',
        'mc.to_mark',
        'mc.to_status',
        'mc.reason',
        'mc.changed_at',
        'u.display_name as changed_by',
      ])
      .where('mc.component_id', '=', id)
      .orderBy('mc.changed_at', 'desc')
      .execute();
    const byStudent = new Map(marks.map((m) => [m.student_id, m]));
    const sheet = await db
      .selectFrom('mark_sheets')
      .selectAll()
      .where('component_id', '=', id)
      .where('class_section_id', '=', classSectionId)
      .executeTakeFirst();
    return {
      component: {
        id: ctx.id,
        name: ctx.name,
        maxMarks: Number(ctx.max_marks),
        subject: ctx.subject_name,
        series: ctx.series_name,
        seriesId: ctx.series_id,
      },
      classSection: { id: classSectionId, name: ctx.sectionName },
      status,
      reopenReason: sheet?.reopen_reason ?? null,
      timeline: {
        submittedAt: sheet?.submitted_at ? new Date(sheet.submitted_at).toISOString() : null,
        moderatedAt: sheet?.moderated_at ? new Date(sheet.moderated_at).toISOString() : null,
        approvedAt: sheet?.approved_at ? new Date(sheet.approved_at).toISOString() : null,
      },
      can: {
        enter: status === 'open' && (teacher || moderator),
        correct: (status === 'submitted' || status === 'moderated') && moderator,
        submit: status === 'open' && (teacher || moderator),
        moderate: status === 'submitted' && moderator,
        approve: (status === 'moderated' || status === 'submitted') && approver,
        reopen: status !== 'open' && (approver || (moderator && status !== 'approved')),
      },
      students: students.map((s) => {
        const m = byStudent.get(s.id);
        return { ...s, status: m?.status ?? null, rawMark: m?.raw_mark === null || m?.raw_mark === undefined ? null : Number(m.raw_mark) };
      }),
      changes: changes.map((c) => ({
        studentId: c.student_id,
        from: c.from_status === 'present' ? Number(c.from_mark) : c.from_status,
        to: c.to_status === 'present' ? Number(c.to_mark) : c.to_status,
        reason: c.reason,
        changedBy: c.changed_by,
        changedAt: new Date(c.changed_at).toISOString(),
      })),
    };
  });

  app.put(
    '/exam-components/:id/sheets/:classSectionId/marks',
    { preHandler: requirePermission('marks.enter.scoped', 'marks.moderate') },
    async (req) => {
      const { id, classSectionId } = sheetParams.parse(req.params);
      const input = saveMarksSchema.parse(req.body);
      return db.transaction().execute(async (trx) => {
        const { ctx, teacher, moderator } = await sheetAccess(trx, req, id, classSectionId);
        await trx
          .insertInto('mark_sheets')
          .values({ component_id: id, class_section_id: classSectionId })
          .onDuplicateKeyUpdate({ status: sql`status` })
          .execute();
        const sheet = await trx
          .selectFrom('mark_sheets')
          .select('status')
          .where('component_id', '=', id)
          .where('class_section_id', '=', classSectionId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const correcting = sheet.status === 'submitted' || sheet.status === 'moderated';
        if (sheet.status === 'approved') throw new AppError('CONFLICT', 'errors.sheetApproved');
        if (sheet.status === 'open' && !teacher && !moderator) throw forbidden();
        if (correcting && !moderator) throw new AppError('CONFLICT', 'errors.sheetSubmitted');
        if (correcting && !input.reason) throw invalid('reason', 'errors.reasonRequired');
        const max = Number(ctx.max_marks);
        const roster = new Set((await sheetStudents(trx, classSectionId)).map((s) => s.id));
        for (const m of input.marks) {
          if (!roster.has(m.studentId)) throw invalid('marks', 'A student is not in this class');
          if (m.rawMark !== null && m.rawMark > max) throw invalid('marks', `A mark is above the maximum (${max})`);
        }
        const before = new Map(
          (await trx.selectFrom('marks').selectAll().where('component_id', '=', id).forUpdate().execute()).map((m) => [m.student_id, m]),
        );
        let changed = 0;
        for (const m of input.marks) {
          const prev = before.get(m.studentId);
          const rawStr = m.rawMark === null ? null : m.rawMark.toFixed(2);
          if (prev && prev.status === m.status && (prev.raw_mark === null ? null : Number(prev.raw_mark).toFixed(2)) === rawStr) continue;
          await trx
            .insertInto('marks')
            .values({
              component_id: id,
              student_id: m.studentId,
              raw_mark: rawStr,
              status: m.status,
              max_marks: ctx.max_marks,
              entered_by: req.auth!.user.id,
            })
            .onDuplicateKeyUpdate({ raw_mark: rawStr, status: m.status, entered_by: req.auth!.user.id })
            .execute();
          if (correcting) {
            await trx
              .insertInto('mark_changes')
              .values({
                component_id: id,
                student_id: m.studentId,
                from_mark: prev?.raw_mark ?? null,
                from_status: prev?.status ?? null,
                to_mark: rawStr,
                to_status: m.status,
                reason: input.reason!,
                changed_by: req.auth!.user.id,
              })
              .execute();
          }
          changed++;
        }
        if (changed > 0) {
          await recordAudit(trx, req, {
            action: correcting ? 'marks.corrected' : 'marks.entered',
            entityType: 'exam_component',
            entityId: id,
            metadata: { classSectionId, changed },
          });
        }
        return { changed };
      });
    },
  );

  app.post(
    '/exam-components/:id/sheets/:classSectionId/actions',
    { preHandler: requirePermission('marks.enter.scoped', 'marks.moderate', 'results.approve') },
    async (req) => {
      const { id, classSectionId } = sheetParams.parse(req.params);
      const input = sheetActionSchema.parse(req.body);
      return db.transaction().execute(async (trx) => {
        const { teacher, moderator, approver } = await sheetAccess(trx, req, id, classSectionId);
        await trx
          .insertInto('mark_sheets')
          .values({ component_id: id, class_section_id: classSectionId })
          .onDuplicateKeyUpdate({ status: sql`status` })
          .execute();
        const sheet = await trx
          .selectFrom('mark_sheets')
          .select('status')
          .where('component_id', '=', id)
          .where('class_section_id', '=', classSectionId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const now = sql<Date>`CURRENT_TIMESTAMP`;
        const me = req.auth!.user.id;
        let next: MarkSheetStatus;
        const set: Partial<Record<string, unknown>> = {};
        if (input.action === 'submit') {
          if (sheet.status !== 'open') throw new AppError('CONFLICT', 'errors.sheetState');
          if (!teacher && !moderator) throw forbidden();
          const roster = await sheetStudents(trx, classSectionId);
          const marked = new Set(
            (await trx.selectFrom('marks').select('student_id').where('component_id', '=', id).execute()).map((m) => m.student_id),
          );
          if (roster.some((s) => !marked.has(s.id))) throw new AppError('CONFLICT', 'errors.marksIncomplete');
          next = 'submitted';
          Object.assign(set, { submitted_by: me, submitted_at: now });
        } else if (input.action === 'moderate') {
          if (sheet.status !== 'submitted') throw new AppError('CONFLICT', 'errors.sheetState');
          if (!moderator) throw forbidden();
          next = 'moderated';
          Object.assign(set, { moderated_by: me, moderated_at: now });
        } else if (input.action === 'approve') {
          if (sheet.status !== 'moderated' && sheet.status !== 'submitted') throw new AppError('CONFLICT', 'errors.sheetState');
          if (!approver) throw forbidden();
          next = 'approved';
          Object.assign(set, { approved_by: me, approved_at: now });
        } else {
          if (sheet.status === 'open') throw new AppError('CONFLICT', 'errors.sheetState');
          if (!(approver || (moderator && sheet.status !== 'approved'))) throw forbidden();
          if (!input.reason) throw invalid('reason', 'errors.reasonRequired');
          next = 'open';
          Object.assign(set, {
            submitted_by: null,
            submitted_at: null,
            moderated_by: null,
            moderated_at: null,
            approved_by: null,
            approved_at: null,
            reopened_by: me,
            reopened_at: now,
            reopen_reason: input.reason,
          });
        }
        await trx
          .updateTable('mark_sheets')
          .set({ ...set, status: next })
          .where('component_id', '=', id)
          .where('class_section_id', '=', classSectionId)
          .execute();
        const verb = { submit: 'submitted', moderate: 'moderated', approve: 'approved', reopen: 'reopened' }[input.action];
        // The reopen reason stays on the sheet; audit metadata holds states only.
        await recordAudit(trx, req, {
          action: `marks.sheet_${verb}`,
          entityType: 'exam_component',
          entityId: id,
          metadata: { classSectionId, from: sheet.status, to: next },
        });
        return { status: next };
      });
    },
  );

  // Results ---------------------------------------------------------------------------
  /** Compute a class's results for a series from current marks (preview, or the snapshot to publish). */
  async function computeClass(trx: Trx, seriesId: number, classSectionId: number) {
    const series = await trx
      .selectFrom('exam_series as s')
      .innerJoin('academic_years as y', 'y.id', 's.academic_year_id')
      .innerJoin('grading_scale_versions as gv', 'gv.id', 's.grading_scale_version_id')
      .innerJoin('grading_scales as g', 'g.id', 'gv.scale_id')
      .select([
        's.id',
        's.name',
        's.academic_year_id',
        'y.label as year_label',
        'gv.id as scale_version_id',
        'gv.version as scale_version',
        'gv.bands',
        'g.name as scale_name',
      ])
      .where('s.id', '=', seriesId)
      .executeTakeFirst();
    const section = await trx
      .selectFrom('class_sections as c')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .select(['c.id', 'c.name', 'c.grade_id', 'c.academic_year_id', 'g.name as grade_name'])
      .where('c.id', '=', classSectionId)
      .executeTakeFirst();
    if (!series || !section || section.academic_year_id !== series.academic_year_id) throw notFound();
    const comps = await trx
      .selectFrom('exam_components as c')
      .innerJoin('subjects as s', 's.id', 'c.subject_id')
      .select(['c.id', 'c.subject_id', 'c.name', 'c.max_marks', 'c.weight', 's.name as subject_name', 's.code'])
      .where('c.series_id', '=', seriesId)
      .where('c.grade_id', '=', section.grade_id)
      .orderBy('s.name')
      .orderBy('c.name')
      .execute();
    const sheets = await trx
      .selectFrom('mark_sheets')
      .select(['component_id', 'status'])
      .where('class_section_id', '=', classSectionId)
      .where('component_id', 'in', comps.length ? comps.map((c) => c.id) : [0])
      .execute();
    const statusOf = new Map(sheets.map((s) => [s.component_id, s.status]));
    const students = await sheetStudents(trx, classSectionId);
    const marks = comps.length
      ? await trx
          .selectFrom('marks')
          .select(['component_id', 'student_id', 'status', 'raw_mark'])
          .where(
            'component_id',
            'in',
            comps.map((c) => c.id),
          )
          .execute()
      : [];
    const subjects = [...new Map(comps.map((c) => [c.subject_id, { id: c.subject_id, name: c.subject_name, code: c.code }])).values()];
    const bands = parseBands(series.bands);
    const results = calculateResults({
      studentIds: students.map((s) => s.id),
      subjectIds: subjects.map((s) => s.id),
      components: comps.map((c) => ({
        id: c.id,
        subjectId: c.subject_id,
        name: c.name,
        maxMarks: Number(c.max_marks),
        weight: Number(c.weight),
      })),
      marks: marks.map((m) => ({
        componentId: m.component_id,
        studentId: m.student_id,
        status: m.status,
        rawMark: m.raw_mark === null ? null : Number(m.raw_mark),
      })),
      bands,
    });
    const allApproved = comps.length > 0 && comps.every((c) => statusOf.get(c.id) === 'approved');
    return {
      snapshot: {
        series: { id: series.id, name: series.name, year: series.year_label },
        classSection: { id: section.id, name: section.name, gradeName: section.grade_name },
        scale: { name: series.scale_name, version: series.scale_version, bands },
        rules: 'weighted-percent/v1',
        subjects,
        students: results.map((r) => {
          const s = students.find((x) => x.id === r.studentId)!;
          return { id: s.id, admissionNo: s.admissionNo, fullName: s.fullName, ...r };
        }),
      },
      sheets: comps.map((c) => ({ componentId: c.id, subject: c.subject_name, name: c.name, status: statusOf.get(c.id) ?? 'open' })),
      allApproved,
    };
  }

  const canSeeResults = requirePermission('marks.moderate', 'results.approve', 'results.publish', 'exams.manage');

  app.get('/exam-series/:id/classes/:classSectionId/results', { preHandler: canSeeResults }, async (req) => {
    const { id, classSectionId } = sheetParams.parse(req.params);
    const computed = await computeClass(db, id, classSectionId);
    const releases = await db
      .selectFrom('result_releases as r')
      .leftJoin('users as u', 'u.id', 'r.published_by')
      .select(['r.id', 'r.version', 'r.reason', 'r.published_at', 'u.display_name as published_by'])
      .where('r.series_id', '=', id)
      .where('r.class_section_id', '=', classSectionId)
      .orderBy('r.version', 'desc')
      .execute();
    return {
      preview: computed.snapshot,
      sheets: computed.sheets,
      allApproved: computed.allApproved,
      releases: releases.map((r) => ({
        id: r.id,
        version: r.version,
        reason: r.reason,
        publishedAt: new Date(r.published_at).toISOString(),
        publishedBy: r.published_by,
      })),
    };
  });

  /** Publish = append a new immutable snapshot. Existing releases are never changed. */
  app.post('/exam-series/:id/releases', { preHandler: requirePermission('results.publish') }, async (req, reply) => {
    const id = routeId(req);
    const input = publishResultsSchema.parse(req.body);
    const out = await db.transaction().execute(async (trx) => {
      await trx.selectFrom('exam_series').select('id').where('id', '=', id).forUpdate().executeTakeFirst();
      const computed = await computeClass(trx, id, input.classSectionId);
      if (!computed.allApproved) throw new AppError('CONFLICT', 'errors.resultsNotApproved');
      const last = await trx
        .selectFrom('result_releases')
        .select(trx.fn.max('version').as('v'))
        .where('series_id', '=', id)
        .where('class_section_id', '=', input.classSectionId)
        .executeTakeFirstOrThrow();
      const version = Number(last.v ?? 0) + 1;
      if (version > 1 && !input.reason) throw invalid('reason', 'errors.reasonRequired');
      const snapshot = JSON.stringify({ ...computed.snapshot, version, publishedAt: new Date().toISOString() });
      const res = await trx
        .insertInto('result_releases')
        .values({
          series_id: id,
          class_section_id: input.classSectionId,
          version,
          reason: version > 1 ? input.reason! : null,
          snapshot,
          snapshot_sha256: createHash('sha256').update(snapshot).digest('hex'),
          published_by: req.auth!.user.id,
        })
        .executeTakeFirstOrThrow();
      await recordAudit(trx, req, {
        action: version > 1 ? 'results.republished' : 'results.published',
        entityType: 'exam_series',
        entityId: id,
        metadata: { classSectionId: input.classSectionId, version, releaseId: Number(res.insertId) },
      });
      return { id: Number(res.insertId), version };
    });
    return reply.status(201).send(out);
  });

  app.get('/result-releases/:id', { preHandler: canSeeResults }, async (req) => {
    const r = await db.selectFrom('result_releases').selectAll().where('id', '=', routeId(req)).executeTakeFirst();
    if (!r) throw notFound();
    return {
      id: r.id,
      version: r.version,
      reason: r.reason,
      publishedAt: new Date(r.published_at).toISOString(),
      sha256: r.snapshot_sha256,
      snapshot: JSON.parse(r.snapshot),
    };
  });

  /**
   * Released results for me (student) or my verified child (guardian, `?studentId=`). Only the latest release
   * per series is shown, and only that student's row plus class size — never classmates' marks.
   */
  app.get('/me/results', { preHandler: requirePermission('results.read.own') }, async (req) => {
    const { studentId } = z.object({ studentId: z.coerce.number().int().positive().optional() }).parse(req.query);
    const userId = req.auth!.user.id;
    const own = await db.selectFrom('student_profiles').select('id').where('user_id', '=', userId).executeTakeFirst();
    let target = own?.id;
    if (studentId && studentId !== own?.id) {
      const link = await db
        .selectFrom('student_guardians as sg')
        .innerJoin('guardian_profiles as gp', 'gp.id', 'sg.guardian_id')
        .select('sg.student_id')
        .where('sg.student_id', '=', studentId)
        .where('sg.verification_status', '=', 'verified')
        .where('gp.user_id', '=', userId)
        .executeTakeFirst();
      if (!link) throw notFound();
      target = studentId;
    }
    if (!target) return { items: [] };
    const sections = await db.selectFrom('enrollments').select('class_section_id').distinct().where('student_id', '=', target).execute();
    if (sections.length === 0) return { items: [] };
    const releases = await db
      .selectFrom('result_releases as r')
      .select(['r.id', 'r.series_id', 'r.class_section_id', 'r.version', 'r.snapshot', 'r.published_at'])
      .where(
        'r.class_section_id',
        'in',
        sections.map((s) => s.class_section_id),
      )
      .where((eb) =>
        eb(
          'r.version',
          '=',
          eb
            .selectFrom('result_releases as r2')
            .select((e2) => e2.fn.max('r2.version').as('m'))
            .whereRef('r2.series_id', '=', 'r.series_id')
            .whereRef('r2.class_section_id', '=', 'r.class_section_id'),
        ),
      )
      .orderBy('r.published_at', 'desc')
      .execute();
    const items = [];
    for (const r of releases) {
      const snap = JSON.parse(r.snapshot) as {
        series: unknown;
        classSection: unknown;
        scale: unknown;
        subjects: Array<{ id: number; name: string }>;
        students: Array<{ id: number }>;
      };
      const row = snap.students.find((s) => s.id === target);
      if (!row) continue;
      items.push({
        releaseId: r.id,
        version: r.version,
        publishedAt: new Date(r.published_at).toISOString(),
        series: snap.series,
        classSection: snap.classSection,
        scale: snap.scale,
        subjects: snap.subjects,
        classSize: snap.students.length,
        result: row,
      });
    }
    await recordAudit(db, req, { action: 'results.viewed', entityType: 'student', entityId: target });
    return { items };
  });
};

function sortBands<T extends { min: number }>(bands: T[]): T[] {
  return [...bands].sort((a, b) => b.min - a.min);
}
