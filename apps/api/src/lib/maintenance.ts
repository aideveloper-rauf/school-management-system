import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { AppError } from './errors.js';

/**
 * Maintenance mode (roadmap O-8). While on, the API answers 503 `errors.maintenance` to everything except:
 * health, sign-in/session/sign-out, public branding, and — for users with `ops.status.read` — the ops endpoints,
 * so an administrator can watch and switch it off. Stored in app_meta (`maintenance` = message or absent) and
 * cached for a few seconds so it costs almost nothing per request.
 */
const KEY = 'maintenance';
const CACHE_MS = 5_000;
let cache: { at: number; value: string | null } | null = null;

export async function maintenanceMessage(db: Db): Promise<string | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  const row = await db.selectFrom('app_meta').select('meta_value').where('meta_key', '=', KEY).executeTakeFirst();
  cache = { at: Date.now(), value: row?.meta_value ?? null };
  return cache.value;
}

export async function setMaintenance(db: Db, message: string | null): Promise<void> {
  if (message === null) await db.deleteFrom('app_meta').where('meta_key', '=', KEY).execute();
  else
    await db
      .insertInto('app_meta')
      .values({ meta_key: KEY, meta_value: message.slice(0, 500) })
      .onDuplicateKeyUpdate({ meta_value: message.slice(0, 500) })
      .execute();
  cache = null;
}

const ALWAYS = [/^\/health$/, /^\/auth\/(login|logout|session)$/, /^\/school\/branding$/];
const OPS = /^\/ops\//;

export function maintenanceGuard(db: Db, prefix: string) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const msg = await maintenanceMessage(db);
    if (msg === null) return;
    const path = req.url.split('?')[0]!.slice(prefix.length);
    if (ALWAYS.some((re) => re.test(path))) return;
    if (OPS.test(path) && req.auth?.permissions.has('ops.status.read')) return;
    throw new AppError('SERVICE_UNAVAILABLE', 'errors.maintenance', [{ path: 'maintenance', message: msg }]);
  };
}
