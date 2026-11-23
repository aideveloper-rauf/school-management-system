# ADR-0003: Kysely + mysql2 for data access and migrations

**Status:** Accepted · 2026-11-23

**Context.** We need typed queries, explicit transactions, migrations, small runtime footprint and no code generation step or native binaries (cPanel).

**Decision.** Kysely query builder with the `mysql2` driver. TypeScript migrations registered in a static provider. Minimum database: MySQL 8.0 or MariaDB 10.6.

**Alternatives.** Prisma (engine binaries, heavier on shared hosting), Drizzle (viable; Kysely chosen for its mature MySQL migrator and plain-SQL feel), raw SQL (no types).

**Consequences.** Table types in `db/types.ts` are hand-maintained and must match migrations; add an integration test that compares them once MySQL CI exists.
