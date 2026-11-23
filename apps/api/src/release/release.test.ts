import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ReleaseError,
  fingerprintOf,
  generateSigningKeyPair,
  isMigrationPrefix,
  keyIdOf,
  sha256File,
  signBytes,
  verifyArchive,
  verifyManifest,
  verifyTree,
  type ReleaseManifest,
} from './release.js';
import type { TrustedKey } from './trusted-keys.js';

let dir: string;
const key = generateSigningKeyPair();
const other = generateSigningKeyPair();
const trusted: TrustedKey[] = [{ keyId: key.keyId, label: 'test', publicKeyPem: key.publicKeyPem }];

async function makeRelease() {
  const pkg = path.join(dir, 'pkg');
  await mkdir(path.join(pkg, 'api'), { recursive: true });
  await writeFile(path.join(pkg, 'api', 'server.js'), 'console.log("hi")');
  await writeFile(path.join(pkg, 'README.txt'), 'read me');
  const archive = path.join(dir, 'sms-1.0.0.tar.gz');
  await writeFile(archive, 'pretend archive bytes');
  const manifest: ReleaseManifest = {
    format: 1,
    product: 'school-management-system',
    version: '1.0.0',
    createdAt: '2027-01-01T00:00:00.000Z',
    gitCommit: null,
    node: '>=22.12',
    migrations: ['0001_a', '0002_b'],
    archive: { file: 'sms-1.0.0.tar.gz', bytes: 21, sha256: await sha256File(archive) },
    files: {
      'README.txt': await sha256File(path.join(pkg, 'README.txt')),
      'api/server.js': await sha256File(path.join(pkg, 'api', 'server.js')),
    },
    keyId: key.keyId,
  };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2));
  return { pkg, archive, manifest, bytes, sig: signBytes(bytes, key.privateKeyPem) };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'sms-release-test-'));
});
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe('release signing', () => {
  it('derives a stable key id and a readable fingerprint', () => {
    expect(keyIdOf(key.publicKeyPem)).toBe(key.keyId);
    expect(key.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprintOf(key.publicKeyPem)).toMatch(/^([0-9a-f]{4} ){15}[0-9a-f]{4}$/);
  });

  it('accepts a correctly signed manifest from a trusted key', async () => {
    const r = await makeRelease();
    expect(verifyManifest(r.bytes, r.sig, trusted).version).toBe('1.0.0');
  });

  it('rejects a changed manifest, a signature by another key, and unknown keys', async () => {
    const r = await makeRelease();
    const changed = Buffer.from(r.bytes.toString().replace('"1.0.0"', '"1.0.1"'));
    expect(() => verifyManifest(changed, r.sig, trusted)).toThrow(/signature does not match/);

    const forged = signBytes(r.bytes, other.privateKeyPem);
    expect(() => verifyManifest(r.bytes, forged, trusted)).toThrow(ReleaseError);

    const otherManifest = Buffer.from(r.bytes.toString().replace(key.keyId, other.keyId));
    expect(() => verifyManifest(otherManifest, signBytes(otherManifest, other.privateKeyPem), trusted)).toThrow(/unknown key/);
    expect(() => verifyManifest(r.bytes, r.sig, [])).toThrow(/No trusted release keys/);
    expect(() => verifyManifest(r.bytes, 'not-base64!!', trusted)).toThrow(ReleaseError);
  });

  it('rejects a trusted-key entry whose id does not match its key', async () => {
    const r = await makeRelease();
    const bad: TrustedKey[] = [{ keyId: key.keyId, label: 'swapped', publicKeyPem: other.publicKeyPem }];
    expect(() => verifyManifest(r.bytes, r.sig, bad)).toThrow(/inconsistent/);
  });

  it('checks the archive bytes against the manifest', async () => {
    const r = await makeRelease();
    await expect(verifyArchive(r.manifest, r.archive)).resolves.toBeUndefined();
    await writeFile(r.archive, 'pretend archive byteZ');
    await expect(verifyArchive(r.manifest, r.archive)).rejects.toThrow(/does not match/);
  });

  it('finds changed, missing and unexpected files in an extracted package (ignoring .env)', async () => {
    const r = await makeRelease();
    expect(await verifyTree(r.manifest, r.pkg)).toEqual({ changed: [], missing: [], extra: [] });
    await writeFile(path.join(r.pkg, 'api', 'server.js'), 'console.log("evil")');
    await rm(path.join(r.pkg, 'README.txt'));
    await writeFile(path.join(r.pkg, 'api', 'backdoor.js'), 'x');
    await writeFile(path.join(r.pkg, 'api', '.env'), 'DB_PASSWORD=local');
    expect(await verifyTree(r.manifest, r.pkg)).toEqual({
      changed: ['api/server.js'],
      missing: ['README.txt'],
      extra: ['api/backdoor.js'],
    });
  });

  it('accepts only databases whose migrations are a prefix of the release', () => {
    expect(isMigrationPrefix([], ['a', 'b'])).toBe(true);
    expect(isMigrationPrefix(['a'], ['a', 'b'])).toBe(true);
    expect(isMigrationPrefix(['a', 'b', 'c'], ['a', 'b'])).toBe(false); // database is newer than the code
    expect(isMigrationPrefix(['b'], ['a', 'b'])).toBe(false);
  });
});
