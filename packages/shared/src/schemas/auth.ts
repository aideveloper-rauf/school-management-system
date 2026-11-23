import { z } from 'zod';
import { LOCALES } from '../locales.js';
import { ROLES } from '../roles.js';

export const loginRequestSchema = z.object({
  /** Email or school-issued username. */
  identifier: z.string().trim().min(1).max(191),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Minimum password policy for new/changed passwords. */
export const newPasswordSchema = z.string().min(10).max(256);

export const sessionUserSchema = z.object({
  id: z.number().int().positive(),
  displayName: z.string(),
  roles: z.array(z.enum(ROLES)),
  locale: z.enum(LOCALES),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export interface SessionResponse {
  user: SessionUser;
  permissions: string[];
  csrfToken: string;
}
