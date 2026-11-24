# Build backlog

Ordered per `instruction.md` → *Product delivery order*. Tick items only when they meet the Definition of Done.
Detailed tasks, IDs, dependencies and exit gates for each item: [`roadmap.md`](roadmap.md).

## Phase 0 — Discovery (needs the pilot school; not code)
- [ ] Confirm school type/size, languages, grading scales, report-sheet samples, term calendar
- [ ] Confirm cPanel provider & plan; run the compatibility gate (Node LTS, Passenger, MySQL version, cron, limits)
- [ ] Permission matrix sign-off (does `packages/shared/src/roles.ts` match reality?)
- [ ] Data retention, guardian verification and consent policy

## Phase 1 — Foundation
- [x] Monorepo, shared contracts, API skeleton, error format, config validation
- [x] Migration 0001: school, users, roles, sessions, login attempts, audit, academic years, terms, jobs, app_meta
- [x] Login / session / logout, CSRF + origin checks, throttling, scrypt hashing
- [x] Role → permission model, `requirePermission`, audit helper, ops status, DB job queue + cron CLI
- [x] Web shell: login, role-aware navigation, i18n (en + si/ta fallback), language switcher
- [x] MySQL integration test suite (CI service container) incl. migration up on empty DB and login flow
- [x] Lint/format, route-authorization startup check, shared pagination/id/date schemas (roadmap F-6, F-7)
- [x] User management API: invite/create users, assign/revoke roles (audited), disable/enable, temporary passwords (roadmap U-1…U-3)
- [x] Password change & reset, invitations (time-limited single-use tokens, queued email adapter: file + SMTP) (U-4…U-6)
- [x] Users & account UI: users page, change password, reset/accept-invite pages, forced password change screen (U-7)
- [x] Terms CRUD; grades, class sections, subjects, rooms, periods, calendar (API; UI is the item below) — roadmap A-1…A-4
- [x] Foreign keys actually enforced on MySQL (migration 0003) + guard tests
- [x] Year rollover helper (roadmap A-5; class sections only — student promotion comes with enrolment)
- [x] School settings UI; academic structure UI (A-6, A-7)
- [x] Audit log viewer UI; ops status UI (O-1, O-2)
- [x] Backup/export CLI (DB dump + storage archive, encrypted) and restore runbook; record last backup in app_meta (O-3, O-4; full school data export for offboarding O-5 still open)
- [x] Release packaging: versioned artifact + checksum + signature; manual install/upgrade guide (O-6; upgrade-check preflight. Still open: generate the real signing key; maintenance mode and automated in-app upgrade O-7/O-8)
- [ ] Validate deployment on the target cPanel plan; update deployment.md with measured limits
- [ ] Supply Sinhala and Tamil translations (owner: pilot school / translator)

## Phase 2 — Core operations
- [x] Staff and student records (minimal fields), enrollment history, CSV import (idempotent ImportJob) — fields provisional until P0-6
- [x] Guardian profiles and verified `student_guardians` links; scope helpers (`assertCanAccessStudent`)
- [x] Teacher class/subject assignments
- [x] Attendance sessions/records, correction workflow with reasons, guardian notification jobs (per-day registers, email; per-period and SMS later)
- [x] Timetable with teacher/class/room collision checks
- [x] Announcements with audience targeting (read receipts)

## Phase 3 — Learning & exams
- [x] Tutorials/assignments/submissions with private file storage and authorized downloads
- [x] Question bank with versioning; exam paper versions
- [x] Exam series, assessment components, grading scales (versioned), mark entry (DECIMAL), moderation, approval (calculation rules provisional until P0-3 fixtures)
- [x] Result publication as immutable versioned snapshots; correction = new version + reason

## Phase 4 — Family & certificates
- [x] Student and guardian portals (released results only) + guardian/student sign-in onboarding (G-3)
- [ ] Certificates: templates, unique serials, issue/revoke log, minimal public verification
- [ ] Notifications (email/SMS adapters via queue)

## Phase 5 — Analytics & optional AI (only after core is stable)
- [ ] Dashboards from approved aggregates
- [ ] AI provider adapter behind `FEATURE_AI`, school opt-in, de-identified prompts, human review
