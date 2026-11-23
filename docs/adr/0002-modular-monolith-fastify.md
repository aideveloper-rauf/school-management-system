# ADR-0002: Modular monolith on Node.js + Fastify

**Status:** Accepted · 2026-11-23

**Context.** Target is cPanel Application Manager (Passenger) where one Node.js process per app is realistic; microservices are impractical.

**Decision.** One TypeScript API process using Fastify 5, organized by domain modules under `src/modules/<domain>`, exposed at `/api/v1`. Modules talk via function calls, not HTTP.

**Consequences.** Low memory and simple deployment. Module boundaries must be kept by convention (no cross-module table writes without going through that module's service).
