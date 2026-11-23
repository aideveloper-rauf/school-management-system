# Delivery roadmap — phases and tasks

**Date:** 23 November 2026 · **Baseline:** v0.1.0 foundation

This expands [`backlog.md`](backlog.md) into concrete, ordered tasks with IDs, dependencies and exit criteria.
Order follows `instruction.md` → *Product delivery order*. `backlog.md` stays the tick-list; tick an item there
only when every task under it here meets the Definition of Done in `instruction.md`.

Size guide: **S** ≤ 1 day · **M** 2–4 days · **L** 1–2 weeks (one developer). Sizes are planning estimates, not commitments.

---

## Review of the current state

**What exists (v0.1.0)**

| Area | State |
|---|---|
| Monorepo | npm workspaces: `packages/shared`, `apps/api`, `apps/web` |
| API | Fastify 5, `/api/v1`, error plugin, zod env config, auth plugin (cookie session, origin + CSRF checks), `requireAuth` / `requirePermission` |
| Endpoints | `GET /health`, `GET /ops/status`, `POST /auth/login`, `GET /auth/session`, `POST /auth/logout`, `GET/PATCH /school`, `GET/POST /academic-years`, `GET /audit-events` |
| Data | Migration 0001: `schools`, `users`, `user_roles`, `sessions`, `login_attempts`, `audit_events`, `academic_years`, `terms`, `jobs`, `app_meta` |
| Jobs | DB queue with `SKIP LOCKED`, `run-jobs` cron CLI, housekeeping |
| CLIs | `migrate`, `create-admin`, `run-jobs` |
| Web | Login, role-aware nav, dashboard, i18n (en; si/ta fall back), language switcher. **Every other page is a placeholder.** |
| Tests | 7 HTTP tests (DummyDriver, no MySQL), password and roles unit tests |
| Docs | Blueprint, instructions, architecture, deployment draft, 5 ADRs |

**Gaps and risks found**

1. **Not yet run.** No `node_modules`, no `apps/api/.env`; typecheck, tests, build and migrations have never been executed in this checkout. First job: prove the foundation actually works.
2. **No version control.** The folder is not a git repository, and `sms-foundation.tgz` (a ~60 KB archive) sits in the root. Initialise git and decide whether that archive belongs in the repo (likely not).
3. **No MySQL integration tests.** Migration 0001, the login flow and the job queue's `SKIP LOCKED` claim are untested against a real database.
4. **Thin academic API.** `terms` table exists with no routes; academic years have no update/delete or "set current" endpoint.
5. **No user lifecycle.** Only `create-admin` CLI can create users; no invite, role assignment, disable, password change or reset.
6. **Ops promises not met yet.** No backup/restore, release packaging, signature verification or update path — all are Phase 1 exit-gate requirements in the blueprint.
7. **Missing roles.** Blueprint lists accountant, librarian/activity coordinator, platform operator; `roles.ts` does not (correct for now — add only when those modules are scoped).
8. **No public website / control plane** in the backlog. Blueprint §2.1 includes them; they are scheduled below as Phase 6.
9. **Hosting not validated.** cPanel/Passenger compatibility is untested; deployment.md is a draft.
10. **Discovery not done.** Grading scales, report formats and the permission matrix are assumptions until a pilot school signs off.

---

## Phase 0 — Discovery (parallel to Phase 1A; needs the pilot school)

Exit gate: pilot school signs off workflows, data fields, permission matrix, hosting plan and retention assumptions.

| ID | Task | Size | Output |
|---|---|---|---|
| P0-1 | Pick the pilot school; record type (national/provincial/private/international), size, grades, mediums of instruction | S | `docs/discovery/pilot-profile.md` |
| P0-2 | Collect samples: report sheets, mark books, attendance registers, timetable, term calendar, admission form | M | `docs/discovery/samples/` (redacted — no real student data) |
| P0-3 | Document grading scales and result calculation rules (term tests, O/L-style grades, ranks, averages) with worked examples | M | `docs/discovery/grading.md` + test fixtures |
| P0-4 | Walk through one full term workflow with staff: enrolment → attendance → exam → moderation → approval → release | M | `docs/discovery/workflows.md` |
| P0-5 | Permission matrix review against `packages/shared/src/roles.ts`; list changes | S | Signed matrix; ADR if roles change |
| P0-6 | Data retention, guardian verification method, consent, sensitive-field policy; PDPA review with local counsel | M | `docs/policy/data-handling.md` |
| P0-7 | Language priorities and translator ownership for si/ta | S | Owner and schedule |
| P0-8 | Choose cPanel provider and plan; get a staging account | S | Plan details in `deployment.md` |
| P0-9 | Decide release-1 scope: fees? activities? SMS provider? who owns domain/email | S | Scope note appended to this file |

---

## Phase 1A — Make the foundation real (start now)

Exit gate: clean install on a fresh machine and on MySQL passes typecheck, tests, build, migrate, login.

| ID | Task | Size | Depends |
|---|---|---|---|
| F-1 | `git init`, add `.gitignore` checks (`.env`, `dist`, `node_modules`, `storage`), decide on `sms-foundation.tgz`, first commit | S | — |
| F-2 | `npm install`; run `npm run typecheck`, `npm test`, `npm run build`; fix anything broken | S | F-1 |
| F-3 | Create local WAMP DB + `.env`; run `db:migrate` and `setup:admin`; log in through the web app | S | F-2 |
| F-4 | MySQL integration test suite (Vitest + real DB, separate test database): migrate up on empty DB, `db/types.ts` vs. information_schema check, login/logout/throttle flow, job claim with `SKIP LOCKED` | M | F-3 |
| F-5 | CI workflow (GitHub Actions): Node 22 + MySQL 8 service; typecheck, unit, integration, build; dependency audit | M | F-4 |
| F-6 | Lint/format (ESLint + Prettier) and a rule or test that every route has a `preHandler` auth declaration | S | F-2 |
| F-7 | Shared API conventions in `packages/shared`: pagination schema, list response type, id params; refactor audit route to use them | S | F-2 |

## Phase 1B — Foundation features

Exit gate (blueprint): fresh install **and** upgrade succeed on the target cPanel plan; restore rehearsal passes.

**Identity and users**

| ID | Task | Size | Depends |
|---|---|---|---|
| U-1 | Migration 0002: `password_reset_tokens`, `user_invitations` (hashed single-use tokens, expiry); user `email` if identifier is not an email | S | F-4 |
| U-2 | API: list/search users (paginated), create/invite, update display name/locale, disable/enable (revokes sessions) — audited | M | U-1 |
| U-3 | API: assign/revoke roles; forbid removing the last `school_admin`; audit `role.granted` / `role.revoked` | S | U-2 |
| U-4 | Password change (requires current password; revokes other sessions) | S | U-1 |
| U-5 | Password reset: request (no account enumeration, rate-limited) → queued email job → single-use token → set password | M | U-1, N-1 |
| U-6 | Mail adapter interface + SMTP implementation + `log` dev adapter; `send_email` job handler (idempotent) | M | F-4 |
| U-7 | Web: Users page (list, invite, roles, disable), Account page (change password, language), reset-password pages | L | U-2–U-5 |
| U-8 | Optional MFA (TOTP) for `school_admin`/`principal` — decide in P0-6 | M | U-4 |

**Academic structure** (all configurable; nothing hard-coded)

| ID | Task | Size | Depends |
|---|---|---|---|
| A-1 | Migration 0003: `grades`, `class_sections` (per academic year), `subjects`, `grade_subjects`, `rooms`, `period_definitions`, `calendar_events` | M | F-4 |
| A-2 | API: academic years update/delete-if-unused, set-current (single current year, transactional) | S | F-4 |
| A-3 | API: terms CRUD with overlap and in-year validation | S | A-2 |
| A-4 | API: grades, class sections, subjects, rooms, periods CRUD; delete blocked when referenced (return conflict) | M | A-1 |
| A-5 | Year rollover helper: copy class sections and subject mapping into a new year | M | A-4 |
| A-6 | Web: Academic setup screens (years/terms, grades & classes, subjects, rooms, periods, calendar) | L | A-2–A-4 |
| A-7 | Web: School settings page (name, short name, default locale, timezone) | S | — |

**Operations**

| ID | Task | Size | Depends |
|---|---|---|---|
| O-1 | Web: Audit log viewer (filters by action, actor, date; paginated) — extend API filters | M | F-7 |
| O-2 | Web: System status page (version, schema version, queue depth, last backup, storage use) | S | O-3 |
| O-3 | Backup CLI: `mysqldump`-free logical dump via the app (or documented `mysqldump`), plus storage archive; encrypt with a school-held key; write `app_meta.last_backup_at` | L | F-4 |
| O-4 | Restore CLI + runbook; rehearse restore into an empty DB and verify checksums/row counts | M | O-3 |
| O-5 | School data export (full, machine-readable) and offboarding runbook | M | O-3 |
| O-6 | Release packaging: build script producing a versioned archive + manifest (version, schema range, SHA-256) + Ed25519 signature | M | F-5 |
| O-7 | Install/upgrade CLI: verify signature, check backup recency, maintenance mode flag, migrate, health check, record `ReleaseRecord` | L | O-6, O-3 |
| O-8 | Maintenance mode (API returns 503 except health/ops for admins; web banner) | S | — |
| O-9 | Log scrubbing review: no tokens, passwords, or personal data in logs; add a test | S | F-4 |

**Hosting and language**

| ID | Task | Size | Depends |
|---|---|---|---|
| H-1 | Run the compatibility gate on the chosen cPanel plan (Node LTS, Passenger, MySQL version, cron, memory, uploads, outbound HTTPS) | M | P0-8, O-6 |
| H-2 | Fresh install + upgrade + restore drill on staging; update `deployment.md` with measured limits | M | H-1, O-4, O-7 |
| H-3 | Switch to `BrowserRouter` if `.htaccess` rewrite is confirmed | S | H-1 |
| H-4 | Sinhala and Tamil translation files; Unicode font check; locale-aware date/number formatting | M | P0-7 |
| H-5 | Accessibility + low-bandwidth pass on the shell (keyboard nav, contrast, bundle size budget in CI) | S | U-7 |

---

## Phase 2 — Core operations

Exit gate: pilot users complete term operations; authorization and data export are reviewed.

| ID | Task | Size | Depends |
|---|---|---|---|
| C-1 | Migration: `staff_profiles`, `student_profiles` (minimal fields per P0-6), `enrollments` (student ↔ class section ↔ year, with history), status changes | M | A-1 |
| C-2 | API: staff CRUD; link staff to user accounts | M | C-1, U-2 |
| C-3 | API: student CRUD, enrolment, transfer/leave with reason; audited | L | C-1 |
| C-4 | CSV import as idempotent `ImportJob` (dry-run preview, row errors, re-runnable) for students, staff, guardians | L | C-3 |
| C-5 | Migration + API: `guardian_profiles`, `student_guardians` with verification state; registrar workflow to verify links | M | C-3 |
| C-6 | Migration + API: `teacher_assignments` (teacher ↔ class section ↔ subject ↔ year); class teacher flag | M | C-2, A-4 |
| C-7 | Scope helpers: `assertCanAccessStudent`, `assertCanAccessClass`, `scopedStudentQuery`; out-of-scope → `NOT_FOUND`; exhaustive tests per role | M | C-5, C-6 |
| C-8 | Attendance: sessions per class/day (or per period, configurable), records (present/absent/late/leave), bulk entry API | L | C-7 |
| C-9 | Attendance corrections with reason + approval; leave requests | M | C-8 |
| C-10 | Guardian absence notification jobs (respecting opt-in and quiet hours) | M | C-8, U-6 |
| C-11 | Timetable entries with teacher/class/room collision checks; class, teacher and room views; printable | L | C-6, A-4 |
| C-12 | Announcements with audience targeting (school, grade, class, role, guardians of class); read receipts optional | M | C-7 |
| C-13 | Activity records (clubs, sports, commendations/incidents) with visibility and retention — only if in P0-9 scope | M | C-7 |
| C-14 | Web: Students, Staff, Guardians, Import, Attendance (mobile-first entry), Timetable, Announcements screens | L ×2 | C-2–C-12 |
| C-15 | Reports: class lists, attendance summaries (print-friendly HTML; large ones queued) | M | C-8 |
| C-16 | Sensitive-read audit (student profile views, exports) | S | C-3 |

---

## Phase 3 — Learning and exams

Exit gate: a full exam-to-approved-results workflow reconciles with the school's own calculations (fixtures from P0-3).

| ID | Task | Size | Depends |
|---|---|---|---|
| L-1 | Private file storage service: upload limits, MIME sniffing, stored outside web root, authorized download route | M | C-7 |
| L-2 | Tutorials/resources and assignments per class/subject; due dates; attachments | L | L-1, C-6 |
| L-3 | Submissions + teacher feedback; late flag; authorized downloads | M | L-2 |
| L-4 | Question bank: items with language, subject, grade, outcome, difficulty, marks, licence/source, review status, revisions | L | C-6 |
| L-5 | Exam paper versions storing exact question versions; printable paper; answer-key permission | M | L-4 |
| E-1 | Grading scales (versioned) and result formats configurable per school | M | P0-3 |
| E-2 | Exam series, exams per grade/subject, assessment components with max marks and weights | M | E-1, A-4 |
| E-3 | Mark entry (DECIMAL, absent/exempt states, assessor, timestamps), scoped to teacher assignments; bulk grid API | L | E-2, C-7 |
| E-4 | Moderation and approval workflow; correction with reason; full audit | M | E-3 |
| E-5 | Result calculation engine (totals, averages, grades, ranks per school rules) with fixture tests from P0-3 | L | E-1, E-3 |
| E-6 | Result publication as immutable versioned snapshots; correction = new version + reason; never overwrite | M | E-4, E-5 |
| E-7 | Result sheets: class and individual, print-friendly HTML/PDF, queued for bulk | L | E-6 |
| E-8 | Web: Exams setup, mark entry grid (offline-tolerant, autosave), moderation, publish screens | L ×2 | E-2–E-7 |

---

## Phase 4 — Family and certificates

Exit gate: guardian access checks and certificate privacy review pass.

| ID | Task | Size | Depends |
|---|---|---|---|
| G-1 | Student portal: own timetable, materials, assignments, released results only | M | E-6, L-2 |
| G-2 | Guardian portal: linked children switcher, attendance, announcements, released results; cross-child access tests | M | C-5, E-6 |
| G-3 | Guardian account onboarding via verified link + invitation | S | C-5, U-2 |
| K-1 | Certificate templates (multilingual), unique serials, issue log | M | C-3 |
| K-2 | Revocation with reason; history | S | K-1 |
| K-3 | Public verification page (rate-limited; shows validity and minimal fields only) | S | K-2 |
| K-4 | PDF generation for certificates | M | K-1 |
| N-1 | Notification framework: templates per locale, channel adapters (email; SMS via a Sri Lankan gateway), preferences, delivery log | M | U-6 |
| N-2 | Teacher ↔ guardian messaging under school policy controls (if in scope) | L | N-1 |

---

## Phase 5 — Analytics and optional AI (only after core is stable)

Exit gate: school opts in; data-flow/privacy review and human-review workflow demonstrated.

| ID | Task | Size | Depends |
|---|---|---|---|
| X-1 | Principal dashboards from approved aggregates with drill-down permission checks | L | E-6, C-8 |
| X-2 | Attendance-risk indicators and intervention tracking (human-reviewed) | M | X-1 |
| X-3 | AI provider adapter behind `FEATURE_AI`; school opt-in settings; quotas; provider disclosure | M | — |
| X-4 | De-identification layer + tests proving no names/IDs/marks are sent | M | X-3 |
| X-5 | Teacher tools: draft practice questions/tutorials, marked as draft until reviewed | M | X-4, L-4 |
| X-6 | Curriculum retrieval with citations from school-approved sources | L | X-4 |

---

## Phase 6 — Public website, control plane and scale

Exit gate: provisioning, patch, rollback, backup, restore and offboarding drills pass.

| ID | Task | Size | Depends |
|---|---|---|---|
| S-1 | Public website (static; Next.js only if justified — ADR): product, pricing, demo request, registration | L | — |
| S-2 | Registration and onboarding status workflow (verify school and domain) | M | S-1 |
| S-3 | Release service: signed manifests and artifacts; release channels | M | O-6 |
| S-4 | In-app update check → download → verify → stage (no auto-apply) | M | S-3, O-7 |
| S-5 | Managed provisioning via authorized hosting APIs (product-owned accounts only) | L | H-2 |
| S-6 | Opt-in version/health reporting to control plane (no school data) | S | S-3 |
| S-7 | Time-limited, school-approved support access sessions, fully audited | M | U-3 |
| S-8 | Incident response, vulnerability disclosure, release and end-of-support policies | S | — |

---

## Suggested first sprint (2 weeks)

1. F-1 → F-3: version control, install, run every check, migrate, log in.
2. F-4, F-5: MySQL integration tests and CI.
3. A-2, A-3, A-1, A-4: finish the academic structure API.
4. U-1 → U-4: users, roles, password change.
5. In parallel, with the pilot school: P0-1, P0-5, P0-8.

## Cross-cutting rules for every task

- Route declares `requireAuth`/`requirePermission` **and** applies record scope; out-of-scope → `NOT_FOUND`.
- zod validation at the boundary; transactions for multi-step writes; `recordAudit` in the same transaction.
- New migration file per schema change, registered in `migrations/index.ts`; expand-and-contract only.
- All UI text through i18n keys; API messages are `errors.*` keys.
- Tests for permissions and scope on every new endpoint; integration test for every migration.
- Update `architecture.md`, `deployment.md` and ADRs when behaviour or decisions change.
