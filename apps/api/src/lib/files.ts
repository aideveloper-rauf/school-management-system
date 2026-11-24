import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReadStream } from 'node:fs';

/**
 * Private file storage (roadmap L-1). Files live under STORAGE_DIR/files, outside the web root, with
 * random names. The type is decided by sniffing the bytes against an allow-list — the browser's
 * Content-Type and the file name are not trusted (the extension only picks between ZIP-based Office
 * formats). HTML, SVG, scripts and executables are refused, so a download can never run in the browser.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const OOXML: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
};

const starts = (b: Buffer, bytes: number[], offset = 0) => bytes.every((v, i) => b[offset + i] === v);

/** Allowed MIME type for this content, or null when the file is not an accepted type. */
export function sniffMime(buf: Buffer, fileName: string): string | null {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  if (starts(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  if (starts(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(buf, [0x52, 0x49, 0x46, 0x46]) && starts(buf, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (starts(buf, [0x50, 0x4b, 0x03, 0x04])) return OOXML[ext] ?? null; // ZIP: only known office formats
  if (ext === 'txt' && !buf.includes(0)) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(buf);
      return 'text/plain; charset=utf-8';
    } catch {
      return null;
    }
  }
  return null;
}

/** Strip path parts and control characters; keep a readable name for downloads. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const clean = [...base]
    .map((ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f || '"<>|:*?'.includes(ch) ? '_' : ch))
    .join('')
    .trim()
    .slice(0, 150);
  return clean || 'file';
}

export function filesRoot(storageDir: string): string {
  return path.resolve(storageDir, 'files');
}

/** Write bytes under a new random key. Returns the key (relative path) and SHA-256. */
export async function writeStoredFile(storageDir: string, buf: Buffer): Promise<{ key: string; sha256: string }> {
  const id = randomBytes(16).toString('hex');
  const key = `${id.slice(0, 2)}/${id}.bin`;
  const full = path.join(filesRoot(storageDir), key);
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.partial`;
  await writeFile(tmp, buf, { mode: 0o600 });
  await rename(tmp, full);
  return { key, sha256: createHash('sha256').update(buf).digest('hex') };
}

/** Resolve a stored key to a path, refusing anything that escapes the files directory. */
export function storedFilePath(storageDir: string, key: string): string {
  const root = filesRoot(storageDir);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('bad storage key');
  return full;
}

export function openStoredFile(storageDir: string, key: string): ReadStream {
  return createReadStream(storedFilePath(storageDir, key));
}

export async function deleteStoredFile(storageDir: string, key: string): Promise<void> {
  await rm(storedFilePath(storageDir, key), { force: true });
}

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 name. */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
