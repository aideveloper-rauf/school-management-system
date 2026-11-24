import { sql, type Kysely } from 'kysely';

/**
 * Attendance (roadmap C-8…C-10). One register per class section per school day.
 *
 * - attendance_sessions: the register for (class section, date). `taken_by` / `taken_at` record who first
 *   submitted it; `updated_by` the last change. Unique per section and date.
 * - attendance_records: one row per student in the register: present / absent / late / excused.
 * - attendance_corrections: changes after the edit window need a reason and approval by someone with
 *   `attendance.correct`. Approved corrections update the record; history stays here.
 * Per-period registers are not modelled yet (per-day is the baseline; see backlog).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`CURRENT_TIMESTAMP`;
  await db.schema
    .createTable('attendance_sessions')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('class_section_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('session_date', 'date', (c) => c.notNull())
    .addColumn('taken_by', 'integer', (c) => c.unsigned())
    .addColumn('taken_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_by', 'integer', (c) => c.unsigned())
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .addUniqueConstraint('uq_attendance_session', ['class_section_id', 'session_date'])
    .addForeignKeyConstraint('fk_att_session_section', ['class_section_id'], 'class_sections', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_att_session_taken_by', ['taken_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addForeignKeyConstraint('fk_att_session_updated_by', ['updated_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .execute();
  await db.schema.createIndex('idx_att_session_date').on('attendance_sessions').column('session_date').execute();

  await db.schema
    .createTable('attendance_records')
    .addColumn('session_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('student_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('status', 'varchar(8)', (c) => c.notNull())
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint('pk_attendance_records', ['session_id', 'student_id'])
    .addForeignKeyConstraint('fk_att_record_session', ['session_id'], 'attendance_sessions', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_att_record_student', ['student_id'], 'student_profiles', ['id'], (fk) => fk.onDelete('restrict'))
    .addCheckConstraint('chk_att_record_status', sql`status IN ('present', 'absent', 'late', 'excused')`)
    .execute();
  await db.schema.createIndex('idx_att_record_student').on('attendance_records').columns(['student_id', 'status']).execute();

  await db.schema
    .createTable('attendance_corrections')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('session_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('student_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('from_status', 'varchar(8)')
    .addColumn('to_status', 'varchar(8)', (c) => c.notNull())
    .addColumn('reason', 'varchar(500)', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('requested_by', 'integer', (c) => c.unsigned())
    .addColumn('decided_by', 'integer', (c) => c.unsigned())
    .addColumn('decided_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addForeignKeyConstraint('fk_att_corr_session', ['session_id'], 'attendance_sessions', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_att_corr_student', ['student_id'], 'student_profiles', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_att_corr_requested_by', ['requested_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addForeignKeyConstraint('fk_att_corr_decided_by', ['decided_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_att_corr_status', sql`status IN ('pending', 'approved', 'rejected')`)
    .addCheckConstraint('chk_att_corr_to', sql`to_status IN ('present', 'absent', 'late', 'excused')`)
    .execute();
  await db.schema.createIndex('idx_att_corr_status').on('attendance_corrections').columns(['status', 'created_at']).execute();
  await db.schema.createIndex('idx_att_corr_student').on('attendance_corrections').column('student_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only.
  for (const t of ['attendance_corrections', 'attendance_records', 'attendance_sessions']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
