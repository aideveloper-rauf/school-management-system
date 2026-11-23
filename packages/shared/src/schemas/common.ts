import { z } from 'zod';
import { MAX_PAGE_SIZE, type Paginated } from '../api.js';

/** `?page=&pageSize=` for every list endpoint. Values arrive as strings, so coerce. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(50),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** `/things/:id` route params: positive integer ids only. */
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** A real calendar date in `YYYY-MM-DD` (rejects e.g. 2026-02-31). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a valid date');

/** SQL LIMIT/OFFSET for a pagination query. */
export function pageWindow(q: PaginationQuery): { limit: number; offset: number } {
  return { limit: q.pageSize, offset: (q.page - 1) * q.pageSize };
}

export function toPaginated<T>(items: T[], total: number | bigint | string, q: PaginationQuery): Paginated<T> {
  return { items, page: q.page, pageSize: q.pageSize, total: Number(total) };
}

/** One audit log row as returned by GET /audit-events. Metadata is intentionally not listed. */
export interface AuditEventItem {
  id: number;
  actorUserId: number | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}
