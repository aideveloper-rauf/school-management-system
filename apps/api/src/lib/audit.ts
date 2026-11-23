import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';

export interface AuditInput {
  action: string;
  entityType?: string;
  entityId?: string | number;
  /** Ids, field names, reasons only. Never passwords, tokens, or free-text personal data. */
  metadata?: Record<string, unknown>;
  actorUserId?: number | null;
}

const FORBIDDEN_KEYS = /pass(word)?|token|secret|hash|cookie/i;

function scrub(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) safe[k] = FORBIDDEN_KEYS.test(k) ? '[redacted]' : v;
  return JSON.stringify(safe);
}

export async function recordAudit(db: Db, req: FastifyRequest | null, input: AuditInput): Promise<void> {
  await db
    .insertInto('audit_events')
    .values({
      actor_user_id: input.actorUserId ?? req?.auth?.user.id ?? null,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId === undefined ? null : String(input.entityId),
      metadata: scrub(input.metadata),
      ip: req?.ip ?? null,
      request_id: req?.id ?? null,
    })
    .execute();
}
