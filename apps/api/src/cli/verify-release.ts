/**
 * Check a release before installing it:
 *   node cli/verify-release.js sms-1.2.0.manifest.json [--archive sms-1.2.0.tar.gz] [--dir ./sms-1.2.0]
 *       [--public-key product-team.pub.pem]
 *
 * Trusts only the keys built into this installed release. --public-key is for the very first install:
 * compare the printed fingerprint with the one the product team gives you (phone/letter) first.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { ReleaseError, fingerprintOf, keyIdOf, verifyArchive, verifyManifest, verifyTree } from '../release/release.js';
import { TRUSTED_RELEASE_KEYS, type TrustedKey } from '../release/trusted-keys.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { archive: { type: 'string' }, dir: { type: 'string' }, 'public-key': { type: 'string' } },
});
const manifestFile = positionals[0];
if (!manifestFile) {
  console.error('Usage: verify-release <manifest.json> [--archive <file>] [--dir <extracted folder>] [--public-key <pem>]');
  process.exit(1);
}

try {
  const trusted: TrustedKey[] = [...TRUSTED_RELEASE_KEYS];
  if (values['public-key']) {
    const pem = await readFile(values['public-key'], 'utf8');
    console.log(
      `Using the key given on the command line. Fingerprint:\n  ${fingerprintOf(pem)}\nOnly continue if this matches what the product team told you.`,
    );
    trusted.push({ keyId: keyIdOf(pem), label: 'command line', publicKeyPem: pem });
  }
  const manifestBytes = await readFile(manifestFile);
  const signature = await readFile(`${manifestFile}.sig`, 'utf8').catch(() => {
    throw new ReleaseError(`Signature file ${path.basename(manifestFile)}.sig is missing. Do not install an unsigned release.`);
  });
  const m = verifyManifest(manifestBytes, signature, trusted);
  console.log(`Signature OK: version ${m.version}, built ${m.createdAt}, key ${m.keyId}.`);

  const archive = values.archive ?? path.join(path.dirname(manifestFile), m.archive.file);
  if (values.archive || existsSync(archive)) {
    await verifyArchive(m, archive);
    console.log(`Package OK: ${path.basename(archive)} (${(m.archive.bytes / 1048576).toFixed(1)} MB) matches the manifest.`);
  }
  if (values.dir) {
    const r = await verifyTree(m, values.dir);
    if (r.changed.length || r.missing.length || r.extra.length) {
      for (const f of r.changed) console.error(`  changed:    ${f}`);
      for (const f of r.missing) console.error(`  missing:    ${f}`);
      for (const f of r.extra) console.error(`  unexpected: ${f}`);
      throw new ReleaseError('The extracted folder does not match the signed release. Extract it again from a verified package.');
    }
    console.log(`Folder OK: all ${Object.keys(m.files).length} files match.`);
  }
  if (!values.dir && !existsSync(archive)) console.log('Note: neither the package file nor an extracted folder was checked.');
  console.log(`Requires Node.js ${m.node}. Database changes in this release end at ${m.migrations.at(-1) ?? '(none)'}.`);
} catch (e) {
  console.error(`NOT VERIFIED: ${(e as Error).message}`);
  process.exitCode = 1;
}
