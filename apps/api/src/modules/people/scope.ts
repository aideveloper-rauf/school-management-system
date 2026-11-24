import type { ExpressionBuilder, Kysely } from 'kysely';
import type { Database } from '../../db/types.js';
import type { AuthContext } from '../../plugins/auth.js';
import { notFound } from '../../lib/errors.js';

/**
 * Record scope for people data (roadmap C-7). A permission says what *kind* of read a role may attempt;
 * these helpers decide *which* records. Out-of-scope records are reported as NOT_FOUND so their
 * existence does not leak.
 *
 * A user may see a student when any of these hold:
 * - `students.read.all` (principal, registrar);
 * - `students.read.scoped` and the user's staff profile teaches (teacher_assignments) or is the class
 *   teacher of a class section the student is *currently* enrolled in;
 * - the user is a guardian with a **verified** link to the student;
 * - the user is the student.
 *
 * Classes: `students.read.all`, or the staff member teaches / is class teacher of the section.
 */
type Db = Kysely<Database>;
type StudentEb = ExpressionBuilder<Database & { s: Database['student_profiles'] }, 's'>;

/** Class section ids this user teaches or is class teacher of (any year). */
export function taughtSectionIds(db: Db, userId: number) {
  return db
    .selectFrom('teacher_assignments as ta')
    .innerJoin('staff_profiles as sp', 'sp.id', 'ta.staff_id')
    .select('ta.class_section_id as id')
    .where('sp.user_id', '=', userId)
    .union(
      db
        .selectFrom('class_sections as cs')
        .innerJoin('staff_profiles as sp', 'sp.id', 'cs.class_teacher_id')
        .select('cs.id as id')
        .where('sp.user_id', '=', userId),
    );
}

/**
 * WHERE-clause for a query over `student_profiles as s` limited to what `auth` may read.
 * Returns null when the user may read every student (no filter needed).
 */
export function studentScope(db: Db, auth: AuthContext): ((eb: StudentEb) => ReturnType<StudentEb['or']>) | null {
  if (auth.permissions.has('students.read.all')) return null;
  const userId = auth.user.id;
  const teaches = auth.permissions.has('students.read.scoped');
  return (eb) =>
    eb.or([
      eb('s.user_id', '=', userId),
      eb.exists(
        eb
          .selectFrom('student_guardians as sg')
          .innerJoin('guardian_profiles as gp', 'gp.id', 'sg.guardian_id')
          .select('sg.student_id')
          .whereRef('sg.student_id', '=', 's.id')
          .where('sg.verification_status', '=', 'verified')
          .where('gp.user_id', '=', userId),
      ),
      ...(teaches
        ? [
            eb.exists(
              eb
                .selectFrom('enrollments as e')
                .select('e.id')
                .whereRef('e.student_id', '=', 's.id')
                .where('e.ends_on', 'is', null)
                .where('e.class_section_id', 'in', taughtSectionIds(db, userId)),
            ),
          ]
        : []),
    ]);
}

/** Throws NOT_FOUND unless the student exists and is in the user's scope. */
export async function assertCanAccessStudent(db: Db, auth: AuthContext, studentId: number): Promise<void> {
  let q = db.selectFrom('student_profiles as s').select('s.id').where('s.id', '=', studentId);
  const scope = studentScope(db, auth);
  if (scope) q = q.where(scope);
  if (!(await q.executeTakeFirst())) throw notFound();
}

/** True when the user may see the whole roster of a class section. */
export async function canAccessClass(db: Db, auth: AuthContext, classSectionId: number): Promise<boolean> {
  if (auth.permissions.has('students.read.all')) return true;
  if (!auth.permissions.has('students.read.scoped') && !auth.permissions.has('attendance.record.scoped')) return false;
  const row = await db
    .selectFrom(taughtSectionIds(db, auth.user.id).as('t'))
    .select('t.id')
    .where('t.id', '=', classSectionId)
    .executeTakeFirst();
  return Boolean(row);
}

/** Throws NOT_FOUND unless the section exists and the user may see its roster. */
export async function assertCanAccessClass(db: Db, auth: AuthContext, classSectionId: number): Promise<void> {
  const exists = await db.selectFrom('class_sections').select('id').where('id', '=', classSectionId).executeTakeFirst();
  if (!exists || !(await canAccessClass(db, auth, classSectionId))) throw notFound();
}

/** Staff profile id linked to this user, if any. */
export async function staffIdOf(db: Db, userId: number): Promise<number | null> {
  const row = await db.selectFrom('staff_profiles').select('id').where('user_id', '=', userId).executeTakeFirst();
  return row?.id ?? null;
}

/**
 * Family access: the student linked to this account, or — with `studentId` — a child the user is a verified
 * guardian of. Throws NOT_FOUND otherwise. Returns null when the user is neither (e.g. staff without a child).
 */
export async function resolveFamilyStudent(db: Db, userId: number, studentId?: number): Promise<number | null> {
  const own = await db.selectFrom('student_profiles').select('id').where('user_id', '=', userId).executeTakeFirst();
  if (!studentId || studentId === own?.id) return own?.id ?? null;
  const link = await db
    .selectFrom('student_guardians as sg')
    .innerJoin('guardian_profiles as gp', 'gp.id', 'sg.guardian_id')
    .select('sg.student_id')
    .where('sg.student_id', '=', studentId)
    .where('sg.verification_status', '=', 'verified')
    .where('gp.user_id', '=', userId)
    .executeTakeFirst();
  if (!link) throw notFound();
  return studentId;
}
