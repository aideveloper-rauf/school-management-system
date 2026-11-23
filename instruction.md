# Project Instructions — Sri Lanka School Management System

This file gives implementation guidance for contributors and coding assistants working in this repository. Follow it together with the product blueprint in [`docs/school-management-blueprint.md`](docs/school-management-blueprint.md). If a request conflicts with this file, follow the user's explicit request unless it creates a security, privacy, or data-loss risk; explain material conflicts clearly.

## Product objective

Build a lightweight, secure, multilingual school management system for Sri Lankan schools. The product includes a public website and separately deployed school installations with role-specific experiences for administrators, principals, teachers, students, and parents/guardians. Core capabilities include school operations, timetable and attendance, teaching and tutorials, examinations, marks, released results, reporting, and certificates.

Each school installation must be independently operable and have a distinct database and file store. The school must retain access to its core workflows if the central registration, licensing, update, notification, or AI service is unavailable.

## Architecture and technology decisions

- School web client: React, TypeScript, Vite, and Tailwind CSS; build static assets for Apache/cPanel.
- Database: MySQL-compatible relational database using transactions, foreign keys, and migrations.
- Use a modular monolith for the school application. Organize code by school domains; do not add microservices without a demonstrated operational need.
- Do not combine Vite and Next.js for the same school UI. Use Next.js only for a clearly justified public website need. The school API requires a persistent Node.js runtime; support only cPanel plans where the provider enables Application Manager/Passenger (or an equivalent supported process manager). Provide a documented VPS/managed-hosting path when Node.js apps are unavailable.
- Backend: Node.js with TypeScript. Prefer a lightweight HTTP framework (Fastify is a reasonable starting choice) and a MySQL-compatible data layer with migrations. Keep API and UI boundaries documented and versioned.
- Avoid requiring Redis, containers, root access, or always-on background workers in the baseline cPanel deployment. Use a database-backed queue and cron where asynchronous work is needed.
- Use TypeScript for new client code and shared API contracts. Do not maintain duplicate JavaScript and TypeScript implementations of the same feature.
- Build accessible, responsive, low-bandwidth pages. Lazy-load heavy screens and reports; minimize dependencies and shipped JavaScript.
- Support Sinhala, Tamil, and English through translation resources. Do not hard-code user-facing text or assume one language, date format, or grading scale.

## Domain and workflow requirements

- Apply tenant/school scope to every data access. A school user's role is not sufficient authorization by itself: also check class, subject, student, guardian relationship, and assignment scope as applicable.
- Keep role and permission checks on the server/API. UI visibility is not a security boundary.
- Use configurable academic years, terms, grades, class sections, subjects, periods, grading scales, and result formats. Avoid baking a particular school's calendar or assessment policy into code.
- Model parent/guardian-to-student relationships explicitly and verify them before exposing records.
- Treat assessments and results as auditable records. Preserve raw marks, maximum marks, grading-scale version, assessor, timestamps, approvals, and correction reasons.
- Publishing results creates a versioned snapshot. Do not silently alter results already released to students or guardians.
- Version exam papers and question items so edits do not change the historical exam administered to students.
- Keep student activities and sensitive notes permission-scoped and subject to configurable retention.
- Certificates need unique identifiers and issue/revoke history. Public verification should expose only the minimum information needed to establish validity.

## Privacy and security requirements

The system handles children's educational and family information. Treat all school records as sensitive by default.

- Collect only fields needed for a documented school purpose. Do not add identity, health, or other sensitive fields without an explicit requirement and retention/access rules.
- Use secure password hashing, HTTPS, secure/HttpOnly/SameSite cookies, CSRF protection where applicable, session expiry, login throttling, and safe password reset flows.
- Validate and authorize every API request, file download, export, and background job. Prevent insecure direct object references and cross-school access.
- Store uploaded documents privately; never rely on an unguessable public URL as authorization.
- Do not place credentials, tokens, student data, or sensitive request payloads in logs or source control.
- Audit sensitive record access and changes, especially role changes, exports, marks edits, result publication, and support access.
- Use least privilege for support and platform operations. No routine central operator access to school records.
- Back up school data securely and provide tested restore, export, and offboarding workflows.
- Keep AI features disabled by default. Never send identifying student data, marks, attendance history, private correspondence, or student work to an AI provider unless the school has explicitly enabled the feature and approved the data flow. AI output is a draft for human review, never an autonomous grade or high-stakes decision.
- Re-check current Sri Lankan legal and regulatory requirements before production releases. The blueprint is not legal advice.

## Deployment, provisioning, and updates

- Do not promise automatic installation on arbitrary third-party cPanel accounts. Automated provisioning requires an authorized hosting API or an explicit owner-authorized installation flow.
- Keep school DB credentials and secrets unique to each installation. Never collect or store school cPanel passwords in the product.
- Ship immutable, versioned releases with checksums and signatures. The update client must verify artifacts before applying them.
- Before a production update, verify compatibility and backup status. Stage updates, run health checks, record the release/schema version, and provide a tested failure-recovery path.
- Use backward-compatible expand-and-contract database migrations. A code rollback does not necessarily reverse a database migration; never claim otherwise.
- Do not expose remote shell access, arbitrary code execution, or unverified package installation from the admin panel.
- Support manual signed-package installation for schools that cannot allow outbound downloads.
- Document supported Node.js LTS, MySQL, package installation/build, process manager, cron, HTTPS, storage, and resource requirements only after validating them on actual target hosting plans.

## Engineering practices

- Inspect the existing repository and its local instructions before changing files. Preserve established structure and conventions where they are sound.
- Keep changes focused and explain relevant architectural choices. Avoid speculative frameworks, broad rewrites, and unnecessary dependencies.
- Use database migrations for schema changes; include constraints and indexes that reflect actual query patterns.
- Validate inputs at the API boundary. Use parameterized queries/ORM protections and explicit transactions for multi-step workflows.
- Design APIs with consistent error responses, pagination, authorization, and versioning. Make retryable operations idempotent where appropriate.
- Keep secrets in environment configuration and provide a safe example configuration with placeholders only.
- Add or update tests when requested, when changing existing tested behavior, or when needed to verify a high-risk change. Do not claim tests were run unless they were actually run.
- For any feature involving marks, result publication, guardian access, permissions, update execution, or personal data export, explain the security and audit behavior in the implementation summary.
- Keep documentation in sync when deployment, roles, data handling, or update procedures change.

## Product delivery order

Prioritize work in this order unless the user directs otherwise:

1. Discovery of pilot school workflows, language needs, grading/report formats, hosting plan, and data retention.
2. Installation foundation, authentication, school setup, roles, audit, academic structure, backup, restore, and upgrade path.
3. Student/staff records, guardian links, attendance, timetable, and announcements.
4. Teaching resources, tutorials, assignments, question bank, examination setup, mark moderation, and result publication.
5. Student and parent experiences, certificates, notifications, and controlled reporting.
6. Analytics and optional AI only after the core workflows and data governance are stable.

## Definition of done

A feature is ready when:

- It supports the intended role and enforces permissions at the API boundary.
- It respects school isolation and relevant relationship/class/subject scope.
- It has validation, useful error handling, and audit behavior appropriate to the data.
- It works at mobile and desktop sizes and does not assume continuous high-speed connectivity.
- User-facing text is localization-ready.
- Its migrations and deployment implications are documented where relevant.
- Any checks reported as completed were actually run, and known limitations are stated plainly.

