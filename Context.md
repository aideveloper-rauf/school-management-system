# Project Context — Sri Lanka School Management System

**Last updated:** 23 November 2026  
**Project stage:** Architecture foundation (v0.1.0) built; feature work follows `docs/backlog.md`. Implementation details still need validation with a pilot school.

## Purpose

Create a lightweight, secure school management system for Sri Lankan schools. A school can register through the product's public website and receive its own independently deployed application. The product team maintains releases and security patches; each school controls its own school data and installation.

The intended product includes:

- Public product website and school registration/onboarding.
- School administrator and principal experiences.
- Teacher, student, and parent/guardian portals.
- School records, academic structure, attendance, timetable, announcements, and activities.
- Learning resources, tutorials, assignments, question banks, and LMS features.
- Examination setup, mark entry and moderation, released results sheets, and analysis.
- Certificates, notifications, and optional AI assistance for teachers, learners, and school management.

## Agreed direction

### School deployment

- Each school gets an independent installation, database, and file storage boundary.
- Core school workflows must continue if the product's central registration, licensing, update, AI, or notification services are unavailable.
- cPanel is an important target, but cPanel capabilities vary by provider and hosting plan.
- Automated provisioning is possible for hosting accounts operated by the product team when authorized provider APIs are available. Installation on a school's unrelated cPanel account requires an authorized API or an owner-assisted installer flow.
- Updates should be delivered as signed, versioned releases with compatibility checks, verified backups, staged migrations, health checks, and a recovery plan. An admin panel must not execute arbitrary code or unverified packages.

### Technology direction

- School frontend: React, TypeScript, Vite, and Tailwind CSS, built to static assets for Apache/cPanel.
- Database: MySQL-compatible relational database.
- Backend: Node.js with TypeScript; use a lightweight HTTP framework and a MySQL-compatible data layer with migrations. Validate the framework and ORM choice against target cPanel support before implementation.
- Use a modular monolith and versioned API. Avoid microservices and infrastructure dependencies that are impractical on shared hosting.
- Do not use both Vite and Next.js for the same school frontend. Next.js may be considered for the public website only when there is a clear need and the target host supports its runtime; static export is another option with feature limitations.
- Use database-backed jobs and cPanel cron in the baseline deployment rather than requiring Redis or always-on workers.

### Data and safety principles

- Treat student and family data as sensitive, minimize collection, and enforce school and relationship scoping on the server.
- Use explicit guardian-student links, role/permission checks, audit history, private file storage, secure backups, exports, and restore/offboarding procedures.
- Results publication is versioned. Corrections require history and reasons; released results must not be silently overwritten.
- Keep AI optional and disabled by default. Do not send identifiable student records to an AI provider by default. AI suggestions require human review and must not make high-stakes decisions or assign final grades.
- Support Sinhala, Tamil, and English through localization-ready content; confirm priorities with the pilot school.

## Sri Lanka considerations

The project is intended for Sri Lankan schools, so school workflows, grading rules, report formats, terminology, languages, academic calendars, and connectivity assumptions need validation locally. The Data Protection Authority's published implementation status indicates key PDPA provisions scheduled for 1 January 2027; verify current Gazette and DPA information and get local legal review before launch. See the [DPA implementation status](https://www.dpa.gov.lk/Background) and the [National Education Policy Framework 2020–2030](https://nec.gov.lk/wp-content/uploads/2022/10/NATIONAL-EDUCATION-POLICY-FRAMEWORK-2020-2030_Full-Text.pdf).

## Planning artifacts

- [`docs/school-management-blueprint.md`](docs/school-management-blueprint.md) — product and system architecture blueprint, functional scope, deployment model, privacy, AI, update design, risks, and roadmap.
- [`instruction.md`](instruction.md) — implementation instructions for contributors and coding assistants.

## Current status and open decisions

The architecture foundation (v0.1.0) is in the repository: npm-workspaces monorepo (`apps/api` Fastify + Kysely/MySQL, `apps/web` React + Vite + Tailwind, `packages/shared` contracts), migration 0001 (school, users, roles, sessions, audit, academic years/terms, job queue), cookie sessions with CSRF and throttling, role→permission model, audit helper, DB queue + cron CLI, i18n (en complete; si/ta fall back to English). See `docs/architecture.md`, `docs/adr/`, `docs/deployment.md`, `docs/backlog.md` and `CLAUDE.md`. Migrations have not yet been run against a real MySQL server, and hosting compatibility is not yet validated.

Before building production features, confirm these with the pilot school and product owner:

1. School type, size, and expected concurrent users.
2. Priority language(s) and translation ownership.
3. Academic structure, examination workflow, grading scales, and required report-sheet samples.
4. Whether fees/accounting belong in the first release.
5. Target cPanel provider and exact hosting plan, including Node.js runtime and database versions, cron, storage, backup, and outbound API support.
6. Whether deployments will be product-managed, school-managed, or both.
7. Domain, email, SMS, backup storage, and support ownership.
8. Data retention, guardian verification, consent, and AI policy.
9. Initial release scope and pilot acceptance criteria.

## Suggested next step

Run a short discovery phase with one pilot school. Observe a complete term workflow—from enrollment and attendance through exam setup, moderation, result approval, and parent/student release. Use real forms and grading examples to agree on scope, permissions, language needs, hosting limits, and acceptance criteria before building production features.

