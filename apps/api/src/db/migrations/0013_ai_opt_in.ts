import type { Kysely } from 'kysely';

/**
 * School-level opt-in for AI drafting (roadmap Phase 5). Off by default. AI features need BOTH the installation
 * switch (FEATURE_AI=true plus a configured provider) and this school decision.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('schools').addColumn('ai_enabled', 'boolean', (c) => c.notNull().defaultTo(false)).execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Development only.
  await db.schema.alterTable('schools').dropColumn('ai_enabled').execute();
}
