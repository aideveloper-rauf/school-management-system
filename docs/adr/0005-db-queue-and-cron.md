# ADR-0005: Database-backed job queue drained by cron

**Status:** Accepted · 2026-11-23

**Context.** Baseline cPanel has no Redis and no guaranteed always-on worker.

**Decision.** `jobs` table with `SELECT … FOR UPDATE SKIP LOCKED` claiming, retries with backoff, idempotency keys, drained by `cli/run-jobs` from cPanel cron.

**Consequences.** Notifications and large reports are delayed by up to the cron interval. Handlers must be idempotent. Critical small tasks may run synchronously in the request.
