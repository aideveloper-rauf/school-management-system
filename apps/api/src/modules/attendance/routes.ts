import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { sql, type Kysely } from 'kysely';
import {
  attendanceDateParamsSchema,
  attendanceRangeQuerySchema,
  correctionListQuerySchema,
  decideCorrectionSchema,
  isoDateSchema,
  pageWindow,
  requestCorrectionSchema,
  saveAttendanceSchema,
  toPaginated,
  type AttendanceStatus,
} from '@sms/shared';
import type { Db } from '../../db/client.js';
import type { Database } from '../../db/types.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError, forbidden, invalid, notFound } from '../../lib/errors.js';
import { requirePermission } from '../../plugins/auth.js';
import { routeId, todayIn } from '../people/common.js';
import { canAccessClass, resolveFamilyStudent, taughtSectionIds } from '../people/scope.js';
import { queueAbsenceNotice } from './notify.js';

/**
 * Attendance (roadmap C-8, C-9). One register per class section per school day.
 *
 * - Taking the register: `attendance.record.scoped` for a class the user teaches or is class teacher of,
 *   or `attendance.correct` for any class. Not for future dates, days outside the class's year, or days the
 *   calendar marks as not a school day.
 * - Edit window: the register can be changed freely until the end of its day (school time zone). After that,
 *   a change is a correction with a reason. Requests by `attendance.correct` holders apply at once; other
 *   requests wait for approval. Reasons stay in attendance_corrections, never in audit metadata.
 * - Newly absent students get a queued guardian notice (see notify.ts).
 */
type Trx = Kysely<Database>;
const canTake = requirePermission('attendance.record.scoped', 'attendance.correct');
const canView = requirePermission('attendance.record.scoped', 'attendance.correct', 'students.read.all');

async function schoolTimezone(db: Trx): Promise<string> {
  return (await db.selectFrom('schools').select('timezone').executeTakeFirst())?.timezone ?? 'Asia/Colombo';
}

/** Students enrolled in the section on `date`. */
function rosterOn(db: Trx, classSectionId: number, date: string) {
  return db
    .selectFrom('enrollments as e')
    .innerJoin('student_profiles as s', 's.id', 'e.student_id')
    .select(['s.id', 's.full_name', 's.admission_no', 'e.roll_no'])
    .where('e.class_section_id', '=', classSectionId)
    .where('e.starts_on', '<=', date)
    .where((eb) => eb.or([eb('e.ends_on', 'is', null), eb('e.ends_on', '>=', date)]));
}

async function sectionWithYear(db: Trx, id: number) {
  return db
    .selectFrom('class_sections as c')
    .innerJoin('grades as g', 'g.id', 'c.grade_id')
    .innerJoin('academic_years as y', 'y.id', 'c.academic_year_id')
    .select(['c.id', 'c.name', 'g.name as grade_name', 'y.starts_on', 'y.ends_on', 'y.label as year_label'])
    .where('c.id', '=', id)
    .executeTakeFirst();
}

/** null when it is a school day; otherwise the title of the closure event. */
async function closureOn(db: Trx, date: string): Promise<string | null> {
  const ev = await db
    .selectFrom('calendar_events')
    .select('title')
    .where('is_school_day', '=', 0)
    .where('starts_on', '<=', date)
    .where('ends_on', '>=', date)
    .executeTakeFirst();
  return ev?.title ?? null;
}

async function assertClassAccess(db: Trx, req: FastifyRequest, classSectionId: number, forWrite: boolean): Promise<void> {
  const auth = req.auth!;
  if (auth.permissions.has('attendance.correct')) return;
  if (forWrite && !auth.permissions.has('attendance.record.scoped')) throw forbidden();
  if (!(await canAccessClass(db, auth, classSectionId))) throw notFound();
}

export const attendanceRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  /** The register for one class and day: roster, marks, and whether it can still be edited directly. */
  app.get('/class-sections/:id/attendance/:date', { preHandler: canView }, async (req) => {
    const { id, date } = attendanceDateParamsSchema.parse(req.params);
    const section = await sectionWithYear(db, id);
    if (!section) throw notFound();
    await assertClassAccess(db, req, id, false);
    const tz = await schoolTimezone(db);
    const today = todayIn(tz);
    const session = await db
      .selectFrom('attendance_sessions as a')
      .leftJoin('users as u', 'u.id', 'a.taken_by')
      .select(['a.id', 'a.taken_at', 'a.updated_at', 'u.display_name as taken_by_name'])
      .where('a.class_section_id', '=', id)
      .where('a.session_date', '=', date)
      .executeTakeFirst();
    const students = await rosterOn(db, id, date).orderBy('e.roll_no').orderBy('s.full_name').execute();
    const marks = session
      ? await db.selectFrom('attendance_records').select(['student_id', 'status']).where('session_id', '=', session.id).execute()
      : [];
    const pending = session
      ? await db
          .selectFrom('attendance_corrections')
          .select('student_id')
          .where('session_id', '=', session.id)
          .where('status', '=', 'pending')
          .execute()
      : [];
    const byStudent = new Map(marks.map((m) => [m.student_id, m.status]));
    const pendingSet = new Set(pending.map((p) => p.student_id));
    const closure = await closureOn(db, date);
    const inYear = date >= section.starts_on && date <= section.ends_on;
    return {
      classSection: { id: section.id, name: section.name, gradeName: section.grade_name, yearLabel: section.year_label },
      date,
      today,
      closure,
      inYear,
      // Direct edits: on the day itself (or catching up a register nobody took, for attendance.correct).
      editable: inYear && !closure && date <= today && (date === today || (!session && req.auth!.permissions.has('attendance.correct'))),
      session: session
        ? {
            takenAt: new Date(session.taken_at).toISOString(),
            updatedAt: new Date(session.updated_at).toISOString(),
            takenBy: session.taken_by_name,
          }
        : null,
      students: students.map((s) => ({
        id: s.id,
        fullName: s.full_name,
        admissionNo: s.admission_no,
        rollNo: s.roll_no,
        status: byStudent.get(s.id) ?? null,
        correctionPending: pendingSet.has(s.id),
      })),
    };
  });

  app.put('/class-sections/:id/attendance/:date', { preHandler: canTake }, async (req) => {
    const { id, date } = attendanceDateParamsSchema.parse(req.params);
    const input = saveAttendanceSchema.parse(req.body);
    const auth = req.auth!;
    const result = await db.transaction().execute(async (trx) => {
      const section = await sectionWithYear(trx, id);
      if (!section) throw notFound();
      await assertClassAccess(trx, req, id, true);
      const tz = await schoolTimezone(trx);
      const today = todayIn(tz);
      if (date > today) throw invalid('date', 'Attendance cannot be taken for a future date');
      if (date < section.starts_on || date > section.ends_on) throw invalid('date', 'Date is outside the class’s academic year');
      if (await closureOn(trx, date)) throw new AppError('CONFLICT', 'errors.notSchoolDay');

      const roster = new Set((await rosterOn(trx, id, date).execute()).map((r) => r.id));
      const outside = input.records.find((r) => !roster.has(r.studentId));
      if (outside) throw invalid('records', 'A student is not in this class on that date');

      let session = await trx
        .selectFrom('attendance_sessions')
        .select(['id'])
        .where('class_section_id', '=', id)
        .where('session_date', '=', date)
        .forUpdate()
        .executeTakeFirst();
      if (session && date !== today) throw new AppError('CONFLICT', 'errors.attendanceLocked');
      if (!session && date !== today && !auth.permissions.has('attendance.correct'))
        throw new AppError('CONFLICT', 'errors.attendanceLocked');
      if (!session) {
        const res = await trx
          .insertInto('attendance_sessions')
          .values({ class_section_id: id, session_date: date, taken_by: auth.user.id, updated_by: auth.user.id })
          .executeTakeFirstOrThrow(); // concurrent first save → 409 duplicate; the client reloads
        session = { id: Number(res.insertId) };
      } else {
        await trx.updateTable('attendance_sessions').set({ updated_by: auth.user.id }).where('id', '=', session.id).execute();
      }
      const before = new Map(
        (await trx.selectFrom('attendance_records').select(['student_id', 'status']).where('session_id', '=', session.id).execute()).map(
          (r) => [r.student_id, r.status],
        ),
      );
      for (const r of input.records) {
        await trx
          .insertInto('attendance_records')
          .values({ session_id: session.id, student_id: r.studentId, status: r.status })
          .onDuplicateKeyUpdate({ status: r.status })
          .execute();
      }
      const newlyAbsent = input.records
        .filter((r) => r.status === 'absent' && before.get(r.studentId) !== 'absent')
        .map((r) => r.studentId);
      const counts = input.records.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
      await recordAudit(trx, req, { action: 'attendance.saved', entityType: 'class_section', entityId: id, metadata: { date, ...counts } });
      return { newlyAbsent, tz };
    });
    for (const studentId of result.newlyAbsent) await queueAbsenceNotice(db, studentId, date, result.tz);
    return { ok: true };
  });

  /** Per-student totals for a class over a date range (attendance summary report). */
  app.get('/class-sections/:id/attendance', { preHandler: canView }, async (req) => {
    const id = routeId(req);
    const q = attendanceRangeQuerySchema.parse(req.query);
    const section = await sectionWithYear(db, id);
    if (!section) throw notFound();
    await assertClassAccess(db, req, id, false);
    const sessions = await db
      .selectFrom('attendance_sessions')
      .select(['id', 'session_date'])
      .where('class_section_id', '=', id)
      .where('session_date', '>=', q.from)
      .where('session_date', '<=', q.to)
      .orderBy('session_date')
      .execute();
    const rows = sessions.length
      ? await db
          .selectFrom('attendance_records')
          .select(['student_id', 'status', db.fn.countAll<number>().as('n')])
          .where(
            'session_id',
            'in',
            sessions.map((s) => s.id),
          )
          .groupBy(['student_id', 'status'])
          .execute()
      : [];
    const students = await db
      .selectFrom('enrollments as e')
      .innerJoin('student_profiles as s', 's.id', 'e.student_id')
      .select(['s.id', 's.full_name', 's.admission_no', 'e.roll_no'])
      .where('e.class_section_id', '=', id)
      .where('e.starts_on', '<=', q.to)
      .where((eb) => eb.or([eb('e.ends_on', 'is', null), eb('e.ends_on', '>=', q.from)]))
      .groupBy(['s.id', 's.full_name', 's.admission_no', 'e.roll_no'])
      .orderBy('e.roll_no')
      .orderBy('s.full_name')
      .execute();
    const totals = new Map<number, Record<AttendanceStatus, number>>();
    for (const r of rows) {
      const t = totals.get(r.student_id) ?? { present: 0, absent: 0, late: 0, excused: 0 };
      t[r.status] = Number(r.n);
      totals.set(r.student_id, t);
    }
    return {
      classSection: { id: section.id, name: section.name, gradeName: section.grade_name, yearLabel: section.year_label },
      from: q.from,
      to: q.to,
      daysTaken: sessions.length,
      students: students.map((s) => {
        const t = totals.get(s.id) ?? { present: 0, absent: 0, late: 0, excused: 0 };
        const marked = t.present + t.absent + t.late + t.excused;
        return {
          id: s.id,
          fullName: s.full_name,
          admissionNo: s.admission_no,
          rollNo: s.roll_no,
          ...t,
          marked,
          /** Present or late, as a share of marked days (null when nothing marked). */
          rate: marked ? Math.round(((t.present + t.late) / marked) * 1000) / 10 : null,
        };
      }),
    };
  });

  /** Registers this user can take on a date (class teacher or subject teacher), with taken/not-taken state. */
  app.get('/me/attendance-registers', { preHandler: canTake }, async (req) => {
    const tz = await schoolTimezone(db);
    const date = typeof (req.query as { date?: unknown }).date === 'string' ? String((req.query as { date: string }).date) : todayIn(tz);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw invalid('date', 'Use YYYY-MM-DD');
    const auth = req.auth!;
    let q = db
      .selectFrom('class_sections as c')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .innerJoin('academic_years as y', 'y.id', 'c.academic_year_id')
      .leftJoin('attendance_sessions as a', (j) => j.onRef('a.class_section_id', '=', 'c.id').on('a.session_date', '=', date))
      .leftJoin('staff_profiles as t', 't.id', 'c.class_teacher_id')
      .select(['c.id', 'c.name', 'g.name as grade_name', 'g.level', 'a.id as session_id', 't.user_id as class_teacher_user_id'])
      .where('y.starts_on', '<=', date)
      .where('y.ends_on', '>=', date);
    if (!auth.permissions.has('attendance.correct')) q = q.where('c.id', 'in', taughtSectionIds(db, auth.user.id));
    const rows = await q.orderBy('g.level').orderBy('c.name').execute();
    return {
      date,
      closure: await closureOn(db, date),
      items: rows.map((r) => ({
        classSection: { id: r.id, name: r.name, gradeName: r.grade_name },
        taken: r.session_id !== null,
        isClassTeacher: r.class_teacher_user_id === auth.user.id,
      })),
    };
  });

  /** A student's own attendance, or a verified child's (`?studentId=`), over a date range (default 30 days). */
  app.get('/me/attendance', { preHandler: requirePermission('self.profile.read') }, async (req) => {
    const q = z
      .object({ studentId: z.coerce.number().int().positive().optional(), from: isoDateSchema.optional(), to: isoDateSchema.optional() })
      .parse(req.query);
    const studentId = await resolveFamilyStudent(db, req.auth!.user.id, q.studentId);
    if (!studentId) return { items: [], summary: { present: 0, absent: 0, late: 0, excused: 0 } };
    const to = q.to ?? todayIn(await schoolTimezone(db));
    const from =
      q.from ??
      (() => {
        const d = new Date(`${to}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - 30);
        return d.toISOString().slice(0, 10);
      })();
    const rows = await db
      .selectFrom('attendance_records as r')
      .innerJoin('attendance_sessions as s', 's.id', 'r.session_id')
      .select(['s.session_date', 'r.status'])
      .where('r.student_id', '=', studentId)
      .where('s.session_date', '>=', from)
      .where('s.session_date', '<=', to)
      .orderBy('s.session_date', 'desc')
      .execute();
    const summary = { present: 0, absent: 0, late: 0, excused: 0 };
    for (const r of rows) summary[r.status]++;
    return { from, to, items: rows.map((r) => ({ date: r.session_date, status: r.status })), summary };
  });

  // Corrections ----------------------------------------------------------------
  app.post('/attendance/corrections', { preHandler: canTake }, async (req, reply) => {
    const input = requestCorrectionSchema.parse(req.body);
    const auth = req.auth!;
    const approver = auth.permissions.has('attendance.correct');
    const out = await db.transaction().execute(async (trx) => {
      await assertClassAccess(trx, req, input.classSectionId, true);
      const session = await trx
        .selectFrom('attendance_sessions')
        .select('id')
        .where('class_section_id', '=', input.classSectionId)
        .where('session_date', '=', input.date)
        .forUpdate()
        .executeTakeFirst();
      if (!session) throw invalid('date', 'No register was taken for this class on that date');
      const onRoster = await rosterOn(trx, input.classSectionId, input.date).where('s.id', '=', input.studentId).executeTakeFirst();
      if (!onRoster) throw invalid('studentId', 'Student is not in this class on that date');
      const current = await trx
        .selectFrom('attendance_records')
        .select('status')
        .where('session_id', '=', session.id)
        .where('student_id', '=', input.studentId)
        .executeTakeFirst();
      if (current?.status === input.toStatus) throw invalid('toStatus', 'That is already the recorded status');
      const dup = await trx
        .selectFrom('attendance_corrections')
        .select('id')
        .where('session_id', '=', session.id)
        .where('student_id', '=', input.studentId)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (dup) throw new AppError('CONFLICT', 'errors.correctionPending');
      const res = await trx
        .insertInto('attendance_corrections')
        .values({
          session_id: session.id,
          student_id: input.studentId,
          from_status: current?.status ?? null,
          to_status: input.toStatus,
          reason: input.reason,
          status: approver ? 'approved' : 'pending',
          requested_by: auth.user.id,
          decided_by: approver ? auth.user.id : null,
          decided_at: approver ? sql<Date>`CURRENT_TIMESTAMP` : null,
        })
        .executeTakeFirstOrThrow();
      const correctionId = Number(res.insertId);
      if (approver) await applyCorrection(trx, session.id, input.studentId, input.toStatus);
      await recordAudit(trx, req, {
        action: approver ? 'attendance.corrected' : 'attendance.correction_requested',
        entityType: 'student',
        entityId: input.studentId,
        metadata: {
          correctionId,
          classSectionId: input.classSectionId,
          date: input.date,
          from: current?.status ?? null,
          to: input.toStatus,
        },
      });
      return { correctionId, applied: approver, tz: await schoolTimezone(trx), wasAbsent: current?.status === 'absent' };
    });
    if (out.applied && input.toStatus === 'absent' && !out.wasAbsent) await queueAbsenceNotice(db, input.studentId, input.date, out.tz);
    return reply.status(201).send({ id: out.correctionId, status: out.applied ? 'approved' : 'pending' });
  });

  app.get('/attendance/corrections', { preHandler: canTake }, async (req) => {
    const q = correctionListQuerySchema.parse(req.query);
    const auth = req.auth!;
    let base = db
      .selectFrom('attendance_corrections as ac')
      .innerJoin('attendance_sessions as a', 'a.id', 'ac.session_id')
      .innerJoin('class_sections as c', 'c.id', 'a.class_section_id')
      .innerJoin('grades as g', 'g.id', 'c.grade_id')
      .innerJoin('student_profiles as s', 's.id', 'ac.student_id')
      .leftJoin('users as rq', 'rq.id', 'ac.requested_by')
      .leftJoin('users as dc', 'dc.id', 'ac.decided_by');
    if (!auth.permissions.has('attendance.correct')) base = base.where('ac.requested_by', '=', auth.user.id);
    if (q.status) base = base.where('ac.status', '=', q.status);
    const { limit, offset } = pageWindow(q);
    const [rows, total] = await Promise.all([
      base
        .select([
          'ac.id',
          'ac.from_status',
          'ac.to_status',
          'ac.reason',
          'ac.status',
          'ac.created_at',
          'ac.decided_at',
          'a.session_date',
          'c.id as class_id',
          'c.name as class_name',
          'g.name as grade_name',
          's.id as student_id',
          's.full_name',
          's.admission_no',
          'rq.display_name as requested_by',
          'dc.display_name as decided_by',
        ])
        .orderBy('ac.created_at', 'desc')
        .orderBy('ac.id', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
      base.select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return toPaginated(
      rows.map((r) => ({
        id: r.id,
        date: r.session_date,
        classSection: { id: r.class_id, name: r.class_name, gradeName: r.grade_name },
        student: { id: r.student_id, fullName: r.full_name, admissionNo: r.admission_no },
        fromStatus: r.from_status,
        toStatus: r.to_status,
        reason: r.reason,
        status: r.status,
        requestedBy: r.requested_by,
        requestedAt: new Date(r.created_at).toISOString(),
        decidedBy: r.decided_by,
        decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : null,
      })),
      total.n,
      q,
    );
  });

  app.post('/attendance/corrections/:id/decide', { preHandler: requirePermission('attendance.correct') }, async (req) => {
    const id = routeId(req);
    const input = decideCorrectionSchema.parse(req.body);
    const out = await db.transaction().execute(async (trx) => {
      const c = await trx
        .selectFrom('attendance_corrections as ac')
        .innerJoin('attendance_sessions as a', 'a.id', 'ac.session_id')
        .select(['ac.id', 'ac.status', 'ac.session_id', 'ac.student_id', 'ac.to_status', 'a.session_date'])
        .where('ac.id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!c) throw notFound();
      if (c.status !== 'pending') throw new AppError('CONFLICT', 'errors.correctionDecided');
      let wasAbsent = false;
      if (input.decision === 'approved') {
        const cur = await trx
          .selectFrom('attendance_records')
          .select('status')
          .where('session_id', '=', c.session_id)
          .where('student_id', '=', c.student_id)
          .executeTakeFirst();
        wasAbsent = cur?.status === 'absent';
        await applyCorrection(trx, c.session_id, c.student_id, c.to_status);
      }
      await trx
        .updateTable('attendance_corrections')
        .set({ status: input.decision, decided_by: req.auth!.user.id, decided_at: sql<Date>`CURRENT_TIMESTAMP` })
        .where('id', '=', id)
        .execute();
      await recordAudit(trx, req, {
        action: input.decision === 'approved' ? 'attendance.correction_approved' : 'attendance.correction_rejected',
        entityType: 'student',
        entityId: c.student_id,
        metadata: { correctionId: id, date: c.session_date, to: c.to_status },
      });
      return { ...c, wasAbsent, tz: await schoolTimezone(trx) };
    });
    if (input.decision === 'approved' && out.to_status === 'absent' && !out.wasAbsent)
      await queueAbsenceNotice(db, out.student_id, out.session_date, out.tz);
    return { ok: true };
  });
};

async function applyCorrection(trx: Trx, sessionId: number, studentId: number, status: AttendanceStatus): Promise<void> {
  await trx
    .insertInto('attendance_records')
    .values({ session_id: sessionId, student_id: studentId, status })
    .onDuplicateKeyUpdate({ status })
    .execute();
}
