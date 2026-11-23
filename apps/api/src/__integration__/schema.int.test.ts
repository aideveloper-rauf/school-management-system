import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import ts from 'typescript';
import type { AppConfig } from '../config/env.js';
import type { Db } from '../db/client.js';
import { createMigrator } from '../db/migrator.js';
import { freshDb } from './test-db.js';

let db: Db;
let cfg: AppConfig;

beforeAll(async () => {
  ({ db, cfg } = await freshDb());
});
afterAll(async () => db?.destroy());

/** Parse db/types.ts: table name → column name → nullable? (from `| null` in the declared type). */
function declaredSchema(): Map<string, Map<string, boolean>> {
  const file = ts.createSourceFile('types.ts', readFileSync('src/db/types.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  file.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n)) interfaces.set(n.name.text, n);
  });

  const isNullable = (t: ts.TypeNode | undefined): boolean =>
    !!t && ts.isUnionTypeNode(t) && t.types.some((m) => ts.isLiteralTypeNode(m) && m.literal.kind === ts.SyntaxKind.NullKeyword);

  const out = new Map<string, Map<string, boolean>>();
  for (const member of interfaces.get('Database')!.members) {
    if (!ts.isPropertySignature(member) || !member.type || !ts.isTypeReferenceNode(member.type)) continue;
    const table = (member.name as ts.Identifier).text;
    const iface = interfaces.get(member.type.typeName.getText(file));
    if (!iface) throw new Error(`No interface for table ${table}`);
    const cols = new Map<string, boolean>();
    for (const c of iface.members) if (ts.isPropertySignature(c)) cols.set((c.name as ts.Identifier).text, isNullable(c.type));
    out.set(table, cols);
  }
  return out;
}

describe('migrations on an empty database', () => {
  it('records every registered migration as applied', async () => {
    const migrations = await createMigrator(db).getMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.filter((m) => !m.executedAt)).toEqual([]);
  });

  it('is a no-op when run again', async () => {
    const { error, results } = await createMigrator(db).migrateToLatest();
    expect(error).toBeUndefined();
    expect(results).toEqual([]);
  });

  it('creates InnoDB utf8mb4 tables even when the server default engine differs', async () => {
    const rows = await sql<{ t: string; engine: string; collation: string }>`
      SELECT table_name AS t, engine AS engine, table_collation AS collation
      FROM information_schema.tables WHERE table_schema = ${cfg.DB_NAME}`.execute(db);
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const r of rows.rows) {
      expect(r.engine, r.t).toBe('InnoDB');
      expect(r.collation, r.t).toMatch(/^utf8mb4_/);
    }
  });

  it('matches the hand-written table types in db/types.ts (columns and nullability)', async () => {
    const declared = declaredSchema();
    const rows = await sql<{ t: string; c: string; nullable: 'YES' | 'NO' }>`
      SELECT table_name AS t, column_name AS c, is_nullable AS nullable
      FROM information_schema.columns WHERE table_schema = ${cfg.DB_NAME}`.execute(db);

    const actual = new Map<string, Map<string, boolean>>();
    for (const r of rows.rows) {
      if (r.t.startsWith('schema_migrations')) continue; // Kysely's own tables
      if (!actual.has(r.t)) actual.set(r.t, new Map());
      actual.get(r.t)!.set(r.c, r.nullable === 'YES');
    }

    const asObject = (m: Map<string, Map<string, boolean>>) =>
      Object.fromEntries(
        [...m]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([t, cols]) => [t, Object.fromEntries([...cols].sort(([a], [b]) => a.localeCompare(b)))]),
      );
    expect(asObject(declared)).toEqual(asObject(actual));
  });

  it('applies UTC and strict sql_mode to every connection', async () => {
    const r = await sql<{ tz: string; mode: string }>`SELECT @@session.time_zone AS tz, @@session.sql_mode AS mode`.execute(db);
    expect(r.rows[0]!.tz).toBe('+00:00');
    expect(r.rows[0]!.mode).toContain('STRICT_ALL_TABLES');
  });
});
