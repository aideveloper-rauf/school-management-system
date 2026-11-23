import { sql, type Kysely } from 'kysely';

/**
 * Add the foreign keys that 0001 declared inline (`.references()` on a column).
 * MySQL parses but IGNORES inline column REFERENCES, so on MySQL none of them existed;
 * MariaDB honours them, so there they already exist. Each key is added only if the column
 * has no foreign key yet, which makes this safe on both servers.
 *
 * Fails if orphaned rows exist (e.g. sessions of a deleted user); clean those up and re-run.
 * Rule for all future migrations: declare foreign keys with addForeignKeyConstraint.
 */
const FOREIGN_KEYS = [
  { table: 'user_roles', column: 'user_id', refTable: 'users', onDelete: 'cascade', name: 'fk_user_roles_user' },
  { table: 'user_roles', column: 'granted_by', refTable: 'users', onDelete: 'set null', name: 'fk_user_roles_granted_by' },
  { table: 'sessions', column: 'user_id', refTable: 'users', onDelete: 'cascade', name: 'fk_sessions_user' },
  { table: 'audit_events', column: 'actor_user_id', refTable: 'users', onDelete: 'set null', name: 'fk_audit_events_actor' },
  { table: 'terms', column: 'academic_year_id', refTable: 'academic_years', onDelete: 'restrict', name: 'fk_terms_year' },
] as const;

async function hasForeignKey(db: Kysely<unknown>, table: string, column: string): Promise<boolean> {
  const r = await sql<{ n: number }>`
    SELECT COUNT(*) AS n FROM information_schema.key_column_usage
    WHERE table_schema = DATABASE() AND table_name = ${table} AND column_name = ${column}
      AND referenced_table_name IS NOT NULL`.execute(db);
  return Number(r.rows[0]?.n ?? 0) > 0;
}

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const fk of FOREIGN_KEYS) {
    if (await hasForeignKey(db, fk.table, fk.column)) continue;
    await db.schema
      .alterTable(fk.table)
      .addForeignKeyConstraint(fk.name, [fk.column], fk.refTable, ['id'], (b) => b.onDelete(fk.onDelete))
      .execute();
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only. Drops only the constraints this migration named.
  for (const fk of FOREIGN_KEYS) {
    const r = await sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM information_schema.table_constraints
      WHERE table_schema = DATABASE() AND table_name = ${fk.table} AND constraint_name = ${fk.name}`.execute(db);
    if (Number(r.rows[0]?.n ?? 0) > 0) await db.schema.alterTable(fk.table).dropConstraint(fk.name).execute();
  }
}
