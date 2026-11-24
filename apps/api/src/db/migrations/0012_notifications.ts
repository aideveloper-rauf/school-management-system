import { sql, type Kysely } from 'kysely';

/**
 * Notification delivery log (roadmap N-1). One row per attempted email/SMS to one recipient.
 * The address is stored masked (e.g. "c****@example.lk", "+9477*****67") — enough for support to recognise it,
 * not a copy of the contact list. Message text is never stored.
 * `recipient_ref` / `entity_ref` are references to rows in different tables (by `recipient_kind` / `entity_type`),
 * so they are deliberately not foreign keys.
 * Announcements gain an opt-in flag to notify guardians when published.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('notification_deliveries')
    .addColumn('id', 'bigint', (c) => c.primaryKey().autoIncrement().unsigned())
    .addColumn('channel', 'varchar(8)', (c) => c.notNull())
    .addColumn('purpose', 'varchar(32)', (c) => c.notNull())
    .addColumn('recipient_kind', 'varchar(16)', (c) => c.notNull())
    .addColumn('recipient_ref', 'integer', (c) => c.unsigned())
    .addColumn('to_masked', 'varchar(64)', (c) => c.notNull())
    .addColumn('status', 'varchar(8)', (c) => c.notNull())
    .addColumn('error', 'varchar(255)')
    .addColumn('entity_type', 'varchar(32)')
    .addColumn('entity_ref', 'varchar(64)')
    .addColumn('created_at', 'timestamp', (c) => c.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .addCheckConstraint('chk_nd_channel', sql`channel IN ('email', 'sms')`)
    .addCheckConstraint('chk_nd_status', sql`status IN ('sent', 'failed', 'skipped')`)
    .execute();
  await db.schema.createIndex('idx_nd_created').on('notification_deliveries').column('created_at').execute();
  await db.schema.createIndex('idx_nd_entity').on('notification_deliveries').columns(['entity_type', 'entity_ref']).execute();

  await db.schema
    .alterTable('announcements')
    .addColumn('notify_guardians', 'boolean', (c) => c.notNull().defaultTo(false))
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only.
  await db.schema.alterTable('announcements').dropColumn('notify_guardians').execute();
  await db.schema.dropTable('notification_deliveries').ifExists().execute();
}
