import { sql, type Kysely } from 'kysely';

/**
 * Certificates (roadmap K-1…K-3).
 *
 * - certificate_templates: per language; body text with {{placeholders}}.
 * - certificates: the issued document. Title and body are rendered and FROZEN at issue time (later template edits
 *   never change an issued certificate). `serial` is unique and unguessable (random part) and is what the public
 *   verification page looks up. Revocation keeps the row and records who, when and why.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`CURRENT_TIMESTAMP`;
  await db.schema
    .createTable('certificate_templates')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('name', 'varchar(128)', (c) => c.notNull())
    .addColumn('locale', 'varchar(8)', (c) => c.notNull())
    .addColumn('title', 'varchar(191)', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('is_active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .addUniqueConstraint('uq_cert_template_name', ['name', 'locale'])
    .addForeignKeyConstraint('fk_ct_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .execute();

  await db.schema
    .createTable('certificates')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('serial', 'varchar(40)', (c) => c.notNull().unique())
    .addColumn('template_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('student_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('locale', 'varchar(8)', (c) => c.notNull())
    .addColumn('issued_on', 'date', (c) => c.notNull())
    .addColumn('title', 'varchar(191)', (c) => c.notNull())
    .addColumn('body', 'text', (c) => c.notNull())
    .addColumn('status', 'varchar(8)', (c) => c.notNull().defaultTo('issued'))
    .addColumn('issued_by', 'integer', (c) => c.unsigned())
    .addColumn('issued_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('revoked_by', 'integer', (c) => c.unsigned())
    .addColumn('revoked_at', 'timestamp')
    .addColumn('revoke_reason', 'varchar(500)')
    .addForeignKeyConstraint('fk_cert_template', ['template_id'], 'certificate_templates', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_cert_student', ['student_id'], 'student_profiles', ['id'], (fk) => fk.onDelete('restrict'))
    .addForeignKeyConstraint('fk_cert_issued_by', ['issued_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addForeignKeyConstraint('fk_cert_revoked_by', ['revoked_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_cert_status', sql`status IN ('issued', 'revoked')`)
    .execute();
  await db.schema.createIndex('idx_cert_student').on('certificates').column('student_id').execute();
  await db.schema.createIndex('idx_cert_template').on('certificates').column('template_id').execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only.
  await db.schema.dropTable('certificates').ifExists().execute();
  await db.schema.dropTable('certificate_templates').ifExists().execute();
}
