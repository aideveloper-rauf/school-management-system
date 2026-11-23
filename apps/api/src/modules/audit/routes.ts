import type { FastifyPluginAsync } from 'fastify';
import { AUDIT_CATEGORIES, auditQuerySchema, pageWindow, toPaginated, type AuditEventItem, type Paginated } from '@sms/shared';
import type { Db } from '../../db/client.js';
import { requirePermission } from '../../plugins/auth.js';

/** Escape LIKE wildcards so user input matches literally. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function parseMetadata(v: unknown): Record<string, unknown> | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(String(v));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Audit log (read-only). Newest first; filter by category, action, person, record and time.
 * Entries are never edited or deleted through the API.
 */
export const auditRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/audit-events', { preHandler: requirePermission('audit.read') }, async (req): Promise<Paginated<AuditEventItem>> => {
    const q = auditQuerySchema.parse(req.query);
    const { limit, offset } = pageWindow(q);

    let base = db.selectFrom('audit_events as a').leftJoin('users as u', 'u.id', 'a.actor_user_id');
    if (q.category) {
      const prefixes = AUDIT_CATEGORIES[q.category];
      base = base.where((eb) => eb.or(prefixes.map((p) => eb('a.action', 'like', `${likeEscape(p)}%`))));
    }
    if (q.action) base = base.where('a.action', '=', q.action);
    if (q.actorUserId) base = base.where('a.actor_user_id', '=', q.actorUserId);
    if (q.entityType) base = base.where('a.entity_type', '=', q.entityType);
    if (q.entityId) base = base.where('a.entity_id', '=', q.entityId);
    if (q.from) base = base.where('a.created_at', '>=', new Date(q.from));
    if (q.to) base = base.where('a.created_at', '<', new Date(q.to));
    if (q.q) {
      const like = `%${likeEscape(q.q)}%`;
      base = base.where((eb) => eb.or([eb('u.display_name', 'like', like), eb('u.identifier', 'like', like)]));
    }

    const [rows, total] = await Promise.all([
      base
        .select([
          'a.id',
          'a.action',
          'a.created_at',
          'a.actor_user_id',
          'u.display_name',
          'u.identifier',
          'a.entity_type',
          'a.entity_id',
          'a.metadata',
          'a.ip',
          'a.request_id',
        ])
        .orderBy('a.id', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
      base.select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    const items: AuditEventItem[] = rows.map((r) => ({
      id: Number(r.id),
      action: r.action,
      createdAt: new Date(r.created_at).toISOString(),
      actor:
        r.actor_user_id !== null && r.display_name !== null
          ? { id: r.actor_user_id, displayName: r.display_name, identifier: r.identifier ?? '' }
          : null,
      entityType: r.entity_type,
      entityId: r.entity_id,
      metadata: parseMetadata(r.metadata),
      ip: r.ip,
      requestId: r.request_id,
    }));
    return toPaginated(items, total.n, q);
  });
};
