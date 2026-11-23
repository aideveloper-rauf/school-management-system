import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pageWindow, paginationQuerySchema, toPaginated, type AuditEventItem, type Paginated } from '@sms/shared';
import type { Db } from '../../db/client.js';
import { requirePermission } from '../../plugins/auth.js';

const querySchema = paginationQuerySchema.extend({
  action: z.string().max(100).optional(),
});

export const auditRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/audit-events', { preHandler: requirePermission('audit.read') }, async (req): Promise<Paginated<AuditEventItem>> => {
    const q = querySchema.parse(req.query);
    const { limit, offset } = pageWindow(q);
    let base = db.selectFrom('audit_events');
    if (q.action) base = base.where('action', '=', q.action);
    const [rows, total] = await Promise.all([
      base
        .select(['id', 'actor_user_id', 'action', 'entity_type', 'entity_id', 'created_at'])
        .orderBy('id', 'desc')
        .limit(limit)
        .offset(offset)
        .execute(),
      base.select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    const items = rows.map((r) => ({
      id: Number(r.id),
      actorUserId: r.actor_user_id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      createdAt: new Date(r.created_at).toISOString(),
    }));
    return toPaginated(items, total.n, q);
  });
};
