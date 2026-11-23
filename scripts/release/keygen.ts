/**
 * Create the product team's release signing key pair (do this once, on a trusted machine):
 *   npm run release:keygen -- --out ~/sms-release-signing.key
 *
 * Writes the PRIVATE key to --out (permissions 600; never inside the repository; keep an offline
 * copy) and prints the PUBLIC key entry to add to apps/api/src/release/trusted-keys.ts.
 */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fingerprintOf, generateSigningKeyPair } from '../../apps/api/src/release/release.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const { values } = parseArgs({ options: { out: { type: 'string' }, label: { type: 'string', default: 'Product team release key' } } });
if (!values.out) {
  console.error('Usage: release:keygen -- --out <private key file outside the repository> [--label "..."]');
  process.exit(1);
}
const out = path.resolve(values.out);
if (out.startsWith(root + path.sep)) {
  console.error('Refusing to write a private key inside the repository folder.');
  process.exit(1);
}
if (existsSync(out)) {
  console.error(`${out} already exists. Not overwriting a signing key.`);
  process.exit(1);
}
const k = generateSigningKeyPair();
await writeFile(out, k.privateKeyPem, { mode: 0o600, flag: 'wx' });
console.log(`Private key written to ${out} — keep it secret and keep an offline copy.\n`);
console.log('Add this entry to TRUSTED_RELEASE_KEYS in apps/api/src/release/trusted-keys.ts:\n');
console.log(
  `  {\n    keyId: '${k.keyId}',\n    label: '${values.label} (${new Date().toISOString().slice(0, 10)})',\n    publicKeyPem: \`${k.publicKeyPem.trim()}\`,\n  },\n`,
);
console.log(`Fingerprint (give this to schools for a first install):\n  ${fingerprintOf(k.publicKeyPem)}`);
