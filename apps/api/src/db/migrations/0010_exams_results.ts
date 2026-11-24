import { sql, type Kysely } from 'kysely';

/**
 * Exams, marks and results (roadmap E-1…E-6).
 *
 * - grading_scales / grading_scale_versions: bands as JSON ([{ min, grade, label }], min = lowest percentage).
 *   A change is a new version; a series pins the version it was set up with.
 * - exam_series: e.g. "Term 1 test 2027" for a year (optional term).
 * - exam_components: per series × grade × subject, e.g. "Paper I" with max marks and a weight.
 * - mark_sheets: workflow state per component × class section: open → submitted → moderated → approved.
 * - marks: DECIMAL raw mark with present/absent/exempt, the max marks at entry time, assessor and time.
 * - mark_changes: every change after submission, with reason (never in audit metadata).
 * - result_releases: immutable published snapshots per series × class section; a correction is a new version
 *   with a reason. Rows are never updated or deleted by the application.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`CURRENT_TIMESTAMP`;

  await db.schema
    .createTable('grading_scales')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('name', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .execute();
  await db.schema
    .createTable('grading_scale_versions')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('scale_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('version', 'smallint', (c) => c.notNull().unsigned())
    .addColumn('bands', 'text', (c) => c.notNull())
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addUniqueConstraint('uq_scale_version', ['scale_id', 'version'])
    .addForeignKeyConstraint('fk_gsv_scale', ['scale_id'], 'grading_scales', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_gsv_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .execute();

  await db.schema
    .createTable('exam_series')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('academic_year_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('term_id', 'integer', (c) => c.unsigned())
    .addColumn('name', 'varchar(128)', (c) => c.notNull())
    .addColumn('grading_scale_version_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addUniqueConstraint('uq_series_name', ['academic_year_id', 'name'])
    .addForeignKeyConstraint('fk_series_year', ['academic_year_id'], 'academic_years', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_series_term', ['term_id'], 'terms', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_series_scale', ['grading_scale_version_id'], 'grading_scale_versions', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_series_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .execute();
  await db.schema.createIndex('idx_series_term').on('exam_series').column('term_id').execute();
  await db.schema.createIndex('idx_series_scale').on('exam_series').column('grading_scale_version_id').execute();

  await db.schema
    .createTable('exam_components')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('series_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('grade_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('subject_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('name', 'varchar(64)', (c) => c.notNull())
    .addColumn('max_marks', 'decimal(6, 2)', (c) => c.notNull())
    .addColumn('weight', 'decimal(5, 2)', (c) => c.notNull().defaultTo(100))
    .addColumn('paper_version_id', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addUniqueConstraint('uq_component', ['series_id', 'grade_id', 'subject_id', 'name'])
    .addForeignKeyConstraint('fk_comp_series', ['series_id'], 'exam_series', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_comp_grade', ['grade_id'], 'grades', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_comp_subject', ['subject_id'], 'subjects', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_comp_paper', ['paper_version_id'], 'exam_paper_versions', ['id'], (fk) => fk.onDelete('restrict'))
    .addCheckConstraint('chk_comp_max', sql`max_marks > 0`)
    .addCheckConstraint('chk_comp_weight', sql`weight > 0 AND weight <= 100`)
    .execute();
  await db.schema.createIndex('idx_comp_grade').on('exam_components').column('grade_id').execute();
  await db.schema.createIndex('idx_comp_subject').on('exam_components').column('subject_id').execute();
  await db.schema.createIndex('idx_comp_paper').on('exam_components').column('paper_version_id').execute();

  await db.schema
    .createTable('mark_sheets')
    .addColumn('component_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('class_section_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('open'))
    .addColumn('submitted_by', 'integer', (c) => c.unsigned())
    .addColumn('submitted_at', 'timestamp')
    .addColumn('moderated_by', 'integer', (c) => c.unsigned())
    .addColumn('moderated_at', 'timestamp')
    .addColumn('approved_by', 'integer', (c) => c.unsigned())
    .addColumn('approved_at', 'timestamp')
    .addColumn('reopened_by', 'integer', (c) => c.unsigned())
    .addColumn('reopened_at', 'timestamp')
    .addColumn('reopen_reason', 'varchar(500)')
    .addPrimaryKeyConstraint('pk_mark_sheets', ['component_id', 'class_section_id'])
    .addForeignKeyConstraint('fk_ms_component', ['component_id'], 'exam_components', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_ms_section', ['class_section_id'], 'class_sections', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_ms_submitted_by', ['submitted_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addForeignKeyConstraint('fk_ms_moderated_by', ['moderated_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addForeignKeyConstraint('fk_ms_approved_by', ['approved_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addForeignKeyConstraint('fk_ms_reopened_by', ['reopened_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_ms_status', sql`status IN ('open', 'submitted', 'moderated', 'approved')`)
    .execute();
  await db.schema.createIndex('idx_ms_section').on('mark_sheets').column('class_section_id').execute();

  await db.schema
    .createTable('marks')
    .addColumn('component_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('student_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('raw_mark', 'decimal(6, 2)')
    .addColumn('status', 'varchar(8)', (c) => c.notNull().defaultTo('present'))
    .addColumn('max_marks', 'decimal(6, 2)', (c) => c.notNull())
    .addColumn('entered_by', 'integer', (c) => c.unsigned())
    .addColumn('entered_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .addPrimaryKeyConstraint('pk_marks', ['component_id', 'student_id'])
    .addForeignKeyConstraint('fk_marks_component', ['component_id'], 'exam_components', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_marks_student', ['student_id'], 'student_profiles', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_marks_entered_by', ['entered_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_marks_status', sql`status IN ('present', 'absent', 'exempt')`)
    .addCheckConstraint('chk_marks_value', sql`(status = 'present' AND raw_mark IS NOT NULL AND raw_mark >= 0 AND raw_mark <= max_marks) OR (status <> 'present' AND raw_mark IS NULL)`)
    .execute();
  await db.schema.createIndex('idx_marks_student').on('marks').column('student_id').execute();

  await db.schema
    .createTable('mark_changes')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('component_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('student_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('from_mark', 'decimal(6, 2)')
    .addColumn('from_status', 'varchar(8)')
    .addColumn('to_mark', 'decimal(6, 2)')
    .addColumn('to_status', 'varchar(8)', (c) => c.notNull())
    .addColumn('reason', 'varchar(500)', (c) => c.notNull())
    .addColumn('changed_by', 'integer', (c) => c.unsigned())
    .addColumn('changed_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addForeignKeyConstraint('fk_mc_component', ['component_id'], 'exam_components', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_mc_student', ['student_id'], 'student_profiles', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_mc_changed_by', ['changed_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .execute();
  await db.schema.createIndex('idx_mc_component_student').on('mark_changes').columns(['component_id', 'student_id']).execute();
  await db.schema.createIndex('idx_mc_student').on('mark_changes').column('student_id').execute();

  await db.schema
    .createTable('result_releases')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('series_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('class_section_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('version', 'smallint', (c) => c.notNull().unsigned())
    .addColumn('reason', 'varchar(500)')
    .addColumn('snapshot', sql`mediumtext`, (c) => c.notNull())
    .addColumn('snapshot_sha256', 'char(64)', (c) => c.notNull())
    .addColumn('published_by', 'integer', (c) => c.unsigned())
    .addColumn('published_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addUniqueConstraint('uq_release_version', ['series_id', 'class_section_id', 'version'])
    .addForeignKeyConstraint('fk_rr_series', ['series_id'], 'exam_series', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_rr_section', ['class_section_id'], 'class_sections', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_rr_published_by', ['published_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .execute();
  await db.schema.createIndex('idx_rr_section').on('result_releases').column('class_section_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only.
  for (const t of ['result_releases', 'mark_changes', 'marks', 'mark_sheets', 'exam_components', 'exam_series', 'grading_scale_versions', 'grading_scales']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
