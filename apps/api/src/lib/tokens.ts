import { createHash, randomBytes } from 'node:crypto';

export const newToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');
export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');
export const newCsrfToken = (): string => randomBytes(32).toString('hex');
