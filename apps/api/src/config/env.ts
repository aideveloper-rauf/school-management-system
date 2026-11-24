import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1).default('school_sms'),
  DB_USER: z.string().min(1).default('school_sms'),
  DB_PASSWORD: z.string().default(''),
  SESSION_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(7 * 24 * 60)
    .default(480),
  STORAGE_DIR: z.string().default('../../storage'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  COOKIE_SECURE: bool,
  FEATURE_AI: bool,
  // Outgoing email (invitations, password resets). "file" writes messages to STORAGE_DIR/outbox for development.
  MAIL_TRANSPORT: z.enum(['file', 'smtp']).default('file'),
  MAIL_FROM: z.string().min(3).default('School <no-reply@localhost>'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  // SMS (absence notices, announcements). "none" = off; "file" writes to STORAGE_DIR/outbox/sms; "http" = gateway.
  SMS_TRANSPORT: z.enum(['none', 'file', 'http']).default('none'),
  SMS_HTTP_URL: z.string().default(''),
  SMS_HTTP_TOKEN: z.string().default(''),
  SMS_SENDER_ID: z.string().max(11).default(''),
  // Backups: encrypted with a passphrase the school keeps (never stored by the product).
  BACKUP_DIR: z.string().default('../../backups'),
  BACKUP_KEEP: z.coerce.number().int().min(1).max(365).default(14),
  BACKUP_PASSPHRASE: z.string().default(''),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Print only variable names, never values (they may be secrets).
    const names = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production' && !cfg.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production (serve over HTTPS).');
  }
  if (cfg.MAIL_TRANSPORT === 'smtp' && !cfg.SMTP_HOST) {
    throw new Error('SMTP_HOST is required when MAIL_TRANSPORT=smtp.');
  }
  if (cfg.SMS_TRANSPORT === 'http' && !/^https:\/\//.test(cfg.SMS_HTTP_URL)) {
    throw new Error('SMS_HTTP_URL must be an https:// URL when SMS_TRANSPORT=http.');
  }
  return cfg;
}
