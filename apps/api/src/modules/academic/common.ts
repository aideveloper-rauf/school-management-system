import type { FastifyRequest } from 'fastify';
import { idParamSchema } from '@sms/shared';
import { requirePermission } from '../../plugins/auth.js';

/** Every academic-structure read/write uses these coarse gates. School-wide config has no record scope. */
export const canRead = requirePermission('academic.structure.read');
export const canManage = requirePermission('academic.structure.manage');

export const toDbBool = (b: boolean): number => (b ? 1 : 0);
export const fromDbBool = (n: number | boolean): boolean => Boolean(n);

/** Parsed `:id` route param. */
export const routeId = (req: FastifyRequest): number => idParamSchema.parse(req.params).id;

/** Field names present in a partial update, for audit metadata (names only, never values). */
export const changedFields = (input: object): string[] => Object.keys(input).sort();

/** Copy `input[key]` to `row[column]` only when the key was supplied (PATCH semantics). */
export function setIfPresent<I extends object, R extends object>(
  row: R,
  input: I,
  key: keyof I,
  column: keyof R,
  transform: (v: never) => unknown = (v) => v,
): void {
  if (Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined) {
    (row as Record<PropertyKey, unknown>)[column] = transform(input[key] as never);
  }
}
