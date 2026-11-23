import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, type ScryptOptions } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { createGzip } from 'node:zlib';

/**
 * Encrypted backup container (".smsbak"):
 *
 *   SMSBAK/1\n
 *   <header JSON>\n            ← plaintext, but authenticated (GCM additional data)
 *   <AES-256-GCM ciphertext of gzip(payload)>
 *   <16-byte GCM tag>
 *
 * The key is derived from the school's passphrase with scrypt (salt in the header). Any change to
 * the header, ciphertext or tag makes decryption fail. Decryption writes to a temporary file and
 * only hands it over once the tag has been verified, so nothing is restored from unauthenticated data.
 */
export const MAGIC = 'SMSBAK/1';
const KDF = { N: 2 ** 17, r: 8, p: 1 } as const;
const TAG_BYTES = 16;
export const MIN_PASSPHRASE = 16;

export interface ContainerHeader {
  format: 1;
  createdAt: string;
  appVersion: string;
  schemaVersion: string | null;
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string };
  cipher: 'aes-256-gcm';
  iv: string;
}

export class BackupError extends Error {}

function deriveKey(passphrase: string, salt: Buffer, kdf: { N: number; r: number; p: number }): Promise<Buffer> {
  const opts: ScryptOptions = { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * kdf.N * kdf.r };
  return new Promise((resolve, reject) => scryptCb(passphrase.normalize('NFKC'), salt, 32, opts, (e, k) => (e ? reject(e) : resolve(k))));
}

export function assertPassphrase(passphrase: string): void {
  if (passphrase.length < MIN_PASSPHRASE) {
    throw new BackupError(`BACKUP_PASSPHRASE must be set and at least ${MIN_PASSPHRASE} characters.`);
  }
}

/** Write `payload` (plain JSON lines) to `file`, gzipped and encrypted. */
export async function writeContainer(
  file: string,
  passphrase: string,
  meta: Pick<ContainerHeader, 'createdAt' | 'appVersion' | 'schemaVersion'>,
  payload: Readable,
): Promise<void> {
  assertPassphrase(passphrase);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const header: ContainerHeader = {
    format: 1,
    ...meta,
    kdf: { name: 'scrypt', ...KDF, salt: salt.toString('base64') },
    cipher: 'aes-256-gcm',
    iv: iv.toString('base64'),
  };
  const headerBytes = Buffer.from(`${MAGIC}\n${JSON.stringify(header)}\n`, 'utf8');
  const cipher = createCipheriv('aes-256-gcm', await deriveKey(passphrase, salt, KDF), iv);
  cipher.setAAD(headerBytes);

  const out = createWriteStream(file, { mode: 0o600 });
  out.write(headerBytes);
  await pipeline(payload, createGzip({ level: 6 }), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (e?: Error | null) => (e ? reject(e) : resolve())));
}

/** Read and parse the header without the passphrase (for listings and compatibility checks). */
export async function readHeader(file: string): Promise<{ header: ContainerHeader; headerBytes: Buffer }> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const first = text.indexOf('\n');
    const second = first < 0 ? -1 : text.indexOf('\n', first + 1);
    if (first < 0 || second < 0 || text.slice(0, first) !== MAGIC) throw new BackupError('Not a backup file (unknown format).');
    const header = JSON.parse(text.slice(first + 1, second)) as ContainerHeader;
    if (header.format !== 1 || header.cipher !== 'aes-256-gcm' || header.kdf?.name !== 'scrypt')
      throw new BackupError('Unsupported backup format.');
    return { header, headerBytes: Buffer.from(text.slice(0, second + 1), 'utf8') };
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError('Not a backup file (unreadable header).');
  } finally {
    await fh.close();
  }
}

/**
 * Decrypt `file` into `plainFile` (gzipped JSON lines). Throws BackupError on a wrong passphrase or
 * any tampering; the partial output is deleted in that case.
 */
export async function decryptContainer(file: string, passphrase: string, plainFile: string): Promise<ContainerHeader> {
  const { header, headerBytes } = await readHeader(file);
  const size = (await stat(file)).size;
  const end = size - TAG_BYTES;
  if (end <= headerBytes.length) throw new BackupError('Backup file is truncated.');

  const fh = await open(file, 'r');
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    await fh.read(tag, 0, TAG_BYTES, end);
  } finally {
    await fh.close();
  }

  const key = await deriveKey(passphrase, Buffer.from(header.kdf.salt, 'base64'), header.kdf);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'));
  decipher.setAAD(headerBytes);
  decipher.setAuthTag(tag);
  try {
    await pipeline(
      createReadStream(file, { start: headerBytes.length, end: end - 1 }),
      decipher,
      createWriteStream(plainFile, { mode: 0o600 }),
    );
  } catch {
    await unlink(plainFile).catch(() => undefined);
    // GCM cannot tell a wrong passphrase from tampering; both mean "do not trust this file".
    throw new BackupError('Cannot decrypt the backup: wrong passphrase, or the file was changed or damaged.');
  }
  return header;
}
