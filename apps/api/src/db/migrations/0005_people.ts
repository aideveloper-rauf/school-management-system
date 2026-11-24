import { sql, type Kysely } from 'kysely';

/**
 * People (roadmap C-1, C-5, C-6) and CSV import jobs (C-4).
 *
 * Field set is deliberately minimal and PROVISIONAL until the data-handling policy (P0-6) is signed off:
 * no national ID, address, health, religion or ethnicity columns. Add fields only with a documented purpose.
 *
 * - staff_profiles / student_profiles / guardian_profiles: optional 1:1 link to a sign-in account (users).
 * - enrollments: student ↔ class section with history (one open row per student, enforced in the API
 *   under a row lock on the student). academic_year_id is copied from the section for fast year queries.
 * - student_status_events: admission / leave / transfer / graduation history with a reason code.
 * - student_guardians: explicit relationship with a verification state; only `verified` links grant access.
 * - teacher_assignments: staff ↔ class section ↔ subject. class_sections.class_teacher_id = the class teacher.
 * - import_jobs: one row per uploaded CSV (preview → applied); row errors hold row/field/message only.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`CURRENT_TIMESTAMP`;
  const onUpdate = sql`ON UPDATE CURRENT_TIMESTAMP`;

  await db.schema
    .createTable('staff_profiles')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('staff_no', 'varchar(32)', (c) => c.notNull().unique())
    .addColumn('full_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('name_with_initials', 'varchar(191)')
    .addColumn('designation', 'varchar(64)')
    .addColumn('work_email', 'varchar(191)')
    .addColumn('work_phone', 'varchar(32)')
    .addColumn('joined_on', 'date')
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('active'))
    .addColumn('left_on', 'date')
    .addColumn('user_id', 'integer', (c) => c.unsigned().unique())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(onUpdate))
    .addForeignKeyConstraint('fk_staff_profiles_user', ['user_id'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_staff_status', sql`status IN ('active', 'left')`)
    .execute();
  await db.schema.createIndex('idx_staff_profiles_name').on('staff_profiles').column('full_name').execute();

  await db.schema
    .createTable('student_profiles')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('admission_no', 'varchar(32)', (c) => c.notNull().unique())
    .addColumn('full_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('name_with_initials', 'varchar(191)')
    .addColumn('date_of_birth', 'date')
    .addColumn('gender', 'varchar(8)')
    .addColumn('admitted_on', 'date', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('active'))
    .addColumn('left_on', 'date')
    .addColumn('user_id', 'integer', (c) => c.unsigned().unique())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(onUpdate))
    .addForeignKeyConstraint('fk_student_profiles_user', ['user_id'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_student_status', sql`status IN ('active', 'left', 'transferred', 'graduated')`)
    .addCheckConstraint('chk_student_gender', sql`gender IS NULL OR gender IN ('female', 'male', 'other')`)
    .execute();
  await db.schema.createIndex('idx_student_profiles_name').on('student_profiles').column('full_name').execute();
  await db.schema.createIndex('idx_student_profiles_status').on('student_profiles').column('status').execute();

  await db.schema
    .createTable('student_status_events')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('student_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('from_status', 'varchar(16)')
    .addColumn('to_status', 'varchar(16)', (c) => c.notNull())
    .addColumn('effective_on', 'date', (c) => c.notNull())
    .addColumn('reason', 'varchar(32)', (c) => c.notNull())
    .addColumn('note', 'varchar(500)')
    .addColumn('recorded_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addForeignKeyConstraint('fk_student_status_student', ['student_id'], 'student_profiles', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_student_status_recorded_by', ['recorded_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .execute();
  await db.schema.createIndex('idx_student_status_student').on('student_status_events').column('student_id').execute();

  await db.schema
    .createTable('enrollments')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('student_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('class_section_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('academic_year_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('roll_no', 'smallint', (c) => c.unsigned())
    .addColumn('starts_on', 'date', (c) => c.notNull())
    .addColumn('ends_on', 'date')
    .addColumn('end_reason', 'varchar(32)')
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addForeignKeyConstraint('fk_enrollments_student', ['student_id'], 'student_profiles', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_enrollments_section', ['class_section_id'], 'class_sections', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_enrollments_year', ['academic_year_id'], 'academic_years', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_enrollments_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_enrollment_dates', sql`ends_on IS NULL OR ends_on >= starts_on`)
    .execute();
  await db.schema.createIndex('idx_enrollments_student').on('enrollments').columns(['student_id', 'ends_on']).execute();
  await db.schema.createIndex('idx_enrollments_section').on('enrollments').columns(['class_section_id', 'ends_on']).execute();
  await db.schema.createIndex('idx_enrollments_year').on('enrollments').column('academic_year_id').execute();

  await db.schema
    .createTable('guardian_profiles')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('full_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('phone', 'varchar(32)')
    .addColumn('email', 'varchar(191)')
    .addColumn('preferred_locale', 'varchar(8)', (c) => c.notNull().defaultTo('en'))
    .addColumn('notify_email', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('notify_sms', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('user_id', 'integer', (c) => c.unsigned().unique())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(onUpdate))
    .addForeignKeyConstraint('fk_guardian_profiles_user', ['user_id'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .execute();
  await db.schema.createIndex('idx_guardian_profiles_name').on('guardian_profiles').column('full_name').execute();
  await db.schema.createIndex('idx_guardian_profiles_phone').on('guardian_profiles').column('phone').execute();

  await db.schema
    .createTable('student_guardians')
    .addColumn('student_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('guardian_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('relationship', 'varchar(16)', (c) => c.notNull())
    .addColumn('is_primary', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('verification_status', 'varchar(16)', (c) => c.notNull().defaultTo('pending'))
    .addColumn('verification_method', 'varchar(32)')
    .addColumn('verified_by', 'integer', (c) => c.unsigned())
    .addColumn('verified_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addPrimaryKeyConstraint('pk_student_guardians', ['student_id', 'guardian_id'])
    .addForeignKeyConstraint('fk_student_guardians_student', ['student_id'], 'student_profiles', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_student_guardians_guardian', ['guardian_id'], 'guardian_profiles', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_student_guardians_verified_by', ['verified_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_sg_relationship', sql`relationship IN ('mother', 'father', 'guardian', 'other')`)
    .addCheckConstraint('chk_sg_status', sql`verification_status IN ('pending', 'verified', 'rejected')`)
    .execute();
  await db.schema.createIndex('idx_student_guardians_guardian').on('student_guardians').column('guardian_id').execute();

  await db.schema.alterTable('class_sections').addColumn('class_teacher_id', 'integer', (c) => c.unsigned()).execute();
  await db.schema
    .alterTable('class_sections')
    .addForeignKeyConstraint('fk_class_sections_class_teacher', ['class_teacher_id'], 'staff_profiles', ['id'], (b) => b.onDelete('set null'))
    .execute();

  await db.schema
    .createTable('teacher_assignments')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('staff_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('class_section_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('subject_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addUniqueConstraint('uq_teacher_assignment', ['class_section_id', 'subject_id', 'staff_id'])
    .addForeignKeyConstraint('fk_ta_staff', ['staff_id'], 'staff_profiles', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_ta_section', ['class_section_id'], 'class_sections', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_ta_subject', ['subject_id'], 'subjects', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_ta_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .execute();
  await db.schema.createIndex('idx_ta_staff').on('teacher_assignments').column('staff_id').execute();
  await db.schema.createIndex('idx_ta_subject').on('teacher_assignments').column('subject_id').execute();

  await db.schema
    .createTable('import_jobs')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('kind', 'varchar(16)', (c) => c.notNull())
    .addColumn('status', 'varchar(16)', (c) => c.notNull())
    .addColumn('file_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('file_sha256', 'char(64)', (c) => c.notNull())
    .addColumn('total_rows', 'integer', (c) => c.notNull().unsigned().defaultTo(0))
    .addColumn('created_rows', 'integer', (c) => c.notNull().unsigned().defaultTo(0))
    .addColumn('updated_rows', 'integer', (c) => c.notNull().unsigned().defaultTo(0))
    .addColumn('unchanged_rows', 'integer', (c) => c.notNull().unsigned().defaultTo(0))
    .addColumn('error_rows', 'integer', (c) => c.notNull().unsigned().defaultTo(0))
    .addColumn('errors', 'text')
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('applied_at', 'timestamp')
    .addForeignKeyConstraint('fk_import_jobs_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_import_kind', sql`kind IN ('students', 'staff', 'guardians')`)
    .addCheckConstraint('chk_import_status', sql`status IN ('previewed', 'applied')`)
    .execute();
  await db.schema.createIndex('idx_import_jobs_file').on('import_jobs').columns(['kind', 'file_sha256']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only.
  await db.schema.dropTable('import_jobs').ifExists().execute();
  await db.schema.dropTable('teacher_assignments').ifExists().execute();
  await db.schema.alterTable('class_sections').dropConstraint('fk_class_sections_class_teacher').execute();
  await db.schema.alterTable('class_sections').dropColumn('class_teacher_id').execute();
  for (const t of ['student_guardians', 'guardian_profiles', 'enrollments', 'student_status_events', 'student_profiles', 'staff_profiles']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
