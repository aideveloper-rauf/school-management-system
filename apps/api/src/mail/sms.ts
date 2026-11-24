import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { AppConfig } from '../config/env.js';

/**
 * SMS adapters (roadmap N-1). Core workflows never depend on SMS: sends happen in queued jobs and failures are
 * logged and retried.
 *
 * - `none`: SMS switched off (sends are logged as skipped).
 * - `file`: development; writes each message to STORAGE_DIR/outbox/sms.
 * - `http`: a generic JSON-over-HTTPS gateway: POST SMS_HTTP_URL with
 *   `{ "to": "+9477…", "message": "…", "sender": SMS_SENDER_ID }` and `Authorization: Bearer SMS_HTTP_TOKEN`.
 *   Sri Lankan gateways differ in field names; confirm the chosen provider's API and adapt `httpSms` before
 *   go-live (P0-9 decides the provider). Never log the token or the message.
 */
export interface SmsSender {
  readonly enabled: boolean;
  send(to: string, message: string): Promise<void>;
}

export function noSms(): SmsSender {
  return {
    enabled: false,
    async send() {
      throw new Error('SMS is not configured');
    },
  };
}

export function fileSms(cfg: Pick<AppConfig, 'STORAGE_DIR'>): SmsSender & { dir: string } {
  const dir = path.resolve(cfg.STORAGE_DIR, 'outbox', 'sms');
  return {
    enabled: true,
    dir,
    async send(to, message) {
      await mkdir(dir, { recursive: true });
      const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.txt`;
      await writeFile(path.join(dir, name), `To: ${to}\n\n${message}\n`, { mode: 0o600 });
    },
  };
}

export function httpSms(cfg: Pick<AppConfig, 'SMS_HTTP_URL' | 'SMS_HTTP_TOKEN' | 'SMS_SENDER_ID'>): SmsSender {
  return {
    enabled: true,
    async send(to, message) {
      const res = await fetch(cfg.SMS_HTTP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.SMS_HTTP_TOKEN && { authorization: `Bearer ${cfg.SMS_HTTP_TOKEN}` }) },
        body: JSON.stringify({ to, message, sender: cfg.SMS_SENDER_ID }),
        signal: AbortSignal.timeout(15_000),
      });
      // Status only: provider bodies can echo the number or message.
      if (!res.ok) throw new Error(`SMS gateway returned HTTP ${res.status}`);
    },
  };
}

export function createSms(cfg: AppConfig): SmsSender {
  if (cfg.SMS_TRANSPORT === 'http') return httpSms(cfg);
  if (cfg.SMS_TRANSPORT === 'file') return fileSms(cfg);
  return noSms();
}

/** Sri Lankan numbers to E.164: 0771234567 / 771234567 / 94771234567 → +94771234567. Others kept if already +E.164. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  const d = digits.replace(/^\+/, '');
  if (/^94\d{9}$/.test(d)) return `+${d}`;
  if (/^0\d{9}$/.test(d)) return `+94${d.slice(1)}`;
  if (/^7\d{8}$/.test(d)) return `+94${d}`;
  return null;
}

/** "chandima@example.lk" → "c*******@example.lk"; "+94771234567" → "+9477*****67". */
export function maskAddress(addr: string): string {
  if (addr.includes('@')) {
    const [user, domain] = addr.split('@');
    return `${user!.slice(0, 1)}${'*'.repeat(Math.max(1, user!.length - 1))}@${domain}`.slice(0, 64);
  }
  return addr.length > 7 ? `${addr.slice(0, 5)}${'*'.repeat(addr.length - 7)}${addr.slice(-2)}` : '***';
}
