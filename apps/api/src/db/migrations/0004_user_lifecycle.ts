import { sql, type Kysely } from 'kysely';

/**
 * User lifecycle: single-use tokens for invitations and password resets, and a flag that
 * forces a password change after an administrator sets a temporary password.
 *
 * Tokens are stored as SHA-256 hashes only. A row is created when a link is requested
 * (token_hash NULL = "pending"); the email job mints the random token, stores its hash
 * and sends the link, so the raw token never sits in the database or the jobs table.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('users')
    .addColumn('must_change_password', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();

  await db.schema
    .createTable('user_tokens')
    .addColumn('id', 'bigint', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('user_id', 'integer', (c) => c.notNull().unsigned())
    .addColumn('purpose', 'varchar(16)', (c) => c.notNull())
    .addColumn('token_hash', 'char(64)', (c) => c.unique())
    .addColumn('expires_at', 'timestamp', (c) => c.notNull())
    .addColumn('used_at', 'timestamp')
    .addColumn('created_by', 'integer', (c) => c.unsigned())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addForeignKeyConstraint('fk_user_tokens_user', ['user_id'], 'users', ['id'], (fk) => fk.onDelete('cascade'))
    .addForeignKeyConstraint('fk_user_tokens_created_by', ['created_by'], 'users', ['id'], (fk) => fk.onDelete('set null'))
    .addCheckConstraint('chk_user_tokens_purpose', sql`purpose IN ('invite', 'reset')`)
    .execute();
  await db.schema.createIndex('idx_user_tokens_user_purpose').on('user_tokens').columns(['user_id', 'purpose']).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only.
  await db.schema.dropTable('user_tokens').ifExists().execute();
  await db.schema.alterTable('users').dropColumn('must_change_password').execute();
}
