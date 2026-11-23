import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LOCALES } from '@sms/shared';
import type { Db } from '../../db/client.js';
import { recordAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { requireAuth, requirePermission } from '../../plugins/auth.js';

const updateSchoolSchema = z
  .object({
    name: z.string().trim().min(2).max(191),
    shortName: z.string().trim().max(64).nullable(),
    defaultLocale: z.enum(LOCALES),
    timezone: z.string().min(1).max(64),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const schoolRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  /**
   * Public branding for the sign-in pages: the school's name only (already public information).
   * Nothing about people, settings or configuration.
   */
  app.get('/school/branding', { config: { public: true } }, async () => {
    const s = await db.selectFrom('schools').select(['name', 'short_name']).executeTakeFirst();
    return { name: s?.name ?? null, shortName: s?.short_name ?? null };
  });

  app.get('/school', { preHandler: requireAuth }, async () => {
    const s = await db.selectFrom('schools').select(['name', 'short_name', 'default_locale', 'timezone']).executeTakeFirst();
    if (!s) throw new AppError('SETUP_REQUIRED', 'errors.setupRequired');
    return { name: s.name, shortName: s.short_name, defaultLocale: s.default_locale, timezone: s.timezone };
  });

  app.patch('/school', { preHandler: requirePermission('school.settings.manage') }, async (req) => {
    const input = updateSchoolSchema.parse(req.body);
    const s = await db.selectFrom('schools').select('id').executeTakeFirst();
    if (!s) throw new AppError('SETUP_REQUIRED', 'errors.setupRequired');
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('schools')
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.shortName !== undefined && { short_name: input.shortName }),
          ...(input.defaultLocale !== undefined && { default_locale: input.defaultLocale }),
          ...(input.timezone !== undefined && { timezone: input.timezone }),
        })
        .where('id', '=', s.id)
        .execute();
      await recordAudit(trx, req, {
        action: 'school.settings.updated',
        entityType: 'school',
        entityId: s.id,
        metadata: { fields: Object.keys(input) },
      });
    });
    return { ok: true };
  });
};
