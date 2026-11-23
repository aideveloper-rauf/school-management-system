# ADR-0001: One installation and database per school

**Status:** Accepted · 2026-11-23

**Context.** Schools must own their data, keep working if central services are down, and be restorable/offboardable independently. Shared hosting limits make complex tenant isolation risky.

**Decision.** Each school gets its own deployment, MySQL database, file storage and secrets. The schema has no `school_id` tenant column; the `schools` table holds one row describing the installation.

**Consequences.** Simple, strong isolation and per-school backups. Higher operating cost and the need for reliable release/upgrade tooling across many installations. A shared multi-tenant offering would need a new ADR and a schema change.
