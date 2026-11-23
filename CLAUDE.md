# CLAUDE.md — guidance for Claude Code in this repository

Read these before changing anything:

1. [`instruction.md`](instruction.md) — binding implementation rules (security, privacy, deployment, definition of done).
2. [`docs/architecture.md`](docs/architecture.md) — how the code is organized and the patterns every module follows.
3. [`docs/school-management-blueprint.md`](docs/school-management-blueprint.md) — product scope and roadmap.
4. [`docs/backlog.md`](docs/backlog.md) — the ordered build backlog. Work the next unchecked item unless told otherwise.
5. [`docs/adr/`](docs/adr) — decisions already made. Add a new ADR rather than silently reversing one.

## Commands

```bash
npm install                 # once, at the repo root (npm workspaces)
npm run dev:api             # API on http://127.0.0.1:4000 (needs apps/api/.env and MySQL)
npm run dev:web             # Web on http://localhost:5173 (proxies /api to the API)
npm run db:migrate          # apply migrations to the configured MySQL database
npm run setup:admin -- --school "Name" --email admin@example.lk --name "Admin"
npm run typecheck           # shared build + api/web typecheck
npm test                    # shared + api unit/HTTP tests (no MySQL needed)
npm run build               # production build of shared, api (dist/) and web (dist/)
```

## Non-negotiables (summary — instruction.md is authoritative)

- Every API route declares authorization (`requireAuth` / `requirePermission`) **and** applies record scope
  (class/subject assignment, guardian–student link). Return `NOT_FOUND` for out-of-scope records.
- Validate every input with zod at the route boundary. Use transactions for multi-step writes.
- Audit sensitive actions with `recordAudit` inside the same transaction. Never put passwords, tokens or free-text personal data in audit metadata or logs.
- Schema changes = a new file in `apps/api/src/db/migrations/` registered in `migrations/index.ts`. Never edit a released migration. Expand-and-contract only.
- No hard-coded user-facing strings: add keys to `apps/web/src/i18n/locales/en.json` (si/ta fall back to English until translated). API error messages are translation keys (`errors.*`).
- Results publication creates versioned snapshots; never overwrite released results.
- AI features stay off (`FEATURE_AI=false`) and must not receive identifying student data.
- Do not claim tests ran unless you ran them. State known limitations.
