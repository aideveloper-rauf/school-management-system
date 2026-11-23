# Sri Lanka School Management System

A lightweight, secure, multilingual (English / සිංහල / தமிழ்) school management system.
Each school runs its **own installation** — its own database, files, and credentials.

> **Status:** Architecture foundation (v0.1.0). Authentication, roles, audit, academic years,
> job queue and the web shell are in place. Feature modules follow [`docs/backlog.md`](docs/backlog.md).

## Repository layout

```
apps/
  api/        Node.js + TypeScript + Fastify API (modular monolith), MySQL via Kysely
  web/        React + TypeScript + Vite + Tailwind static web app
packages/
  shared/     API contracts shared by api and web: roles/permissions, error shape, schemas, locales
docs/
  architecture.md, deployment.md, backlog.md, adr/, school-management-blueprint.md
Context.md, instruction.md, CLAUDE.md
```

## Local development (Windows + WAMP)

Requirements: Node.js 22 LTS (or 24 LTS), MySQL 8.0+ or MariaDB 10.6+ (WAMP's MySQL is fine).

1. Create a database and user in phpMyAdmin (utf8mb4), e.g. `school_sms`.
2. Copy `apps/api/.env.example` → `apps/api/.env` and fill in the DB values.
3. From the repo root:

   ```bash
   npm install
   npm run db:migrate
   npm run setup:admin -- --school "Your School" --email admin@example.lk --name "Admin"
   npm run dev:api      # terminal 1
   npm run dev:web      # terminal 2 → open http://localhost:5173
   ```

## Checks

```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run test:integration   # needs a MySQL/MariaDB database named <DB_NAME>_test (or TEST_DB_NAME) — its tables are dropped
```

See [`docs/deployment.md`](docs/deployment.md) for cPanel deployment and [`docs/architecture.md`](docs/architecture.md) for how to add a module.
