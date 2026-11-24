import type { FastifyPluginAsync } from 'fastify';
import { sql, type Kysely } from 'kysely';
import {
  createPaperSchema,
  createQuestionSchema,
  pageWindow,
  questionContentSchema,
  questionListQuerySchema,
  reviewQuestionSchema,
  savePaperVersionSchema,
  toPaginated,
} from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import type { AuthContext } from '../../plugins/auth.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, forbidden, invalid, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';
import { likePattern, routeId } from '../people/common.js';
import { staffIdOf } from '../people/scope.js';

/**
 * Question bank and exam papers (roadmap L-4, L-5).
 *
 * - Authors (`questions.author`, teachers) work in subjects they teach; reviewers (`questions.review`,
 *   academic coordinator) work in every subject and approve or reject specific versions.
 * - Editing a question creates a new version (draft). Only approved versions can go into a paper.
 * - A paper version stores the exact question versions; `final` versions are frozen and a later change starts
 *   a new draft version. Answer keys (MCQ correctness, model answers) are only returned to authors/reviewers in
 *   scope — students never reach these routes.
 */
type Trx = Kysely<Database>;
const canUse = requirePermission('questions.author', 'questions.review');

async function subjectAllowed(db: Trx, auth: AuthContext, subjectId: number): Promise<boolean> {
  if (auth.permissions.has('questions.review')) return true;
  const staffId = await staffIdOf(db, auth.user.id);
  if (!staffId) return false;
  return Boolean(
    await db
      .selectFrom('teacher_assignments')
      .select('id')
      .where('staff_id', '=', staffId)
      .where('subject_id', '=', subjectId)
      .executeTakeFirst(),
  );
}
async function allowedSubjects(db: Trx, auth: AuthContext): Promise<number[] | null> {
  if (auth.permissions.has('questions.review')) return null;
  const staffId = await staffIdOf(db, auth.user.id);
  if (!staffId) return [];
  return (await db.selectFrom('teacher_assignments').select('subject_id').distinct().where('staff_id', '=', staffId).execute()).map(
    (r) => r.subject_id,
  );
}

type VersionRow = Awaited<ReturnType<typeof loadVersions>>[number];
const toVersion = (v: VersionRow) => ({
  id: v.id,
  version: v.version,
  kind: v.kind,
  stem: v.stem,
  options: v.options ? (JSON.parse(v.options) as Array<{ text: string; correct: boolean }>) : null,
  answer: v.answer,
  marks: Number(v.marks),
  licence: v.licence,
  source: v.source,
  reviewStatus: v.review_status,
  reviewedBy: v.reviewer,
  reviewedAt: v.reviewed_at ? new Date(v.reviewed_at).toISOString() : null,
  createdAt: new Date(v.created_at).toISOString(),
});
function loadVersions(db: Trx, questionIds: number[]) {
  return db
    .selectFrom('question_versions as v')
    .leftJoin('users as u', 'u.id', 'v.reviewed_by')
    .selectAll('v')
    .select('u.display_name as reviewer')
    .where('v.question_id', 'in', questionIds.length ? questionIds : [0])
    .orderBy('v.question_id')
    .orderBy('v.version', 'desc')
    .execute();
}

/** Strip the answer key from a version (for paper previews without answers). */
const withoutAnswers = <T extends { options: Array<{ text: string; correct: boolean }> | null; answer: string | null }>(v: T) => ({
  ...v,
  options: v.options?.map((o) => ({ text: o.text })) ?? null,
  answer: null,
});

export const questionRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  // Questions ------------------------------------------------------------------
  app.get('/questions', { preHandler: canUse }, async (req) => {
    const q = questionListQuerySchema.parse(req.query);
    const subjects = await allowedSubjects(db, req.auth!);
    let base = db
      .selectFrom('questions as qn')
      .innerJoin('subjects as s', 's.id', 'qn.subject_id')
      .leftJoin('grades as g', 'g.id', 'qn.grade_id')
      .innerJoin('question_versions as v', (j) =>
        j.onRef('v.question_id', '=', 'qn.id').on('v.version', '=', (eb) =>
          eb
            .selectFrom('question_versions as v2')
            .select((e2) => e2.fn.max('v2.version').as('m'))
            .whereRef('v2.question_id', '=', 'qn.id'),
        ),
      )
      .where('qn.is_retired', '=', 0);
    if (subjects) base = base.where('qn.subject_id', 'in', subjects.length ? subjects : [0]);
    if (q.subjectId) base = base.where('qn.subject_id', '=', q.subjectId);
    if (q.gradeId) base = base.where('qn.grade_id', '=', q.gradeId);
    if (q.difficulty) base = base.where('qn.difficulty', '=', q.difficulty);
    if (q.review) base = base.where('v.review_status', '=', q.review);
    if (q.q) base = base.where((eb) => eb.or([eb('v.stem', 'like', likePattern(q.q!)), eb('qn.outcome', 'like', likePattern(q.q!))]));
    const { limit, offset } = pageWindow(q);
    const [rows, total] = await Promise.all([
      base
        .select([
          'qn.id',
          'qn.language',
          'qn.outcome',
          'qn.difficulty',
          's.id as subject_id',
          's.name as subject_name',
          'g.id as grade_id',
          'g.name as grade_name',
          'v.id as version_id',
          'v.version',
          'v.kind',
          'v.stem',
          'v.marks',
          'v.review_status',
        ])
        .orderBy('qn.id', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
      base.select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    // Latest approved version per question (what can go into a paper).
    const approved = rows.length
      ? await db
          .selectFrom('question_versions')
          .select(['question_id', db.fn.max('id').as('id')])
          .where('review_status', '=', 'approved')
          .where(
            'question_id',
            'in',
            rows.map((r) => r.id),
          )
          .groupBy('question_id')
          .execute()
      : [];
    const approvedBy = new Map(approved.map((a) => [a.question_id, Number(a.id)]));
    return toPaginated(
      rows.map((r) => ({
        id: r.id,
        subject: { id: r.subject_id, name: r.subject_name },
        grade: r.grade_id === null ? null : { id: r.grade_id, name: r.grade_name },
        language: r.language,
        outcome: r.outcome,
        difficulty: r.difficulty,
        latest: { id: r.version_id, version: r.version, kind: r.kind, stem: r.stem, marks: Number(r.marks), reviewStatus: r.review_status },
        approvedVersionId: approvedBy.get(r.id) ?? null,
      })),
      total.n,
      q,
    );
  });

  app.get('/questions/:id', { preHandler: canUse }, async (req) => {
    const id = routeId(req);
    const qn = await db.selectFrom('questions').selectAll().where('id', '=', id).executeTakeFirst();
    if (!qn || !(await subjectAllowed(db, req.auth!, qn.subject_id))) throw notFound();
    const versions = await loadVersions(db, [id]);
    const used = await db
      .selectFrom('exam_paper_items as pi')
      .innerJoin('exam_paper_versions as pv', 'pv.id', 'pi.paper_version_id')
      .innerJoin('exam_papers as p', 'p.id', 'pv.paper_id')
      .select(['p.id', 'p.title', 'pv.version', 'pi.question_version_id'])
      .where(
        'pi.question_version_id',
        'in',
        versions.map((v) => v.id),
      )
      .execute();
    return {
      id: qn.id,
      subjectId: qn.subject_id,
      gradeId: qn.grade_id,
      language: qn.language,
      outcome: qn.outcome,
      difficulty: qn.difficulty,
      isRetired: Boolean(qn.is_retired),
      versions: versions.map(toVersion),
      usedIn: used.map((u) => ({ paperId: u.id, title: u.title, version: u.version, questionVersionId: u.question_version_id })),
    };
  });

  app.post('/questions', { preHandler: canUse }, async (req, reply) => {
    const input = createQuestionSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      if (!(await subjectAllowed(trx, req.auth!, input.subjectId))) throw forbidden();
      const res = await trx
        .insertInto('questions')
        .values({
          subject_id: input.subjectId,
          grade_id: input.gradeId,
          language: input.language,
          outcome: input.outcome,
          difficulty: input.difficulty,
          created_by: req.auth!.user.id,
        })
        .executeTakeFirstOrThrow(); // unknown subject/grade → 422 via FK mapping
      const qid = Number(res.insertId);
      await insertVersion(trx, qid, 1, input.content, req.auth!.user.id);
      await recordAudit(trx, req, { action: 'question.created', entityType: 'question', entityId: qid });
      return qid;
    });
    return reply.status(201).send({ id });
  });

  /** Edit = new draft version. Earlier versions (and papers using them) are untouched. */
  app.post('/questions/:id/versions', { preHandler: canUse }, async (req, reply) => {
    const id = routeId(req);
    const content = questionContentSchema.parse(req.body);
    const version = await db.transaction().execute(async (trx) => {
      const qn = await trx.selectFrom('questions').select(['subject_id', 'is_retired']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!qn || !(await subjectAllowed(trx, req.auth!, qn.subject_id))) throw notFound();
      if (qn.is_retired) throw new AppError('CONFLICT', 'errors.questionRetired');
      const last = await trx
        .selectFrom('question_versions')
        .select(trx.fn.max('version').as('v'))
        .where('question_id', '=', id)
        .executeTakeFirstOrThrow();
      const next = Number(last.v ?? 0) + 1;
      const vid = await insertVersion(trx, id, next, content, req.auth!.user.id);
      await recordAudit(trx, req, { action: 'question.revised', entityType: 'question', entityId: id, metadata: { version: next } });
      return { id: vid, version: next };
    });
    return reply.status(201).send(version);
  });

  app.post('/questions/:id/submit-review', { preHandler: canUse }, async (req) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const qn = await trx.selectFrom('questions').select('subject_id').where('id', '=', id).executeTakeFirst();
      if (!qn || !(await subjectAllowed(trx, req.auth!, qn.subject_id))) throw notFound();
      const latest = await trx
        .selectFrom('question_versions')
        .select(['id', 'review_status'])
        .where('question_id', '=', id)
        .orderBy('version', 'desc')
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (latest.review_status !== 'draft' && latest.review_status !== 'rejected') throw new AppError('CONFLICT', 'errors.reviewState');
      await trx.updateTable('question_versions').set({ review_status: 'in_review' }).where('id', '=', latest.id).execute();
      await recordAudit(trx, req, {
        action: 'question.review_requested',
        entityType: 'question',
        entityId: id,
        metadata: { versionId: latest.id },
      });
    });
    return { ok: true };
  });

  app.post('/questions/:id/review', { preHandler: requirePermission('questions.review') }, async (req) => {
    const id = routeId(req);
    const input = reviewQuestionSchema.parse(req.body);
    await db.transaction().execute(async (trx) => {
      const v = await trx
        .selectFrom('question_versions')
        .select(['id', 'review_status', 'created_by'])
        .where('id', '=', input.versionId)
        .where('question_id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!v) throw notFound();
      if (v.review_status === 'approved' && input.decision === 'approved') throw new AppError('CONFLICT', 'errors.reviewState');
      await trx
        .updateTable('question_versions')
        .set({ review_status: input.decision, reviewed_by: req.auth!.user.id, reviewed_at: sql<Date>`CURRENT_TIMESTAMP` })
        .where('id', '=', v.id)
        .execute();
      await recordAudit(trx, req, {
        action: `question.${input.decision}`,
        entityType: 'question',
        entityId: id,
        metadata: { versionId: v.id },
      });
    });
    return { ok: true };
  });

  app.post('/questions/:id/retire', { preHandler: canUse }, async (req) => {
    const id = routeId(req);
    await db.transaction().execute(async (trx) => {
      const qn = await trx.selectFrom('questions').select('subject_id').where('id', '=', id).executeTakeFirst();
      if (!qn || !(await subjectAllowed(trx, req.auth!, qn.subject_id))) throw notFound();
      await trx.updateTable('questions').set({ is_retired: 1 }).where('id', '=', id).execute();
      await recordAudit(trx, req, { action: 'question.retired', entityType: 'question', entityId: id });
    });
    return { ok: true };
  });

  // Papers ---------------------------------------------------------------------
  app.get('/papers', { preHandler: canUse }, async (req) => {
    const subjects = await allowedSubjects(db, req.auth!);
    let q = db
      .selectFrom('exam_papers as p')
      .innerJoin('subjects as s', 's.id', 'p.subject_id')
      .innerJoin('grades as g', 'g.id', 'p.grade_id')
      .select([
        'p.id',
        'p.title',
        's.id as subject_id',
        's.name as subject_name',
        'g.id as grade_id',
        'g.name as grade_name',
        (eb) =>
          eb
            .selectFrom('exam_paper_versions as v')
            .select((e2) => e2.fn.max('v.version').as('m'))
            .whereRef('v.paper_id', '=', 'p.id')
            .as('latest_version'),
        (eb) =>
          eb
            .selectFrom('exam_paper_versions as v')
            .select('v.status')
            .whereRef('v.paper_id', '=', 'p.id')
            .orderBy('v.version', 'desc')
            .limit(1)
            .as('latest_status'),
      ]);
    if (subjects) q = q.where('p.subject_id', 'in', subjects.length ? subjects : [0]);
    const rows = await q.orderBy('p.id', 'desc').limit(200).execute();
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        subject: { id: r.subject_id, name: r.subject_name },
        grade: { id: r.grade_id, name: r.grade_name },
        latestVersion: Number(r.latest_version ?? 0),
        latestStatus: r.latest_status,
      })),
    };
  });

  app.post('/papers', { preHandler: canUse }, async (req, reply) => {
    const input = createPaperSchema.parse(req.body);
    const id = await db.transaction().execute(async (trx) => {
      if (!(await subjectAllowed(trx, req.auth!, input.subjectId))) throw forbidden();
      const res = await trx
        .insertInto('exam_papers')
        .values({ title: input.title, subject_id: input.subjectId, grade_id: input.gradeId, created_by: req.auth!.user.id })
        .executeTakeFirstOrThrow();
      const pid = Number(res.insertId);
      await trx.insertInto('exam_paper_versions').values({ paper_id: pid, version: 1, created_by: req.auth!.user.id }).execute();
      await recordAudit(trx, req, { action: 'paper.created', entityType: 'paper', entityId: pid });
      return pid;
    });
    return reply.status(201).send({ id });
  });

  app.get('/papers/:id', { preHandler: canUse }, async (req) => {
    const id = routeId(req);
    const p = await db.selectFrom('exam_papers').selectAll().where('id', '=', id).executeTakeFirst();
    if (!p || !(await subjectAllowed(db, req.auth!, p.subject_id))) throw notFound();
    const versions = await db
      .selectFrom('exam_paper_versions as v')
      .leftJoin('users as u', 'u.id', 'v.finalized_by')
      .select(['v.id', 'v.version', 'v.status', 'v.finalized_at', 'u.display_name as finalized_by'])
      .where('v.paper_id', '=', id)
      .orderBy('v.version', 'desc')
      .execute();
    return {
      id: p.id,
      title: p.title,
      subjectId: p.subject_id,
      gradeId: p.grade_id,
      versions: versions.map((v) => ({
        id: v.id,
        version: v.version,
        status: v.status,
        finalizedAt: v.finalized_at ? new Date(v.finalized_at).toISOString() : null,
        finalizedBy: v.finalized_by,
      })),
    };
  });

  /** A paper version with its exact questions. `?answers=false` hides the answer key (printing for candidates). */
  app.get('/paper-versions/:id', { preHandler: canUse }, async (req) => {
    const id = routeId(req);
    const showAnswers = (req.query as { answers?: string }).answers !== 'false';
    const v = await db
      .selectFrom('exam_paper_versions as v')
      .innerJoin('exam_papers as p', 'p.id', 'v.paper_id')
      .innerJoin('subjects as s', 's.id', 'p.subject_id')
      .innerJoin('grades as g', 'g.id', 'p.grade_id')
      .select([
        'v.id',
        'v.version',
        'v.status',
        'v.instructions',
        'v.duration_minutes',
        'v.finalized_at',
        'p.id as paper_id',
        'p.title',
        'p.subject_id',
        's.name as subject_name',
        'g.name as grade_name',
      ])
      .where('v.id', '=', id)
      .executeTakeFirst();
    if (!v || !(await subjectAllowed(db, req.auth!, v.subject_id))) throw notFound();
    const items = await db
      .selectFrom('exam_paper_items as pi')
      .innerJoin('question_versions as qv', 'qv.id', 'pi.question_version_id')
      .leftJoin('users as u', 'u.id', 'qv.reviewed_by')
      .selectAll('qv')
      .select(['pi.position', 'pi.marks as item_marks', 'u.display_name as reviewer'])
      .where('pi.paper_version_id', '=', id)
      .orderBy('pi.position')
      .execute();
    const questions = items.map((it) => {
      const q = { ...toVersion(it), questionId: it.question_id, position: it.position, itemMarks: Number(it.item_marks) };
      return showAnswers ? q : { ...withoutAnswers(q) };
    });
    return {
      id: v.id,
      paperId: v.paper_id,
      title: v.title,
      subject: v.subject_name,
      grade: v.grade_name,
      version: v.version,
      status: v.status,
      instructions: v.instructions,
      durationMinutes: v.duration_minutes,
      finalizedAt: v.finalized_at ? new Date(v.finalized_at).toISOString() : null,
      totalMarks: questions.reduce((sum, q) => sum + q.itemMarks, 0),
      questions,
    };
  });

  /** Save the working draft. If the latest version is final, a new draft version is started. */
  app.put('/papers/:id/draft', { preHandler: canUse }, async (req) => {
    const id = routeId(req);
    const input = savePaperVersionSchema.parse(req.body);
    return db.transaction().execute(async (trx) => {
      const p = await trx.selectFrom('exam_papers').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p || !(await subjectAllowed(trx, req.auth!, p.subject_id))) throw notFound();
      if (input.items.length) {
        const qvs = await trx
          .selectFrom('question_versions as qv')
          .innerJoin('questions as q', 'q.id', 'qv.question_id')
          .select(['qv.id', 'qv.review_status', 'qv.marks', 'q.subject_id'])
          .where(
            'qv.id',
            'in',
            input.items.map((i) => i.questionVersionId),
          )
          .execute();
        if (qvs.length !== input.items.length) throw invalid('items', 'Question not found');
        if (qvs.some((q) => q.subject_id !== p.subject_id)) throw invalid('items', 'A question is from another subject');
        if (qvs.some((q) => q.review_status !== 'approved')) throw invalid('items', 'errors.questionNotApproved');
        const marksOf = new Map(qvs.map((q) => [q.id, q.marks]));
        input.items = input.items.map((i) => ({ ...i, marks: i.marks ?? Number(marksOf.get(i.questionVersionId)) }));
      }
      let latest = await trx
        .selectFrom('exam_paper_versions')
        .selectAll()
        .where('paper_id', '=', id)
        .orderBy('version', 'desc')
        .executeTakeFirstOrThrow();
      if (latest.status === 'final') {
        const res = await trx
          .insertInto('exam_paper_versions')
          .values({ paper_id: id, version: latest.version + 1, created_by: req.auth!.user.id })
          .executeTakeFirstOrThrow();
        latest = await trx.selectFrom('exam_paper_versions').selectAll().where('id', '=', Number(res.insertId)).executeTakeFirstOrThrow();
      }
      await trx
        .updateTable('exam_paper_versions')
        .set({ instructions: input.instructions, duration_minutes: input.durationMinutes })
        .where('id', '=', latest.id)
        .execute();
      await trx.deleteFrom('exam_paper_items').where('paper_version_id', '=', latest.id).execute();
      for (const [i, it] of input.items.entries()) {
        await trx
          .insertInto('exam_paper_items')
          .values({ paper_version_id: latest.id, position: i + 1, question_version_id: it.questionVersionId, marks: it.marks!.toFixed(2) })
          .execute();
      }
      await recordAudit(trx, req, {
        action: 'paper.draft_saved',
        entityType: 'paper',
        entityId: id,
        metadata: { version: latest.version, questions: input.items.length },
      });
      return { versionId: latest.id, version: latest.version };
    });
  });

  app.post('/papers/:id/finalize', { preHandler: canUse }, async (req) => {
    const id = routeId(req);
    return db.transaction().execute(async (trx) => {
      const p = await trx.selectFrom('exam_papers').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p || !(await subjectAllowed(trx, req.auth!, p.subject_id))) throw notFound();
      const latest = await trx
        .selectFrom('exam_paper_versions')
        .selectAll()
        .where('paper_id', '=', id)
        .orderBy('version', 'desc')
        .executeTakeFirstOrThrow();
      if (latest.status === 'final') throw new AppError('CONFLICT', 'errors.alreadyFinal');
      const n = await trx
        .selectFrom('exam_paper_items')
        .select(trx.fn.countAll<number>().as('n'))
        .where('paper_version_id', '=', latest.id)
        .executeTakeFirstOrThrow();
      if (Number(n.n) === 0) throw invalid('items', 'Add questions before finalising');
      await trx
        .updateTable('exam_paper_versions')
        .set({ status: 'final', finalized_by: req.auth!.user.id, finalized_at: sql<Date>`CURRENT_TIMESTAMP` })
        .where('id', '=', latest.id)
        .execute();
      await recordAudit(trx, req, { action: 'paper.finalized', entityType: 'paper', entityId: id, metadata: { version: latest.version } });
      return { versionId: latest.id, version: latest.version };
    });
  });
};

async function insertVersion(
  trx: Trx,
  questionId: number,
  version: number,
  c: ReturnType<typeof questionContentSchema.parse>,
  userId: number,
): Promise<number> {
  const res = await trx
    .insertInto('question_versions')
    .values({
      question_id: questionId,
      version,
      kind: c.kind,
      stem: c.stem,
      options: c.options ? JSON.stringify(c.options) : null,
      answer: c.answer,
      marks: c.marks.toFixed(2),
      licence: c.licence,
      source: c.source,
      created_by: userId,
    })
    .executeTakeFirstOrThrow();
  return Number(res.insertId);
}
