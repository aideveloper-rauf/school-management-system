import type { FastifyPluginAsync } from 'fastify';
import { yearRolloverSchema } from '@sms/shared';
import type { Db } from '../../db/client.js';
import { recordAudit } from '../../lib/audit.js';
import { invalid, notFound } from '../../lib/errors.js';
import { canManage, routeId } from './common.js';

export type RolloverSkipReason = 'exists' | 'grade_inactive';

/**
 * Year rollover (roadmap A-5): copy class sections from one year into another.
 *
 * - Copies name, grade, medium and capacity. The home room is kept only while the room is active.
 * - Skips sections that already exist in the target (same grade + name), so running it twice is safe,
 *   and sections of retired grades.
 * - Subject mappings (`grade_subjects`) belong to the grade, not the year, so nothing to copy.
 * - Students are not promoted here; enrolment rollover comes with student records.
 * - `dryRun` returns the same plan without writing. One audit entry (counts only) for a real run.
 */
export const rolloverRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.post('/academic-years/:id/rollover', { preHandler: canManage }, async (req) => {
    const targetId = routeId(req);
    const input = yearRolloverSchema.parse(req.body);
    if (input.fromAcademicYearId === targetId) throw invalid('fromAcademicYearId', 'Choose a different year to copy from');

    return db.transaction().execute(async (trx) => {
      // Lock the target year so two concurrent rollovers cannot interleave their duplicate checks.
      const target = await trx.selectFrom('academic_years').select('id').where('id', '=', targetId).forUpdate().executeTakeFirst();
      if (!target) throw notFound();
      const source = await trx.selectFrom('academic_years').select('id').where('id', '=', input.fromAcademicYearId).executeTakeFirst();
      if (!source) throw invalid('fromAcademicYearId', 'Academic year not found');

      const sections = await trx
        .selectFrom('class_sections as c')
        .innerJoin('grades as g', 'g.id', 'c.grade_id')
        .leftJoin('rooms as r', 'r.id', 'c.home_room_id')
        .select([
          'c.grade_id',
          'g.name as grade_name',
          'g.level as grade_level',
          'g.is_active as grade_active',
          'c.name',
          'c.medium',
          'c.capacity',
          'c.home_room_id',
          'r.is_active as room_active',
        ])
        .where('c.academic_year_id', '=', input.fromAcademicYearId)
        .orderBy('g.level')
        .orderBy('c.name')
        .execute();
      const existing = await trx
        .selectFrom('class_sections')
        .select(['grade_id', 'name'])
        .where('academic_year_id', '=', targetId)
        .execute();
      // MySQL's default collation compares names case-insensitively; mirror that so the plan matches the unique key.
      const key = (gradeId: number, name: string) => `${gradeId}\u0000${name.toLowerCase()}`;
      const taken = new Set(existing.map((e) => key(e.grade_id, e.name)));

      const created: { grade: { id: number; name: string }; name: string; homeRoomDropped: boolean }[] = [];
      const skipped: { grade: { id: number; name: string }; name: string; reason: RolloverSkipReason }[] = [];
      for (const s of sections) {
        const grade = { id: s.grade_id, name: s.grade_name };
        if (!s.grade_active) {
          skipped.push({ grade, name: s.name, reason: 'grade_inactive' });
          continue;
        }
        if (taken.has(key(s.grade_id, s.name))) {
          skipped.push({ grade, name: s.name, reason: 'exists' });
          continue;
        }
        taken.add(key(s.grade_id, s.name));
        const keepRoom = s.home_room_id !== null && Boolean(s.room_active);
        if (!input.dryRun) {
          await trx
            .insertInto('class_sections')
            .values({
              academic_year_id: targetId,
              grade_id: s.grade_id,
              name: s.name,
              medium: s.medium,
              capacity: s.capacity,
              home_room_id: keepRoom ? s.home_room_id : null,
            })
            .execute();
        }
        created.push({ grade, name: s.name, homeRoomDropped: s.home_room_id !== null && !keepRoom });
      }

      if (!input.dryRun && created.length > 0) {
        await recordAudit(trx, req, {
          action: 'academic_year.rolled_over',
          entityType: 'academic_year',
          entityId: targetId,
          metadata: { fromAcademicYearId: input.fromAcademicYearId, created: created.length, skipped: skipped.length },
        });
      }
      return { dryRun: input.dryRun, created, skipped };
    });
  });
};
