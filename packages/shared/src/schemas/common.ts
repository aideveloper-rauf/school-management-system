import { z } from 'zod';
import { MAX_PAGE_SIZE, type Paginated } from '../api.js';
import { AUDIT_CATEGORY_KEYS, type AuditCategory } from '../constants.js';

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

/** GET /audit-events filters. Times are ISO date-times so the browser can send its own local day bounds. */
export const auditQuerySchema = paginationQuerySchema.extend({
  category: z.enum(AUDIT_CATEGORY_KEYS as [AuditCategory, ...AuditCategory[]]).optional(),
  action: z.string().max(100).optional(),
  /** Matches the acting person's name or email/username. */
  q: z.string().trim().max(100).optional(),
  actorUserId: z.coerce.number().int().positive().optional(),
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});

/** One audit log entry. Metadata holds ids, field names and reasons only — never passwords or free text. */
export interface AuditEventItem {
  id: number;
  action: string;
  createdAt: string;
  actor: { id: number; displayName: string; identifier: string } | null;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  requestId: string | null;
}
