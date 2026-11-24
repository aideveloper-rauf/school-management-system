import type { FastifyPluginAsync } from 'fastify';
import { sql, type ExpressionBuilder, type Kysely, type Selectable } from 'kysely';
import { z } from 'zod';
import {
  createLearningItemSchema,
  learningListQuerySchema,
  pageWindow,
  returnSubmissionSchema,
  submitWorkSchema,
  toPaginated,
  updateLearningItemSchema,
} from '@sms/shared';
import type { AppConfig } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, forbidden, invalid, notFound } from '../../lib/errors.js';
import { MAX_FILE_BYTES, contentDisposition, openStoredFile, safeFileName, sniffMime, writeStoredFile } from '../../lib/files.js';
import type { AuthContext } from '../../plugins/auth.js';
import { requirePermission } from '../../plugins/auth.js';
import { routeId } from '../people/common.js';
import { staffIdOf } from '../people/scope.js';

/**
 * Learning materials, assignments and submissions (roadmap L-1…L-3).
 *
 * Who can do what:
 * - Manage (create/edit/publish/delete, see submissions, return work): `learning.manage.all`, or
 *   `learning.manage.scoped` for a class + subject the teacher is assigned to.
 * - Read: the managers above, `learning.read.all`, class teachers (their class), and with `learning.read.own`
 *   students now enrolled in the class and verified guardians of those students — published items only.
 * - Submit: the student themself, while enrolled in the class; late submissions only when allowed.
 * Files: uploaded first (raw bytes, sniffed type, 10 MB), then attached. A file is downloadable only by
 * someone who can read what it is attached to (or its uploader before it is attached).
 */
type Trx = Kysely<Database>;
type ItemEb = ExpressionBuilder<Database & { li: Database['learning_items'] }, 'li'>;

const canUseLearning = requirePermission('learning.manage.scoped', 'learning.manage.all', 'learning.read.all', 'learning.read.own');
const canManagePerm = requirePermission('learning.manage.scoped', 'learning.manage.all');

/** Class sections where the user is a currently enrolled student or a verified guardian of one. */
function familySections(eb: ItemEb, userId: number, studentId?: number) {
  let viaGuardian = eb
    .selectFrom('enrollments as e')
    .innerJoin('student_guardians as sg', 'sg.student_id', 'e.student_id')
    .innerJoin('guardian_profiles as gp', 'gp.id', 'sg.guardian_id')
    .select('e.class_section_id')
    .where('e.ends_on', 'is', null)
    .where('sg.verification_status', '=', 'verified')
    .where('gp.user_id', '=', userId);
  if (studentId) viaGuardian = viaGuardian.where('e.student_id', '=', studentId);
  return viaGuardian.union(
    eb
      .selectFrom('enrollments as e')
      .innerJoin('student_profiles as s', 's.id', 'e.student_id')
      .select('e.class_section_id')
      .where('e.ends_on', 'is', null)
      .where('s.user_id', '=', userId),
  );
}

/** WHERE clause over `learning_items as li` for items this user may read (null = all). */
function readScope(auth: AuthContext, studentId?: number) {
  const p = auth.permissions;
  if (p.has('learning.manage.all') || p.has('learning.read.all')) return null;
  const userId = auth.user.id;
  return (eb: ItemEb) =>
    eb.or([
      ...(p.has('learning.manage.scoped')
        ? [
            eb.exists(
              eb
                .selectFrom('teacher_assignments as ta')
                .innerJoin('staff_profiles as sp', 'sp.id', 'ta.staff_id')
                .select('ta.id')
                .whereRef('ta.class_section_id', '=', 'li.class_section_id')
                .whereRef('ta.subject_id', '=', 'li.subject_id')
                .where('sp.user_id', '=', userId),
            ),
            eb.exists(
              eb
                .selectFrom('class_sections as cs')
                .innerJoin('staff_profiles as sp', 'sp.id', 'cs.class_teacher_id')
                .select('cs.id')
                .whereRef('cs.id', '=', 'li.class_section_id')
                .where('sp.user_id', '=', userId),
            ),
          ]
        : []),
      ...(p.has('learning.read.own')
        ? [eb.and([eb('li.published_at', 'is not', null), eb('li.class_section_id', 'in', familySections(eb, userId, studentId))])]
        : []),
    ]);
}

async function canManage(db: Trx, auth: AuthContext, classSectionId: number, subjectId: number): Promise<boolean> {
  if (auth.permissions.has('learning.manage.all')) return true;
  if (!auth.permissions.has('learning.manage.scoped')) return false;
  const staffId = await staffIdOf(db, auth.user.id);
  if (!staffId) return false;
  const row = await db
    .selectFrom('teacher_assignments')
    .select('id')
    .where('staff_id', '=', staffId)
    .where('class_section_id', '=', classSectionId)
    .where('subject_id', '=', subjectId)
    .executeTakeFirst();
  return Boolean(row);
}

async function loadReadableItem(db: Trx, auth: AuthContext, id: number) {
  let q = db.selectFrom('learning_items as li').selectAll('li').where('li.id', '=', id);
  const scope = readScope(auth);
  if (scope) q = q.where(scope);
  const item = await q.executeTakeFirst();
  if (!item) throw notFound();
  return item;
}

/** Files must be the caller's own uploads and not attached anywhere else yet. */
async function assertAttachable(trx: Trx, userId: number, fileIds: number[], keepForItem?: number): Promise<void> {
  if (fileIds.length === 0) return;
  const files = await trx.selectFrom('stored_files').select(['id', 'uploaded_by']).where('id', 'in', fileIds).execute();
  if (files.length !== new Set(fileIds).size || files.some((f) => f.uploaded_by !== userId)) throw invalid('fileIds', 'File not found');
  let used = trx.selectFrom('learning_item_files').select('file_id').where('file_id', 'in', fileIds);
  if (keepForItem) used = used.where('item_id', '!=', keepForItem);
  const usedSub = trx.selectFrom('submission_files').select('file_id').where('file_id', 'in', fileIds);
  if ((await used.executeTakeFirst()) || (await usedSub.executeTakeFirst())) throw invalid('fileIds', 'File is already attached elsewhere');
}

export const learningRoutes: FastifyPluginAsync<{ db: Db; config: AppConfig }> = async (app, { db, config }) => {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MAX_FILE_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  // Files ------------------------------------------------------------------------
  app.post('/files', { preHandler: canUseLearning, bodyLimit: MAX_FILE_BYTES }, async (req, reply) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(191) }).parse(req.query);
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length === 0) throw invalid('file', 'Send the file as application/octet-stream');
    const fileName = safeFileName(name);
    const mime = sniffMime(buf, fileName);
    if (!mime) throw new AppError('VALIDATION_FAILED', 'errors.fileType', [{ path: 'file', message: 'errors.fileType' }]);
    const { key, sha256 } = await writeStoredFile(config.STORAGE_DIR, buf);
    const res = await db
      .insertInto('stored_files')
      .values({
        storage_key: key,
        sha256,
        original_name: fileName,
        mime_type: mime,
        size_bytes: buf.length,
        uploaded_by: req.auth!.user.id,
      })
      .executeTakeFirstOrThrow();
    return reply.status(201).send({ id: Number(res.insertId), name: fileName, mimeType: mime, size: buf.length });
  });

  app.get('/files/:id', { preHandler: canUseLearning }, async (req, reply) => {
    const id = routeId(req);
    const auth = req.auth!;
    const file = await db.selectFrom('stored_files').selectAll().where('id', '=', id).executeTakeFirst();
    if (!file) throw notFound();
    const items = await db.selectFrom('learning_item_files').select('item_id').where('file_id', '=', id).execute();
    const subs = await db
      .selectFrom('submission_files as sf')
      .innerJoin('submissions as s', 's.id', 'sf.submission_id')
      .select(['s.id', 's.item_id', 's.student_id'])
      .where('sf.file_id', '=', id)
      .execute();
    let allowed = false;
    if (items.length === 0 && subs.length === 0) allowed = file.uploaded_by === auth.user.id;
    for (const it of items) {
      if (allowed) break;
      allowed = await loadReadableItem(db, auth, it.item_id).then(
        () => true,
        () => false,
      );
    }
    for (const s of subs) {
      if (allowed) break;
      allowed = await canSeeSubmission(db, auth, s.item_id, s.student_id);
    }
    if (!allowed) throw notFound();
    if (subs.length > 0)
      await recordAudit(db, req, {
        action: 'learning.submission_file_downloaded',
        entityType: 'student',
        entityId: subs[0]!.student_id,
        metadata: { fileId: id },
      });
    reply
      .header('content-type', file.mime_type)
      .header('content-length', String(file.size_bytes))
      .header('content-disposition', contentDisposition(file.original_name))
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'private, no-store');
    return reply.send(openStoredFile(config.STORAGE_DIR, file.storage_key));
  });

  // Items ------------------------------------------------------------------------
  const itemQuery = () =>
    db
      .selectFrom('learning_items as li')
      .innerJoin('class_sections as c', 'c.id', 'li.class_section_id')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .innerJoin('subjects as sub', 'sub.id', 'li.subject_id')
      .leftJoin('users as u', 'u.id', 'li.created_by')
      .select([
        'li.id',
        'li.kind',
        'li.title',
        'li.instructions',
        'li.due_at',
        'li.allow_late',
        'li.max_score',
        'li.published_at',
        'li.created_at',
        'c.id as class_id',
        'c.name as class_name',
        'g.name as grade_name',
        'sub.id as subject_id',
        'sub.name as subject_name',
        'u.display_name as author',
      ]);
  type ItemRow = Awaited<ReturnType<ReturnType<typeof itemQuery>['execute']>>[number];
  const toItem = (r: ItemRow) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    instructions: r.instructions,
    dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
    allowLate: Boolean(r.allow_late),
    maxScore: r.max_score === null ? null : Number(r.max_score),
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    classSection: { id: r.class_id, name: r.class_name, gradeName: r.grade_name },
    subject: { id: r.subject_id, name: r.subject_name },
    author: r.author,
  });
  const filesOf = async (itemId: number) =>
    (
      await db
        .selectFrom('learning_item_files as lf')
        .innerJoin('stored_files as f', 'f.id', 'lf.file_id')
        .select(['f.id', 'f.original_name', 'f.mime_type', 'f.size_bytes'])
        .where('lf.item_id', '=', itemId)
        .orderBy('f.id')
        .execute()
    ).map((f) => ({ id: f.id, name: f.original_name, mimeType: f.mime_type, size: f.size_bytes }));

  /** Items I can see. Students/guardians also get their own submission state per assignment. */
  app.get('/learning-items', { preHandler: canUseLearning }, async (req) => {
    const q = learningListQuerySchema.parse(req.query);
    const auth = req.auth!;
    let query = itemQuery();
    const scope = readScope(auth, q.studentId);
    if (scope) query = query.where(scope);
    if (q.classSectionId) query = query.where('li.class_section_id', '=', q.classSectionId);
    if (q.subjectId) query = query.where('li.subject_id', '=', q.subjectId);
    if (q.kind) query = query.where('li.kind', '=', q.kind);
    const { limit, offset } = pageWindow(q);
    const [rows, total] = await Promise.all([
      query.orderBy('li.created_at', 'desc').orderBy('li.id', 'desc').limit(limit).offset(offset).execute(),
      query.clearSelect().select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    // My (or my child's) submissions for these assignments.
    const ownStudent = await db.selectFrom('student_profiles').select('id').where('user_id', '=', auth.user.id).executeTakeFirst();
    const forStudent = ownStudent?.id ?? q.studentId;
    let mine = new Map<number, { status: string; isLate: boolean; submittedAt: string; score: number | null }>();
    if (forStudent && rows.length && (ownStudent || (await guardianOf(db, auth.user.id, forStudent)))) {
      const subs = await db
        .selectFrom('submissions')
        .select(['item_id', 'status', 'is_late', 'submitted_at', 'score'])
        .where('student_id', '=', forStudent)
        .where(
          'item_id',
          'in',
          rows.map((r) => r.id),
        )
        .execute();
      mine = new Map(
        subs.map((s) => [
          s.item_id,
          {
            status: s.status,
            isLate: Boolean(s.is_late),
            submittedAt: new Date(s.submitted_at).toISOString(),
            score: s.score === null ? null : Number(s.score),
          },
        ]),
      );
    }
    return toPaginated(
      rows.map((r) => ({ ...toItem(r), mySubmission: mine.get(r.id) ?? null })),
      total.n,
      q,
    );
  });

  app.get('/learning-items/:id', { preHandler: canUseLearning }, async (req) => {
    const id = routeId(req);
    const auth = req.auth!;
    const item = await loadReadableItem(db, auth, id);
    const row = await itemQuery().where('li.id', '=', id).executeTakeFirstOrThrow();
    const manage = await canManage(db, auth, item.class_section_id, item.subject_id);
    const ownStudent = await db.selectFrom('student_profiles').select('id').where('user_id', '=', auth.user.id).executeTakeFirst();
    let mySubmission = null;
    if (ownStudent && item.kind === 'assignment') {
      const s = await db
        .selectFrom('submissions')
        .selectAll()
        .where('item_id', '=', id)
        .where('student_id', '=', ownStudent.id)
        .executeTakeFirst();
      if (s) mySubmission = await toSubmission(db, s);
    }
    return { ...toItem(row), files: await filesOf(id), canManage: manage, mySubmission };
  });

  app.post('/learning-items', { preHandler: canManagePerm }, async (req, reply) => {
    const input = createLearningItemSchema.parse(req.body);
    const auth = req.auth!;
    const id = await db.transaction().execute(async (trx) => {
      const section = await trx.selectFrom('class_sections').select('grade_id').where('id', '=', input.classSectionId).executeTakeFirst();
      if (!section) throw invalid('classSectionId', 'Class not found');
      const taken = await trx
        .selectFrom('grade_subjects')
        .select('subject_id')
        .where('grade_id', '=', section.grade_id)
        .where('subject_id', '=', input.subjectId)
        .executeTakeFirst();
      if (!taken) throw invalid('subjectId', 'This grade does not take that subject');
      if (!(await canManage(trx, auth, input.classSectionId, input.subjectId))) throw forbidden();
      await assertAttachable(trx, auth.user.id, input.fileIds);
      const res = await trx
        .insertInto('learning_items')
        .values({
          kind: input.kind,
          class_section_id: input.classSectionId,
          subject_id: input.subjectId,
          title: input.title,
          instructions: input.instructions,
          due_at: input.dueAt ? new Date(input.dueAt) : null,
          allow_late: input.allowLate ? 1 : 0,
          max_score: input.maxScore === null ? null : input.maxScore.toFixed(2),
          published_at: input.publish ? sql<Date>`CURRENT_TIMESTAMP` : null,
          created_by: auth.user.id,
        })
        .executeTakeFirstOrThrow();
      const newId = Number(res.insertId);
      for (const f of input.fileIds) await trx.insertInto('learning_item_files').values({ item_id: newId, file_id: f }).execute();
      await recordAudit(trx, req, {
        action: input.publish ? 'learning.item_published' : 'learning.item_created',
        entityType: 'learning_item',
        entityId: newId,
        metadata: { kind: input.kind, classSectionId: input.classSectionId, subjectId: input.subjectId },
      });
      return newId;
    });
    return reply.status(201).send({ id });
  });

  app.put('/learning-items/:id', { preHandler: canManagePerm }, async (req) => {
    const id = routeId(req);
    const input = updateLearningItemSchema.parse(req.body);
    const auth = req.auth!;
    await db.transaction().execute(async (trx) => {
      const item = await trx.selectFrom('learning_items').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!item || !(await canManage(trx, auth, item.class_section_id, item.subject_id))) throw notFound();
      if (item.kind === 'resource' && (input.dueAt || input.maxScore !== null))
        throw invalid('dueAt', 'Only assignments have a due date or score');
      const keep = new Set(input.fileIds);
      const current = await trx.selectFrom('learning_item_files').select('file_id').where('item_id', '=', id).execute();
      // Files already on the item may stay even if someone else uploaded them; new ones must be mine.
      const newOnes = input.fileIds.filter((f) => !current.some((c) => c.file_id === f));
      await assertAttachable(trx, auth.user.id, newOnes, id);
      await trx
        .deleteFrom('learning_item_files')
        .where('item_id', '=', id)
        .where((eb) => (keep.size ? eb('file_id', 'not in', [...keep]) : eb.lit(true)))
        .execute();
      for (const f of newOnes) await trx.insertInto('learning_item_files').values({ item_id: id, file_id: f }).execute();
      await trx
        .updateTable('learning_items')
        .set({
          title: input.title,
          instructions: input.instructions,
          due_at: input.dueAt ? new Date(input.dueAt) : null,
          allow_late: input.allowLate ? 1 : 0,
          max_score: input.maxScore === null ? null : input.maxScore.toFixed(2),
        })
        .where('id', '=', id)
        .execute();
      await recordAudit(trx, req, { action: 'learning.item_updated', entityType: 'learning_item', entityId: id });
    });
    return { ok: true };
  });

  app.post('/learning-items/:id/publish', { preHandler: canManagePerm }, async (req) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const item = await trx.selectFrom('learning_items').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!item || !(await canManage(trx, req.auth!, item.class_section_id, item.subject_id))) throw notFound();
      if (item.published_at) throw new AppError('CONFLICT', 'errors.alreadyPublished');
      await trx
        .updateTable('learning_items')
        .set({ published_at: sql<Date>`CURRENT_TIMESTAMP` })
        .where('id', '=', id)
        .execute();
      await recordAudit(trx, req, {
        action: 'learning.item_published',
        entityType: 'learning_item',
        entityId: id,
        metadata: { kind: item.kind },
      });
    });
    return { ok: true };
  });

  app.delete('/learning-items/:id', { preHandler: canManagePerm }, async (req, reply) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const item = await trx.selectFrom('learning_items').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!item || !(await canManage(trx, req.auth!, item.class_section_id, item.subject_id))) throw notFound();
      const sub = await trx.selectFrom('submissions').select('id').where('item_id', '=', id).executeTakeFirst();
      if (sub) throw new AppError('CONFLICT', 'errors.hasSubmissions');
      await trx.deleteFrom('learning_items').where('id', '=', id).execute(); // file links cascade; files are cleaned up by housekeeping
      await recordAudit(trx, req, { action: 'learning.item_deleted', entityType: 'learning_item', entityId: id });
    });
    return reply.status(204).send();
  });

  // Submissions -----------------------------------------------------------------------
  app.post('/learning-items/:id/submission', { preHandler: requirePermission('learning.read.own') }, async (req, reply) => {
    const id = routeId(req);
    const input = submitWorkSchema.parse(req.body);
    const auth = req.auth!;
    const result = await db.transaction().execute(async (trx) => {
      const student = await trx
        .selectFrom('student_profiles')
        .select(['id', 'status'])
        .where('user_id', '=', auth.user.id)
        .executeTakeFirst();
      if (!student || student.status !== 'active') throw forbidden();
      const item = await trx.selectFrom('learning_items').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      const enrolled = item
        ? await trx
            .selectFrom('enrollments')
            .select('id')
            .where('student_id', '=', student.id)
            .where('class_section_id', '=', item.class_section_id)
            .where('ends_on', 'is', null)
            .executeTakeFirst()
        : undefined;
      if (!item || !item.published_at || !enrolled) throw notFound();
      if (item.kind !== 'assignment') throw invalid('id', 'Only assignments take submissions');
      const now = new Date();
      const late = item.due_at !== null && now > new Date(item.due_at);
      if (late && !item.allow_late) throw new AppError('CONFLICT', 'errors.pastDue');
      const existing = await trx
        .selectFrom('submissions')
        .select(['id', 'status'])
        .where('item_id', '=', id)
        .where('student_id', '=', student.id)
        .executeTakeFirst();
      if (existing?.status === 'returned') throw new AppError('CONFLICT', 'errors.submissionReturned');
      await assertAttachable(trx, auth.user.id, input.fileIds);
      let submissionId: number;
      if (existing) {
        submissionId = existing.id;
        // Replaced files become unattached; housekeeping removes them.
        await trx.deleteFrom('submission_files').where('submission_id', '=', submissionId).execute();
        await trx
          .updateTable('submissions')
          .set({ text_answer: input.textAnswer, submitted_at: sql<Date>`CURRENT_TIMESTAMP`, is_late: late ? 1 : 0 })
          .where('id', '=', submissionId)
          .execute();
      } else {
        const res = await trx
          .insertInto('submissions')
          .values({ item_id: id, student_id: student.id, text_answer: input.textAnswer, is_late: late ? 1 : 0 })
          .executeTakeFirstOrThrow();
        submissionId = Number(res.insertId);
      }
      for (const f of input.fileIds) await trx.insertInto('submission_files').values({ submission_id: submissionId, file_id: f }).execute();
      await recordAudit(trx, req, {
        action: 'learning.work_submitted',
        entityType: 'learning_item',
        entityId: id,
        metadata: { submissionId, late, resubmitted: Boolean(existing) },
      });
      return { submissionId, late };
    });
    return reply.status(201).send({ id: result.submissionId, isLate: result.late });
  });

  /** Teacher view: every student in the class with their submission (or none). */
  app.get('/learning-items/:id/submissions', { preHandler: canManagePerm }, async (req) => {
    const id = routeId(req);
    const item = await db.selectFrom('learning_items').selectAll().where('id', '=', id).executeTakeFirst();
    if (!item || !(await canManage(db, req.auth!, item.class_section_id, item.subject_id))) throw notFound();
    const roster = await db
      .selectFrom('enrollments as e')
      .innerJoin('student_profiles as s', 's.id', 'e.student_id')
      .select(['s.id', 's.full_name', 's.admission_no', 'e.roll_no'])
      .where('e.class_section_id', '=', item.class_section_id)
      .where('e.ends_on', 'is', null)
      .orderBy('e.roll_no')
      .orderBy('s.full_name')
      .execute();
    const subs = await db.selectFrom('submissions').selectAll().where('item_id', '=', id).execute();
    const byStudent = new Map(subs.map((s) => [s.student_id, s]));
    const extra = subs.filter((s) => !roster.some((r) => r.id === s.student_id)); // students who have since left the class
    const students = [
      ...roster.map((r) => ({ id: r.id, fullName: r.full_name, admissionNo: r.admission_no })),
      ...(await Promise.all(
        extra.map(async (s) => {
          const st = await db
            .selectFrom('student_profiles')
            .select(['full_name', 'admission_no'])
            .where('id', '=', s.student_id)
            .executeTakeFirstOrThrow();
          return { id: s.student_id, fullName: st.full_name, admissionNo: st.admission_no };
        }),
      )),
    ];
    return {
      items: await Promise.all(
        students.map(async (st) => {
          const s = byStudent.get(st.id);
          return { student: st, submission: s ? await toSubmission(db, s) : null };
        }),
      ),
    };
  });

  app.post('/submissions/:id/return', { preHandler: canManagePerm }, async (req) => {
    const id = routeId(req);
    const input = returnSubmissionSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const s = await trx
        .selectFrom('submissions as s')
        .innerJoin('learning_items as li', 'li.id', 's.item_id')
        .select(['s.id', 's.student_id', 'li.class_section_id', 'li.subject_id', 'li.max_score', 'li.id as item_id'])
        .where('s.id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!s || !(await canManage(trx, req.auth!, s.class_section_id, s.subject_id))) throw notFound();
      if (input.score !== null && (s.max_score === null || input.score > Number(s.max_score)))
        throw invalid('score', 'Score is above the maximum');
      await trx
        .updateTable('submissions')
        .set({
          status: 'returned',
          feedback: input.feedback,
          score: input.score === null ? null : input.score.toFixed(2),
          returned_by: req.auth!.user.id,
          returned_at: sql<Date>`CURRENT_TIMESTAMP`,
        })
        .where('id', '=', id)
        .execute();
      await recordAudit(trx, req, {
        action: 'learning.work_returned',
        entityType: 'student',
        entityId: s.student_id,
        metadata: { submissionId: id, itemId: s.item_id, scored: input.score !== null },
      });
    });
    return { ok: true };
  });
};

async function guardianOf(db: Trx, userId: number, studentId: number): Promise<boolean> {
  const row = await db
    .selectFrom('student_guardians as sg')
    .innerJoin('guardian_profiles as gp', 'gp.id', 'sg.guardian_id')
    .select('sg.student_id')
    .where('sg.student_id', '=', studentId)
    .where('sg.verification_status', '=', 'verified')
    .where('gp.user_id', '=', userId)
    .executeTakeFirst();
  return Boolean(row);
}

/** Submission visible to: the student, their verified guardians, and staff who manage or read the item. */
async function canSeeSubmission(db: Trx, auth: AuthContext, itemId: number, studentId: number): Promise<boolean> {
  const own = await db
    .selectFrom('student_profiles')
    .select('id')
    .where('id', '=', studentId)
    .where('user_id', '=', auth.user.id)
    .executeTakeFirst();
  if (own) return true;
  if (await guardianOf(db, auth.user.id, studentId)) return true;
  const item = await db.selectFrom('learning_items').select(['class_section_id', 'subject_id']).where('id', '=', itemId).executeTakeFirst();
  if (!item) return false;
  if (auth.permissions.has('learning.read.all')) return true;
  return canManage(db, auth, item.class_section_id, item.subject_id);
}

async function toSubmission(db: Trx, s: Selectable<Database['submissions']>) {
  const files = await db
    .selectFrom('submission_files as sf')
    .innerJoin('stored_files as f', 'f.id', 'sf.file_id')
    .select(['f.id', 'f.original_name', 'f.mime_type', 'f.size_bytes'])
    .where('sf.submission_id', '=', s.id)
    .execute();
  return {
    id: s.id,
    textAnswer: s.text_answer,
    submittedAt: new Date(s.submitted_at).toISOString(),
    isLate: Boolean(s.is_late),
    status: s.status,
    feedback: s.feedback,
    score: s.score === null ? null : Number(s.score),
    returnedAt: s.returned_at ? new Date(s.returned_at).toISOString() : null,
    files: files.map((f) => ({ id: f.id, name: f.original_name, mimeType: f.mime_type, size: f.size_bytes })),
  };
}
