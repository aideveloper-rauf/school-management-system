import { sql, type Kysely } from 'kysely';

/**
 * Timetable (roadmap C-11) and announcements (C-12).
 *
 * timetable_entries: one lesson slot = class section × weekday × period, with subject, optional teacher
 * and room. Collisions are enforced by unique keys so races cannot double-book:
 *   class:   (class_section_id, day_of_week, period_id)
 *   teacher: (academic_year_id, staff_id, day_of_week, period_id)   — NULL staff never collides
 *   room:    (academic_year_id, room_id, day_of_week, period_id)    — NULL room never collides
 * academic_year_id is copied from the class section so teacher/room keys work across classes of a year.
 *
 * announcements: targeted at the whole school, a role, a grade, a class, or the guardians of a class.
 * published_at NULL = draft; withdrawn_at hides it again. announcement_reads = optional read receipts.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`CURRENT_TIMESTAMP`;
  const onUpdate = sql`ON UPDATE CURRENT_TIMESTAMP`;

  await db.schema
    .createTable('timetable_entries')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('academic_year_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('class_section_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('day_of_week', 'smallint', (c) => c.notNull().unsigned())
    .addColumn('period_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('subject_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('staff_id', 'integer', (c) => c.unsigned())
    .addColumn('room_id', 'integer', (c) => c.unsigned())
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(onUpdate))
    .addUniqueConstraint('uq_tt_class_slot', ['class_section_id', 'day_of_week', 'period_id'])
    .addUniqueConstraint('uq_tt_teacher_slot', ['academic_year_id', 'staff_id', 'day_of_week', 'period_id'])
    .addUniqueConstraint('uq_tt_room_slot', ['academic_year_id', 'room_id', 'day_of_week', 'period_id'])
    .addForeignKeyConstraint('fk_tt_year', ['academic_year_id'], 'academic_years', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_tt_section', ['class_section_id'], 'class_sections', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_tt_period', ['period_id'], 'period_definitions', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_tt_subject', ['subject_id'], 'subjects', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_tt_staff', ['staff_id'], 'staff_profiles', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_tt_room', ['room_id'], 'rooms', ['id'], (fk) => fk.onDelete('set null'))
    .addForeignKeyConstraint('fk_tt_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_tt_day', sql`day_of_week BETWEEN 1 AND 7`)
    .execute();
  await db.schema.createIndex('idx_tt_staff').on('timetable_entries').column('staff_id').execute();
  await db.schema.createIndex('idx_tt_room').on('timetable_entries').column('room_id').execute();

  await db.schema
    .createTable('announcements')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('title', 'varchar(191)', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('audience', 'varchar(24)', (c) => c.notNull())
    .addColumn('audience_role', 'varchar(32)')
    .addColumn('audience_grade_id', 'integer', (c) => c.unsigned())
    .addColumn('audience_class_section_id', 'integer', (c) => c.unsigned())
    .addColumn('published_at', 'timestamp')
    .addColumn('expires_on', 'date')
    .addColumn('withdrawn_at', 'timestamp')
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(onUpdate))
    .addForeignKeyConstraint('fk_ann_grade', ['audience_grade_id'], 'grades', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_ann_section', ['audience_class_section_id'], 'class_sections', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_ann_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_ann_audience', sql`audience IN ('school', 'role', 'grade', 'class', 'guardians_of_class')`)
    .execute();
  await db.schema.createIndex('idx_ann_published').on('announcements').column('published_at').execute();

  await db.schema
    .createTable('announcement_reads')
    .addColumn('announcement_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('user_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('read_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addPrimaryKeyConstraint('pk_announcement_reads', ['announcement_id', 'user_id'])
    .addForeignKeyConstraint('fk_ann_read_announcement', ['announcement_id'], 'announcements', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_ann_read_user', ['user_id'], 'users', ['id'], (fk) => fk.onDelete('cascade'))
    .execute();
  await db.schema.createIndex('idx_ann_read_user').on('announcement_reads').column('user_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only.
  for (const t of ['announcement_reads', 'announcements', 'timetable_entries']) await db.schema.dropTable(t).ifExists().execute();
}
