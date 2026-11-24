import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { idParamSchema } from '@sms/shared';

export const routeId = (req: FastifyRequest): number => idParamSchema.parse(req.params).id;

/** `/students/:id/guardians/:guardianId` style params. */
export const pairParams = (req: FastifyRequest, second: string): { id: number; other: number } => {
  const params = req.params as Record<string, unknown>;
  const n = z.coerce.number().int().positive();
  return { id: n.parse(params.id), other: n.parse(params[second]) };
};

/** `%text%` with LIKE wildcards escaped. */
export const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Field names present in a partial update, for audit metadata (names only, never values). */
export const changedFields = (input: object): string[] => Object.keys(input).sort();

export const actorId = (req: FastifyRequest): number => req.auth!.user.id;

/** YYYY-MM-DD of the day before `iso`. */
export function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Today in the given IANA timezone, as YYYY-MM-DD. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
