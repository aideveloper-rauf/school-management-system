import { describe, expect, it } from 'vitest';
import { MAX_PAGE_SIZE } from '../api.js';
import { idParamSchema, isoDateSchema, pageWindow, paginationQuerySchema, toPaginated } from './common.js';

describe('pagination', () => {
  it('defaults and coerces query strings', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 50 });
    expect(paginationQuerySchema.parse({ page: '3', pageSize: '20' })).toEqual({ page: 3, pageSize: 20 });
  });

  it('rejects out-of-range values', () => {
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ pageSize: String(MAX_PAGE_SIZE + 1) }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: '1.5' }).success).toBe(false);
  });

  it('computes the SQL window and the response shape', () => {
    expect(pageWindow({ page: 3, pageSize: 20 })).toEqual({ limit: 20, offset: 40 });
    expect(toPaginated(['a'], '41', { page: 3, pageSize: 20 })).toEqual({ items: ['a'], page: 3, pageSize: 20, total: 41 });
  });
});

describe('idParamSchema', () => {
  it('accepts positive integers only', () => {
    expect(idParamSchema.parse({ id: '7' })).toEqual({ id: 7 });
    for (const id of ['0', '-1', 'abc', '1e3x']) expect(idParamSchema.safeParse({ id }).success, id).toBe(false);
  });
});

describe('isoDateSchema', () => {
  it('accepts real calendar dates', () => {
    for (const d of ['2026-01-01', '2028-02-29', '2026-12-31']) expect(isoDateSchema.safeParse(d).success, d).toBe(true);
  });

  it('rejects malformed or impossible dates', () => {
    for (const d of ['2026-02-31', '2027-02-29', '2026-13-01', '2026-1-1', '26-01-01', '']) {
      expect(isoDateSchema.safeParse(d).success, d).toBe(false);
    }
  });
});
