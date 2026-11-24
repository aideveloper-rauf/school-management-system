import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { assertCurriculumOnly, cleanDrafts, PersonalDataError, type AiProvider } from '../../lib/ai.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, invalid, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';
import { staffIdOf } from '../people/scope.js';

/**
 * AI question drafting (roadmap Phase 5). See lib/ai.ts for the rules. Audit records that drafts were requested
 * (subject id and counts only — never the prompt or output text).
 */
const draftSchema = z.object({
  subjectId: z.number().int().positive(),
  gradeId: z.number().int().positive().nullable().default(null),
  outcome: z.string().trim().min(3).max(500),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  language: z.enum(['en', 'si', 'ta']).default('en'),
  count: z.number().int().min(1).max(10).default(5),
});

export const aiRoutes: FastifyPluginAsync<{ db: Db; ai: AiProvider | null }> = async (app, { db, ai }) => {
  /** Whether AI drafting can be used here (installation switch + provider + school opt-in). */
  app.get('/ai/status', { preHandler: requirePermission('ai.use', 'school.settings.manage') }, async () => {
    const school = await db.selectFrom('schools').select('ai_enabled').executeTakeFirst();
    const schoolEnabled = Boolean(school?.ai_enabled);
    return { available: ai !== null, provider: ai?.name ?? null, schoolEnabled, usable: ai !== null && schoolEnabled };
  });

  app.post('/ai/question-drafts', { preHandler: requirePermission('ai.use') }, async (req) => {
    const input = draftSchema.parse(req.body);
    const school = await db.selectFrom('schools').select('ai_enabled').executeTakeFirst();
    if (!ai || !school?.ai_enabled) throw new AppError('CONFLICT', 'errors.aiOff');
    const auth = req.auth!;
    if (!auth.permissions.has('questions.review')) {
      const staffId = await staffIdOf(db, auth.user.id);
      const teaches = staffId
        ? await db
            .selectFrom('teacher_assignments')
            .select('id')
            .where('staff_id', '=', staffId)
            .where('subject_id', '=', input.subjectId)
            .executeTakeFirst()
        : undefined;
      if (!teaches) throw notFound();
    }
    const subject = await db.selectFrom('subjects').select('name').where('id', '=', input.subjectId).executeTakeFirst();
    if (!subject) throw notFound();
    const grade = input.gradeId ? await db.selectFrom('grades').select('name').where('id', '=', input.gradeId).executeTakeFirst() : null;
    const names = (await db.selectFrom('student_profiles').select('full_name').where('status', '=', 'active').execute()).map(
      (r) => r.full_name,
    );
    try {
      assertCurriculumOnly(input.outcome, names);
    } catch (e) {
      if (e instanceof PersonalDataError) throw invalid('outcome', 'errors.aiPersonalData');
      throw e;
    }
    let drafts;
    try {
      drafts = cleanDrafts(
        await ai.draftQuestions({
          subject: subject.name,
          grade: grade?.name ?? null,
          outcome: input.outcome,
          difficulty: input.difficulty,
          language: input.language,
          count: input.count,
        }),
        input.count,
      );
    } catch {
      throw new AppError('SERVICE_UNAVAILABLE', 'errors.aiUnavailable');
    }
    await recordAudit(db, req, {
      action: 'ai.question_drafts',
      entityType: 'subject',
      entityId: input.subjectId,
      metadata: { requested: input.count, returned: drafts.length, provider: ai.name },
    });
    return { drafts };
  });
};
