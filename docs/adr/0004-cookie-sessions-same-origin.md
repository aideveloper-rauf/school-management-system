# ADR-0004: Server-side sessions in HttpOnly cookies, same-origin API

**Status:** Accepted · 2026-11-23

**Context.** Children's data; browser clients only; must support revocation (logout, disable user) and audit.

**Decision.** Opaque random session token in an `HttpOnly; SameSite=Strict; Secure` cookie, stored hashed in `sessions`. Web and API share one origin (`/api` path). Unsafe requests require a matching Origin (when sent) and an `x-csrf-token` header bound to the session. Passwords hashed with Node's built-in scrypt.

**Alternatives.** JWT in localStorage (XSS-exposed, hard to revoke); argon2 native module (compile issues on shared hosting — revisit if a prebuilt binary is validated on the target plan).

**Consequences.** Requires API and web on the same hostname. Native mobile apps would need a separate token flow later.
