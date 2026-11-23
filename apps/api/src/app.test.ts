import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DummyDriver, Kysely, MysqlAdapter, MysqlIntrospector, MysqlQueryCompiler } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';
import type { Database } from './db/types.js';
import { assertRouteDeclaresAuth, requireAuth, requirePermission } from './plugins/auth.js';

/**
 * HTTP-level tests that need no MySQL: DummyDriver returns empty result sets,
 * so every session lookup misses. Integration tests against a real MySQL
 * database belong in a separate suite (TODO phase 1).
 */
let app: FastifyInstance;
const config = loadConfig({ NODE_ENV: 'test', APP_ORIGIN: 'http://localhost:5173' });

beforeAll(async () => {
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new MysqlAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (d) => new MysqlIntrospector(d),
      createQueryCompiler: () => new MysqlQueryCompiler(),
    },
  });
  app = await buildApp({ config, db, logger: false });
});
afterAll(async () => app.close());

describe('API foundation', () => {
  it('serves a public health probe', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('returns the standard error shape for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('requires authentication for protected routes', async () => {
    for (const url of ['/api/v1/auth/session', '/api/v1/school', '/api/v1/academic-years', '/api/v1/audit-events', '/api/v1/ops/status']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('treats an unknown session cookie as unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/school', cookies: { sms_session: 'forged' } });
    expect(res.statusCode).toBe(401);
  });

  it('validates the login body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: '' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects cross-origin state-changing requests', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { identifier: 'a', password: 'b' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_FAILED');
  });

  it('refuses to register a route without an auth guard or public flag', () => {
    expect(() => assertRouteDeclaresAuth({ method: 'GET', url: '/api/v1/oops' })).toThrow(/no auth preHandler/);
    expect(() => assertRouteDeclaresAuth({ method: 'GET', url: '/api/v1/oops', preHandler: async () => {} })).toThrow();
    expect(() => assertRouteDeclaresAuth({ method: 'GET', url: '/api/v1/ok', preHandler: [requireAuth] })).not.toThrow();
    expect(() => assertRouteDeclaresAuth({ method: 'GET', url: '/api/v1/ok', preHandler: requirePermission('audit.read') })).not.toThrow();
    expect(() => assertRouteDeclaresAuth({ method: 'GET', url: '/api/v1/pub', config: { public: true } })).not.toThrow();
  });

  it('does not leak whether an account exists', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { identifier: 'nobody@example.lk', password: 'whatever-123' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toBe('errors.invalidCredentials');
  });
});
