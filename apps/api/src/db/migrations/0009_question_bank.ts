import { sql, type Kysely } from 'kysely';

/**
 * Question bank and exam papers (roadmap L-4, L-5).
 *
 * - questions: stable identity (subject, optional grade, language, outcome, difficulty).
 * - question_versions: every edit is a new version; review approves a specific version. Marks are DECIMAL.
 *   `options` holds MCQ choices as JSON text; `answer` is the model answer / marking scheme (answer key).
 * - exam_papers / exam_paper_versions / exam_paper_items: a paper version lists the exact question versions it
 *   uses, so editing a question never changes a paper already set. A `final` paper version is immutable;
 *   changing it starts a new draft version.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`CURRENT_TIMESTAMP`;

  await db.schema
    .createTable('questions')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('subject_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('grade_id', 'integer', (c) => c.unsigned())
    .addColumn('language', 'varchar(8)', (c) => c.notNull())
    .addColumn('outcome', 'varchar(191)')
    .addColumn('difficulty', 'varchar(8)', (c) => c.notNull())
    .addColumn('is_retired', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addForeignKeyConstraint('fk_q_subject', ['subject_id'], 'subjects', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_q_grade', ['grade_id'], 'grades', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_q_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_q_difficulty', sql`difficulty IN ('easy', 'medium', 'hard')`)
    .execute();
  await db.schema.createIndex('idx_q_subject_grade').on('questions').columns(['subject_id', 'grade_id']).execute();
  await db.schema.createIndex('idx_q_grade').on('questions').column('grade_id').execute();

  await db.schema
    .createTable('question_versions')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('question_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('version', 'smallint', (c) => c.notNull().unsigned())
    .addColumn('kind', 'varchar(8)', (c) => c.notNull())
    .addColumn('stem', 'text', (c) => c.notNull())
    .addColumn('options', 'text')
    .addColumn('answer', 'text')
    .addColumn('marks', 'decimal(5, 2)', (c) => c.notNull())
    .addColumn('licence', 'varchar(64)')
    .addColumn('source', 'varchar(191)')
    .addColumn('review_status', 'varchar(16)', (c) => c.notNull().defaultTo('draft'))
    .addColumn('reviewed_by', 'integer', (c) => c.unsigned())
    .addColumn('reviewed_at', 'timestamp')
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addUniqueConstraint('uq_question_version', ['question_id', 'version'])
    .addForeignKeyConstraint('fk_qv_question', ['question_id'], 'questions', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_qv_reviewed_by', ['reviewed_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addForeignKeyConstraint('fk_qv_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_qv_kind', sql`kind IN ('mcq', 'short', 'essay')`)
    .addCheckConstraint('chk_qv_review', sql`review_status IN ('draft', 'in_review', 'approved', 'rejected')`)
    .addCheckConstraint('chk_qv_marks', sql`marks > 0`)
    .execute();

  await db.schema
    .createTable('exam_papers')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('title', 'varchar(191)', (c) => c.notNull())
    .addColumn('subject_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('grade_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addForeignKeyConstraint('fk_paper_subject', ['subject_id'], 'subjects', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_paper_grade', ['grade_id'], 'grades', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_paper_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .execute();
  await db.schema.createIndex('idx_paper_subject').on('exam_papers').columns(['subject_id', 'grade_id']).execute();
  await db.schema.createIndex('idx_paper_grade').on('exam_papers').column('grade_id').execute();

  await db.schema
    .createTable('exam_paper_versions')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('paper_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('version', 'smallint', (c) => c.notNull().unsigned())
    .addColumn('instructions', 'text')
    .addColumn('duration_minutes', 'smallint', (c) => c.unsigned())
    .addColumn('status', 'varchar(8)', (c) => c.notNull().defaultTo('draft'))
    .addColumn('finalized_by', 'integer', (c) => c.unsigned())
    .addColumn('finalized_at', 'timestamp')
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addUniqueConstraint('uq_paper_version', ['paper_id', 'version'])
    .addForeignKeyConstraint('fk_pv_paper', ['paper_id'], 'exam_papers', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_pv_finalized_by', ['finalized_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addForeignKeyConstraint('fk_pv_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_pv_status', sql`status IN ('draft', 'final')`)
    .execute();

  await db.schema
    .createTable('exam_paper_items')
    .addColumn('paper_version_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('position', 'smallint', (c) => c.notNull().unsigned())
    .addColumn('question_version_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('marks', 'decimal(5, 2)', (c) => c.notNull())
    .addPrimaryKeyConstraint('pk_exam_paper_items', ['paper_version_id', 'position'])
    .addUniqueConstraint('uq_paper_item_question', ['paper_version_id', 'question_version_id'])
    .addForeignKeyConstraint('fk_pi_version', ['paper_version_id'], 'exam_paper_versions', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_pi_question_version', ['question_version_id'], 'question_versions', ['id'], (fk) => fk.onDelete('restrict'))
    .addCheckConstraint('chk_pi_marks', sql`marks > 0`)
    .execute();
  await db.schema.createIndex('idx_pi_question_version').on('exam_paper_items').column('question_version_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only.
  for (const t of ['exam_paper_items', 'exam_paper_versions', 'exam_papers', 'question_versions', 'questions']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
