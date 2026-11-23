import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * scrypt via Node's built-in crypto: no native add-on to compile, which matters
 * on shared cPanel hosting. Parameters follow OWASP guidance (N=2^17, r=8, p=1).
 * Format: scrypt$N$r$p$saltB64$hashB64 — parameters are stored so they can be raised later.
 */
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function opts(n: number, r: number, p: number): ScryptOptions {
  return { N: n, r, p, maxmem: 256 * n * r };
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, opts(N, R, P));
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(
    password.normalize('NFKC'),
    Buffer.from(saltB64, 'base64'),
    expected.length,
    opts(Number(n), Number(r), Number(p)),
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function needsRehash(stored: string): boolean {
  const [alg, n, r, p] = stored.split('$');
  return alg !== 'scrypt' || Number(n) < N || Number(r) < R || Number(p) < P;
}

/** A hash of a random value, used to keep login timing similar for unknown users. */
export const DUMMY_HASH_PROMISE = hashPassword(randomBytes(16).toString('hex'));
