import { sql, type Kysely } from 'kysely';

/**
 * Learning (roadmap L-1…L-3): private file storage, class materials/assignments, student submissions.
 *
 * - stored_files: metadata for files kept under STORAGE_DIR/files (outside the web root). The type is
 *   decided by sniffing the content, not trusted from the browser. A file is readable only through the
 *   authorized download route, via whatever it is attached to (or by its uploader while unattached).
 * - learning_items: a resource (notes, worksheet) or an assignment (with due date) for one class and subject.
 *   published_at NULL = draft, visible to staff only.
 * - submissions: one per student per assignment; resubmission replaces it until the teacher returns it.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`CURRENT_TIMESTAMP`;
  const onUpdate = sql`ON UPDATE CURRENT_TIMESTAMP`;

  await db.schema
    .createTable('stored_files')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('storage_key', 'varchar(128)', (c) => c.notNull().unique())
    .addColumn('sha256', 'char(64)', (c) => c.notNull())
    .addColumn('original_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('mime_type', 'varchar(100)', (c) => c.notNull())
    .addColumn('size_bytes', 'integer', (c) => c.notNull().unsigned())
    .addColumn('uploaded_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addForeignKeyConstraint('fk_files_uploaded_by', ['uploaded_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .execute();

  await db.schema
    .createTable('learning_items')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('kind', 'varchar(16)', (c) => c.notNull())
    .addColumn('class_section_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('subject_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('title', 'varchar(191)', (c) => c.notNull())
    .addColumn('instructions', 'text')
    .addColumn('due_at', 'timestamp')
    .addColumn('allow_late', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('max_score', 'decimal(6, 2)')
    .addColumn('published_at', 'timestamp')
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(onUpdate))
    .addForeignKeyConstraint('fk_li_section', ['class_section_id'], 'class_sections', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_li_subject', ['subject_id'], 'subjects', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_li_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_li_kind', sql`kind IN ('resource', 'assignment')`)
    .execute();
  await db.schema.createIndex('idx_li_section_subject').on('learning_items').columns(['class_section_id', 'subject_id']).execute();
  await db.schema.createIndex('idx_li_subject').on('learning_items').column('subject_id').execute();

  await db.schema
    .createTable('learning_item_files')
    .addColumn('item_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('file_id', 'integer', (c) => c.notNull().unsigned())
    .addPrimaryKeyConstraint('pk_learning_item_files', ['item_id', 'file_id'])
    .addForeignKeyConstraint('fk_lif_item', ['item_id'], 'learning_items', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_lif_file', ['file_id'], 'stored_files', ['id'], (fk) => fk.onDelete('restrict'))
    .execute();
  await db.schema.createIndex('idx_lif_file').on('learning_item_files').column('file_id').execute();

  await db.schema
    .createTable('submissions')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('item_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('student_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('text_answer', 'text')
    .addColumn('submitted_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('is_late', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('status', 'varchar(16)', (c) => c.notNull().defaultTo('submitted'))
    .addColumn('feedback', 'text')
    .addColumn('score', 'decimal(6, 2)')
    .addColumn('returned_by', 'integer', (c) => c.unsigned())
    .addColumn('returned_at', 'timestamp')
    .addUniqueConstraint('uq_submission', ['item_id', 'student_id'])
    .addForeignKeyConstraint('fk_sub_item', ['item_id'], 'learning_items', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_sub_student', ['student_id'], 'student_profiles', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_sub_returned_by', ['returned_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_sub_status', sql`status IN ('submitted', 'returned')`)
    .execute();
  await db.schema.createIndex('idx_sub_student').on('submissions').column('student_id').execute();

  await db.schema
    .createTable('submission_files')
    .addColumn('submission_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('file_id', 'integer', (c) => c.notNull().unsigned())
    .addPrimaryKeyConstraint('pk_submission_files', ['submission_id', 'file_id'])
    .addForeignKeyConstraint('fk_sf_submission', ['submission_id'], 'submissions', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_sf_file', ['file_id'], 'stored_files', ['id'], (fk) => fk.onDelete('restrict'))
    .execute();
  await db.schema.createIndex('idx_sf_file').on('submission_files').column('file_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only.
  for (const t of ['submission_files', 'submissions', 'learning_item_files', 'learning_items', 'stored_files']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
