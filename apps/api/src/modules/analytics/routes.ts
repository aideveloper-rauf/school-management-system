import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { Db } from '../../db/client.js';
import { requirePermission } from '../../plugins/auth.js';
import { todayIn } from '../people/common.js';

/**
 * School dashboards from approved aggregates only (roadmap Phase 5).
 *
 * - Enrolment: students per class now.
 * - Attendance: rate per class over a window (present + late ÷ marked), from saved registers.
 * - Results: per class and subject averages from the LATEST PUBLISHED result release (never live or unapproved marks).
 * - Small-group suppression: any figure built from fewer than MIN_GROUP students is withheld (`null` + `suppressed`),
 *   so a dashboard cannot single out one child.
 * No names or individual rows are returned. Permission: `analytics.read` (principal, academic coordinator).
 */
export const MIN_GROUP = 5;

export const analyticsRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/analytics/overview', { preHandler: requirePermission('analytics.read') }, async (req) => {
    const q = z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }).parse(req.query);
    const year = await db.selectFrom('academic_years').select(['id', 'label']).where('is_current', '=', 1).executeTakeFirst();
    if (!year) return { year: null, minGroup: MIN_GROUP, classes: [], results: [] };
    const tz = (await db.selectFrom('schools').select('timezone').executeTakeFirst())?.timezone ?? 'Asia/Colombo';
    const to = todayIn(tz);
    const fromDate = new Date(`${to}T00:00:00Z`);
    fromDate.setUTCDate(fromDate.getUTCDate() - q.days);
    const from = fromDate.toISOString().slice(0, 10);

    const sections = await db
      .selectFrom('class_sections as c')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .select(['c.id', 'c.name', 'g.name as grade_name', 'g.level'])
      .where('c.academic_year_id', '=', year.id)
      .orderBy('g.level')
      .orderBy('c.name')
      .execute();
    const enrolled = await db
      .selectFrom('enrollments')
      .select(['class_section_id', db.fn.countAll<number>().as('n')])
      .where('academic_year_id', '=', year.id)
      .where('ends_on', 'is', null)
      .groupBy('class_section_id')
      .execute();
    const attendance = await db
      .selectFrom('attendance_records as r')
      .innerJoin('attendance_sessions as s', 's.id', 'r.session_id')
      .select([
        's.class_section_id',
        db.fn.countAll<number>().as('marked'),
        sql<number>`SUM(r.status IN ('present', 'late'))`.as('attended'),
        sql<number>`COUNT(DISTINCT r.student_id)`.as('students'),
        sql<number>`COUNT(DISTINCT s.id)`.as('days'),
      ])
      .where('s.session_date', '>=', from)
      .where('s.session_date', '<=', to)
      .groupBy('s.class_section_id')
      .execute();
    const enrolledBy = new Map(enrolled.map((e) => [e.class_section_id, Number(e.n)]));
    const attBy = new Map(attendance.map((a) => [a.class_section_id, a]));

    // Published results: latest release per series × class, averaged per subject from the snapshot.
    const releases = await db
      .selectFrom('result_releases as r')
      .innerJoin('exam_series as es', 'es.id', 'r.series_id')
      .select(['r.series_id', 'r.class_section_id', 'r.snapshot', 'es.name as series_name'])
      .where('es.academic_year_id', '=', year.id)
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
      .execute();
    const results = releases.map((r) => {
      const snap = JSON.parse(r.snapshot) as {
        subjects: Array<{ id: number; name: string }>;
        students: Array<{ average: number | null; subjects: Array<{ subjectId: number; percent: number | null }> }>;
      };
      const mean = (xs: number[]) => (xs.length >= MIN_GROUP ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
      const averages = snap.students.map((s) => s.average).filter((x): x is number => x !== null);
      return {
        seriesId: r.series_id,
        series: r.series_name,
        classSectionId: r.class_section_id,
        students: snap.students.length,
        suppressed: averages.length < MIN_GROUP,
        average: mean(averages),
        subjects: snap.subjects.map((sub) => {
          const xs = snap.students
            .map((s) => s.subjects.find((x) => x.subjectId === sub.id)?.percent)
            .filter((x): x is number => x !== null && x !== undefined);
          return { id: sub.id, name: sub.name, average: mean(xs) };
        }),
      };
    });

    return {
      year,
      from,
      to,
      minGroup: MIN_GROUP,
      classes: sections.map((c) => {
        const a = attBy.get(c.id);
        const n = enrolledBy.get(c.id) ?? 0;
        const small = Number(a?.students ?? 0) < MIN_GROUP;
        return {
          id: c.id,
          name: `${c.grade_name} / ${c.name}`,
          enrolled: n < MIN_GROUP && n > 0 ? null : n,
          attendanceDays: Number(a?.days ?? 0),
          attendanceRate: !a || small || Number(a.marked) === 0 ? null : Math.round((Number(a.attended) / Number(a.marked)) * 1000) / 10,
          suppressed: (n > 0 && n < MIN_GROUP) || (!!a && small),
        };
      }),
      results,
    };
  });
};
