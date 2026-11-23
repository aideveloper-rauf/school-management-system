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
- [ ] User management: invite/create users, assign/revoke roles (audited), disable accounts, admin UI
- [ ] Password change & reset (time-limited single-use tokens, queued email adapter)
- [x] Terms CRUD; grades, class sections, subjects, rooms, periods, calendar (API; UI is the item below) — roadmap A-1…A-4
- [x] Foreign keys actually enforced on MySQL (migration 0003) + guard tests
- [ ] Year rollover helper (roadmap A-5)
- [ ] School settings UI; academic structure UI
- [ ] Audit log viewer UI; ops status UI
- [ ] Backup/export CLI (DB dump + storage archive, encrypted) and restore runbook; record last backup in app_meta
- [ ] Release packaging: versioned artifact + checksum + signature; manual install/upgrade guide
- [ ] Validate deployment on the target cPanel plan; update deployment.md with measured limits
- [ ] Supply Sinhala and Tamil translations (owner: pilot school / translator)

## Phase 2 — Core operations
- [ ] Staff and student records (minimal fields), enrollment history, CSV import (idempotent ImportJob)
- [ ] Guardian profiles and verified `student_guardians` links; scope helpers (`assertCanAccessStudent`)
- [ ] Teacher class/subject assignments
- [ ] Attendance sessions/records, correction workflow with reasons, guardian notification jobs
- [ ] Timetable with teacher/class/room collision checks
- [ ] Announcements with audience targeting

## Phase 3 — Learning & exams
- [ ] Tutorials/assignments/submissions with private file storage and authorized downloads
- [ ] Question bank with versioning; exam paper versions
- [ ] Exam series, assessment components, grading scales (versioned), mark entry (DECIMAL), moderation, approval
- [ ] Result publication as immutable versioned snapshots; correction = new version + reason

## Phase 4 — Family & certificates
- [ ] Student and guardian portals (released results only)
- [ ] Certificates: templates, unique serials, issue/revoke log, minimal public verification
- [ ] Notifications (email/SMS adapters via queue)

## Phase 5 — Analytics & optional AI (only after core is stable)
- [ ] Dashboards from approved aggregates
- [ ] AI provider adapter behind `FEATURE_AI`, school opt-in, de-identified prompts, human review
