import { sql, type Kysely } from 'kysely';

/**
 * Academic structure: grades, subjects (with optional si/ta names), the grade→subject
 * curriculum map, rooms, class sections per academic year, the bell schedule and the
 * school calendar. All school-configurable; nothing is seeded.
 * Deletes are restricted while referenced; retire grades/subjects/rooms with is_active.
 * Foreign keys are table-level constraints: MySQL ignores inline column REFERENCES (see 0003).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`CURRENT_TIMESTAMP`;
  await db.schema
    .createTable('grades')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('name', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('level', 'smallint', (c) => c.notNull().unsigned().unique())
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable('subjects')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('code', 'varchar(32)', (c) => c.notNull().unique())
    .addColumn('name', 'varchar(128)', (c) => c.notNull())
    .addColumn('name_si', 'varchar(128)')
    .addColumn('name_ta', 'varchar(128)')
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable('grade_subjects')
    .addColumn('grade_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('subject_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('is_optional', 'boolean', (c) => c.notNull().defaultTo(false))
    .addPrimaryKeyConstraint('pk_grade_subjects', ['grade_id', 'subject_id'])
    .addForeignKeyConstraint('fk_grade_subjects_grade', ['grade_id'], 'grades', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_grade_subjects_subject', ['subject_id'], 'subjects', ['id'], (fk) => fk.onDelete('restrict'))
    .execute();
  await db.schema.createIndex('idx_grade_subjects_subject').on('grade_subjects').column('subject_id').execute();

  await db.schema
    .createTable('rooms')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('name', 'varchar(64)', (c) => c.notNull().unique())
    .addColumn('capacity', 'smallint', (c) => c.unsigned())
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable('class_sections')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('academic_year_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('grade_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('name', 'varchar(32)', (c) => c.notNull())
    .addColumn('medium', 'varchar(8)')
    .addColumn('capacity', 'smallint', (c) => c.unsigned())
    .addColumn('home_room_id', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .addUniqueConstraint('uq_class_sections_year_grade_name', ['academic_year_id', 'grade_id', 'name'])
    .addForeignKeyConstraint('fk_class_sections_year', ['academic_year_id'], 'academic_years', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_class_sections_grade', ['grade_id'], 'grades', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_class_sections_home_room', ['home_room_id'], 'rooms', ['id'], (fk) => fk.onDelete('set null'))
    .execute();
  await db.schema.createIndex('idx_class_sections_grade').on('class_sections').column('grade_id').execute();

  await db.schema
    .createTable('period_definitions')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('label', 'varchar(32)', (c) => c.notNull())
    .addColumn('sequence', 'smallint', (c) => c.notNull().unsigned().unique())
    .addColumn('starts_at', 'time', (c) => c.notNull())
    .addColumn('ends_at', 'time', (c) => c.notNull())
    .addColumn('is_break', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .addCheckConstraint('chk_period_times', sql`ends_at > starts_at`)
    .execute();

  await db.schema
    .createTable('calendar_events')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('academic_year_id', 'integer', (c) => c.unsigned())
    .addColumn('title', 'varchar(191)', (c) => c.notNull())
    .addColumn('kind', 'varchar(16)', (c) => c.notNull())
    .addColumn('starts_on', 'date', (c) => c.notNull())
    .addColumn('ends_on', 'date', (c) => c.notNull())
    .addColumn('is_school_day', 'boolean', (c) => c.notNull())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .addCheckConstraint('chk_calendar_dates', sql`ends_on >= starts_on`)
    .addForeignKeyConstraint('fk_calendar_events_year', ['academic_year_id'], 'academic_years', ['id'], (fk) => fk.onDelete('restrict'))
    .execute();
  await db.schema.createIndex('idx_calendar_events_dates').on('calendar_events').columns(['starts_on', 'ends_on']).execute();
  await db.schema.createIndex('idx_calendar_events_year').on('calendar_events').column('academic_year_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only. Production recovery uses backups, not down-migrations.
  for (const t of ['calendar_events', 'period_definitions', 'class_sections', 'rooms', 'grade_subjects', 'subjects', 'grades']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
