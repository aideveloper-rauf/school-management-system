import { z } from 'zod';
import { LOCALES } from '../locales.js';
import { ROLES, type Role } from '../roles.js';
import { paginationQuerySchema } from './common.js';
import { newPasswordSchema } from './auth.js';

export const USER_STATUSES = ['active', 'disabled', 'invited'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Identifiers are an email or a school-issued username; stored lower-case. */
export const identifierSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(191)
  .regex(/^[a-z0-9._@+-]+$/, 'Letters, digits and . _ @ + - only');

export const isEmailIdentifier = (identifier: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);

const rolesSchema = z
  .array(z.enum(ROLES))
  .max(ROLES.length)
  .refine((r) => new Set(r).size === r.length, 'Duplicate role');

/**
 * Create a user either by email invitation (they choose a password via the emailed link) or
 * with a temporary password the administrator hands over (they must change it on first sign-in).
 * Students and others without email use the temporary-password route.
 */
export const createUserSchema = z.discriminatedUnion('onboarding', [
  z.object({
    onboarding: z.literal('invite'),
    identifier: identifierSchema.refine(isEmailIdentifier, 'An invitation needs an email address'),
    displayName: z.string().trim().min(1).max(191),
    locale: z.enum(LOCALES).default('en'),
    roles: rolesSchema.default([]),
  }),
  z.object({
    onboarding: z.literal('temporary_password'),
    identifier: identifierSchema,
    displayName: z.string().trim().min(1).max(191),
    locale: z.enum(LOCALES).default('en'),
    roles: rolesSchema.default([]),
    temporaryPassword: newPasswordSchema,
  }),
]);
export type CreateUser = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(191),
    locale: z.enum(LOCALES),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const setUserRolesSchema = z.object({ roles: rolesSchema });

export const setTemporaryPasswordSchema = z.object({ temporaryPassword: newPasswordSchema });

export const userListQuerySchema = paginationQuerySchema.extend({
  /** Matches identifier or display name (prefix/contains). */
  q: z.string().trim().max(100).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
});

export interface UserItem {
  id: number;
  identifier: string;
  displayName: string;
  locale: string;
  status: UserStatus;
  roles: Role[];
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// Self-service ----------------------------------------------------------------
export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(256), newPassword: newPasswordSchema })
  .refine((v) => v.newPassword !== v.currentPassword, { message: 'Choose a different password', path: ['newPassword'] });

export const passwordResetRequestSchema = z.object({ identifier: z.string().trim().toLowerCase().min(1).max(191) });

/** Tokens are 43-char base64url strings; bound the length to avoid hashing huge inputs. */
const tokenSchema = z
  .string()
  .min(20)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const passwordResetConfirmSchema = z.object({ token: tokenSchema, newPassword: newPasswordSchema });
export const acceptInvitationSchema = z.object({ token: tokenSchema, password: newPasswordSchema });
