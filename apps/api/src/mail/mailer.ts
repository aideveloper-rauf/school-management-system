import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../config/env.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
}

/** Mail adapter. Core workflows never depend on it: failures are retried by the job queue. */
export interface Mailer {
  send(message: OutgoingEmail): Promise<void>;
}

/**
 * Development adapter: writes each message to STORAGE_DIR/outbox as a .txt file (mode 0600).
 * Messages may contain one-time links, so the outbox is private storage, never logs.
 */
export function fileMailer(cfg: Pick<AppConfig, 'STORAGE_DIR' | 'MAIL_FROM'>): Mailer & { dir: string } {
  const dir = path.resolve(cfg.STORAGE_DIR, 'outbox');
  return {
    dir,
    async send(m) {
      await mkdir(dir, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.txt`;
      const body = `From: ${cfg.MAIL_FROM}\nTo: ${m.to}\nSubject: ${m.subject}\n\n${m.text}\n`;
      await writeFile(path.join(dir, name), body, { mode: 0o600 });
    },
  };
}

export function smtpMailer(cfg: AppConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: cfg.SMTP_HOST,
    port: cfg.SMTP_PORT,
    secure: cfg.SMTP_SECURE,
    ...(cfg.SMTP_USER && { auth: { user: cfg.SMTP_USER, pass: cfg.SMTP_PASSWORD } }),
  });
  return {
    async send(m) {
      await transport.sendMail({ from: cfg.MAIL_FROM, to: m.to, subject: m.subject, text: m.text });
    },
  };
}

export function createMailer(cfg: AppConfig): Mailer {
  return cfg.MAIL_TRANSPORT === 'smtp' ? smtpMailer(cfg) : fileMailer(cfg);
}
