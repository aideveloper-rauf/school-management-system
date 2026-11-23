import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { MAX_PAGE_SIZE } from '@sms/shared';
import type { Db } from '../../db/client.js';
import { requirePermission } from '../../plugins/auth.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
  action: z.string().max(100).optional(),
});

export const auditRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.get('/audit-events', { preHandler: requirePermission('audit.read') }, async (req) => {
    const q = querySchema.parse(req.query);
    let base = db.selectFrom('audit_events');
    if (q.action) base = base.where('action', '=', q.action);
    const [items, total] = await Promise.all([
      base
        .select(['id', 'actor_user_id', 'action', 'entity_type', 'entity_id', 'created_at'])
        .orderBy('id', 'desc')
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize)
        .execute(),
      base.select(db.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: Number(total.n) };
  });
};
