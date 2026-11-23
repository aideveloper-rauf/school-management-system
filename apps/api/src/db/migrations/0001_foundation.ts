import { sql, type Kysely } from 'kysely';

/**
 * Foundation schema: installation school, identity, sessions, audit,
 * academic calendar, DB-backed job queue and app metadata.
 * Follow expand-and-contract for later changes; never edit a released migration.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  const now = sql`CURRENT_TIMESTAMP`;

  await db.schema
    .createTable('schools')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('name', 'varchar(191)', (c) => c.notNull())
    .addColumn('short_name', 'varchar(64)')
    .addColumn('default_locale', 'varchar(8)', (c) => c.notNull().defaultTo('en'))
    .addColumn('timezone', 'varchar(64)', (c) => c.notNull().defaultTo('Asia/Colombo'))
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('identifier', 'varchar(191)', (c) => c.notNull().unique())
    .addColumn('display_name', 'varchar(191)', (c) => c.notNull())
    .addColumn('password_hash', 'varchar(255)', (c) => c.notNull())
    .addColumn('locale', 'varchar(8)', (c) => c.notNull().defaultTo('en'))
    .addColumn('status', sql`enum('active','disabled','invited')`, (c) => c.notNull().defaultTo('active'))
    .addColumn('password_changed_at', 'timestamp')
    .addColumn('last_login_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable('user_roles')
    .addColumn('user_id', 'integer', (c) => c.notNull().unsigned().references('users.id').onDelete('cascade'))
    .addColumn('role', 'varchar(64)', (c) => c.notNull())
    .addColumn('granted_by', 'integer', (c) => c.unsigned().references('users.id').onDelete('set null'))
    .addColumn('granted_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addPrimaryKeyConstraint('pk_user_roles', ['user_id', 'role'])
    .execute();

  await db.schema
    .createTable('sessions')
    .addColumn('id_hash', 'char(64)', (c) => c.primaryKey())
    .addColumn('user_id', 'integer', (c) => c.notNull().unsigned().references('users.id').onDelete('cascade'))
    .addColumn('csrf_token', 'char(64)', (c) => c.notNull())
    .addColumn('expires_at', 'timestamp', (c) => c.notNull())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('last_seen_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('user_agent', 'varchar(255)')
    .execute();
  await db.schema.createIndex('idx_sessions_user').on('sessions').column('user_id').execute();
  await db.schema.createIndex('idx_sessions_expires').on('sessions').column('expires_at').execute();

  await db.schema
    .createTable('login_attempts')
    .addColumn('id', 'bigint', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('identifier', 'varchar(191)', (c) => c.notNull())
    .addColumn('ip', 'varchar(45)', (c) => c.notNull())
    .addColumn('succeeded', 'boolean', (c) => c.notNull())
    .addColumn('attempted_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .execute();
  await db.schema.createIndex('idx_login_attempts_ident_time').on('login_attempts').columns(['identifier', 'attempted_at']).execute();
  await db.schema.createIndex('idx_login_attempts_ip_time').on('login_attempts').columns(['ip', 'attempted_at']).execute();

  await db.schema
    .createTable('audit_events')
    .addColumn('id', 'bigint', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('actor_user_id', 'integer', (c) => c.unsigned().references('users.id').onDelete('set null'))
    .addColumn('action', 'varchar(100)', (c) => c.notNull())
    .addColumn('entity_type', 'varchar(64)')
    .addColumn('entity_id', 'varchar(64)')
    .addColumn('metadata', 'json')
    .addColumn('ip', 'varchar(45)')
    .addColumn('request_id', 'varchar(64)')
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .execute();
  await db.schema.createIndex('idx_audit_entity').on('audit_events').columns(['entity_type', 'entity_id']).execute();
  await db.schema.createIndex('idx_audit_actor_time').on('audit_events').columns(['actor_user_id', 'created_at']).execute();
  await db.schema.createIndex('idx_audit_action_time').on('audit_events').columns(['action', 'created_at']).execute();

  await db.schema
    .createTable('academic_years')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('label', 'varchar(32)', (c) => c.notNull().unique())
    .addColumn('starts_on', 'date', (c) => c.notNull())
    .addColumn('ends_on', 'date', (c) => c.notNull())
    .addColumn('is_current', 'boolean', (c) => c.notNull().defaultTo(false))
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .addCheckConstraint('chk_academic_years_dates', sql`ends_on > starts_on`)
    .execute();

  await db.schema
    .createTable('terms')
    .addColumn('id', 'integer', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('academic_year_id', 'integer', (c) => c.notNull().unsigned().references('academic_years.id').onDelete('restrict'))
    .addColumn('label', 'varchar(64)', (c) => c.notNull())
    .addColumn('sequence', 'smallint', (c) => c.notNull().unsigned())
    .addColumn('starts_on', 'date', (c) => c.notNull())
    .addColumn('ends_on', 'date', (c) => c.notNull())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .addUniqueConstraint('uq_terms_year_seq', ['academic_year_id', 'sequence'])
    .addCheckConstraint('chk_terms_dates', sql`ends_on > starts_on`)
    .execute();

  await db.schema
    .createTable('jobs')
    .addColumn('id', 'bigint', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('type', 'varchar(64)', (c) => c.notNull())
    .addColumn('payload', 'json', (c) => c.notNull())
    .addColumn('status', sql`enum('pending','running','done','failed')`, (c) => c.notNull().defaultTo('pending'))
    .addColumn('attempts', 'smallint', (c) => c.notNull().unsigned().defaultTo(0))
    .addColumn('max_attempts', 'smallint', (c) => c.notNull().unsigned().defaultTo(5))
    .addColumn('run_after', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('locked_at', 'timestamp')
    .addColumn('last_error', 'varchar(1000)')
    .addColumn('idempotency_key', 'varchar(128)', (c) => c.unique())
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(now))
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .execute();
  await db.schema.createIndex('idx_jobs_status_run_after').on('jobs').columns(['status', 'run_after']).execute();

  await db.schema
    .createTable('app_meta')
    .addColumn('meta_key', 'varchar(64)', (c) => c.primaryKey())
    .addColumn('meta_value', 'varchar(255)', (c) => c.notNull())
    .addColumn('updated_at', 'timestamp', (c) => c.notNull().defaultTo(now).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP`))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only. Production recovery uses backups, not down-migrations.
  for (const t of ['app_meta', 'jobs', 'terms', 'academic_years', 'audit_events', 'login_attempts', 'sessions', 'user_roles', 'users', 'schools']) {
    await db.schema.dropTable(t).ifExists().execute();
  }
}
