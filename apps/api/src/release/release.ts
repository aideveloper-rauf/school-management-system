import { createHash, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { TrustedKey } from './trusted-keys.js';

/**
 * Signed release packages.
 *
 *   sms-<version>.tar.gz              the package (api bundle, web build, docs)
 *   sms-<version>.manifest.json       what the package contains (hashes of the archive and every file)
 *   sms-<version>.manifest.json.sig   Ed25519 signature of the manifest's exact bytes (base64)
 *
 * Verification trusts only keys compiled into the installed release (trusted-keys.ts), or one the
 * operator passes explicitly after checking its fingerprint out of band (first install).
 */
export interface ReleaseManifest {
  format: 1;
  product: 'school-management-system';
  version: string;
  createdAt: string;
  gitCommit: string | null;
  /** Supported Node.js versions (package.json engines). */
  node: string;
  /** All migrations in this release, in order; the database must be at a prefix of this list. */
  migrations: string[];
  archive: { file: string; bytes: number; sha256: string };
  /** Every file in the package, path relative to the package root → sha256. */
  files: Record<string, string>;
  /** Signing key id (see keyIdOf). */
  keyId: string;
}

export class ReleaseError extends Error {}

/** Short, stable identifier of a public key: first 16 hex chars of sha256(SPKI DER). */
export function keyIdOf(publicKey: KeyObject | string): string {
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
  return createHash('sha256')
    .update(key.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);
}

/** Full fingerprint to compare by phone/letter when trusting a key for the first time. */
export function fingerprintOf(publicKeyPem: string): string {
  const hex = createHash('sha256')
    .update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }))
    .digest('hex');
  return hex.match(/.{4}/g)!.join(' ');
}

export function generateSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string; keyId: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: keyIdOf(publicKey),
  };
}

export function signBytes(data: Buffer, privateKeyPem: string): string {
  return sign(null, data, privateKeyPem).toString('base64');
}

export async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

/** All files under `dir` as POSIX relative paths, sorted. */
export async function listFiles(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(dir, r)));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

/**
 * Check the manifest signature and return the parsed manifest. The signing key must be trusted
 * and must be the key the manifest names.
 */
export function verifyManifest(manifestBytes: Buffer, signatureB64: string, trusted: TrustedKey[]): ReleaseManifest {
  let manifest: ReleaseManifest;
  try {
    manifest = JSON.parse(manifestBytes.toString('utf8')) as ReleaseManifest;
  } catch {
    throw new ReleaseError('The manifest is not valid JSON.');
  }
  if (manifest.format !== 1 || manifest.product !== 'school-management-system')
    throw new ReleaseError('Not a release manifest for this product.');
  const key = trusted.find((k) => k.keyId === manifest.keyId);
  if (!key) {
    throw new ReleaseError(
      trusted.length === 0
        ? 'No trusted release keys are configured. For a first install, pass --public-key after checking its fingerprint with the product team.'
        : `The release is signed with an unknown key (${manifest.keyId}). Do not install it.`,
    );
  }
  if (keyIdOf(key.publicKeyPem) !== key.keyId) throw new ReleaseError('Trusted key list is inconsistent (key id does not match key).');
  let ok: boolean;
  try {
    ok = verify(null, manifestBytes, key.publicKeyPem, Buffer.from(signatureB64.trim(), 'base64'));
  } catch {
    ok = false;
  }
  if (!ok)
    throw new ReleaseError('The signature does not match. The manifest was changed or not signed by the product team. Do not install it.');
  return manifest;
}

export async function verifyArchive(manifest: ReleaseManifest, archiveFile: string): Promise<void> {
  const s = await stat(archiveFile);
  if (s.size !== manifest.archive.bytes || (await sha256File(archiveFile)) !== manifest.archive.sha256) {
    throw new ReleaseError('The package file does not match the signed manifest (damaged or changed). Download it again.');
  }
}

/** Compare an extracted package folder with the manifest: reports changed, missing and unexpected files. */
export async function verifyTree(
  manifest: ReleaseManifest,
  dir: string,
): Promise<{ changed: string[]; missing: string[]; extra: string[] }> {
  const actual = new Set(await listFiles(dir));
  const changed: string[] = [];
  const missing: string[] = [];
  for (const [rel, hash] of Object.entries(manifest.files)) {
    if (!actual.has(rel)) missing.push(rel);
    else if ((await sha256File(path.join(dir, rel))) !== hash) changed.push(rel);
    actual.delete(rel);
  }
  // Local configuration is expected next to the code, never part of the package.
  const extra = [...actual].filter((f) => !/(^|\/)\.env$/.test(f));
  return { changed, missing, extra };
}

/** True when `migrations` (applied in a database) is an ordered prefix of the release's list. */
export function isMigrationPrefix(applied: string[], release: string[]): boolean {
  return applied.length <= release.length && applied.every((m, i) => release[i] === m);
}
