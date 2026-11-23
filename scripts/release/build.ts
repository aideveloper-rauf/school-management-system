/**
 * Build a signed release package.
 *
 *   npm run release -- --key <path to private signing key>      (or RELEASE_SIGNING_KEY_FILE)
 *   npm run release -- --unsigned                                (local testing only)
 *
 * Output in release/:  sms-<v>.tar.gz, sms-<v>.manifest.json, sms-<v>.manifest.json.sig, sms-<v>.tar.gz.sha256
 *
 * The API is bundled with esbuild into self-contained files: the server needs no node_modules and no
 * `npm install` (works on cPanel without outbound internet). Package layout:
 *   sms-<v>/api/   server.js (Passenger startup file), cli/*.js, chunks/, package.json, .env.example
 *   sms-<v>/web/   static site for public_html (includes .htaccess)
 *   sms-<v>/docs/  deployment, upgrade, backup-restore guides
 *   sms-<v>/release.json  version, migrations and Node.js requirement (informational copy)
 */
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { migrationProvider } from '../../apps/api/src/db/migrations/index.js';
import { keyIdOf, listFiles, sha256File, signBytes, type ReleaseManifest } from '../../apps/api/src/release/release.js';
import { APP_VERSION } from '../../apps/api/src/version.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const { values } = parseArgs({
  options: { key: { type: 'string' }, unsigned: { type: 'boolean', default: false }, 'skip-build': { type: 'boolean', default: false } },
});

const readJson = async (p: string) =>
  JSON.parse(await readFile(path.join(root, p), 'utf8')) as { version: string; engines?: { node?: string } };
const fail = (msg: string): never => {
  console.error(`Release build FAILED: ${msg}`);
  process.exit(1);
};

// 1. One version everywhere.
const rootPkg = await readJson('package.json');
const version = rootPkg.version;
for (const p of ['apps/api/package.json', 'apps/web/package.json', 'packages/shared/package.json']) {
  if ((await readJson(p)).version !== version) fail(`${p} version differs from ${version}.`);
}
if (APP_VERSION !== version) fail(`apps/api/src/version.ts says ${APP_VERSION}, package.json says ${version}.`);
const node = rootPkg.engines?.node ?? '>=22.12';

// 2. Signing key (checked before the slow work).
const keyFile = values.key ?? process.env.RELEASE_SIGNING_KEY_FILE;
if (!keyFile && !values.unsigned)
  fail('No signing key. Pass --key <file> (or RELEASE_SIGNING_KEY_FILE), or --unsigned for a local test build.');
const privateKeyPem = keyFile ? await readFile(keyFile, 'utf8') : null;
if (keyFile && path.resolve(keyFile).startsWith(root + path.sep)) fail('The private key must not live inside the repository folder.');

// 3. Fresh builds.
if (!values['skip-build']) execSync('npm run build', { cwd: root, stdio: 'inherit' });

const name = `sms-${version}`;
const outDir = path.join(root, 'release');
const staging = path.join(outDir, 'staging');
const pkgDir = path.join(staging, name);
await rm(staging, { recursive: true, force: true });
await mkdir(path.join(pkgDir, 'api'), { recursive: true });

// 4. API bundle.
const cli = ['migrate', 'create-admin', 'run-jobs', 'backup', 'verify-backup', 'restore', 'verify-release', 'upgrade-check'];
await build({
  entryPoints: {
    server: path.join(root, 'apps/api/src/server.ts'),
    ...Object.fromEntries(cli.map((c) => [`cli/${c}`, path.join(root, `apps/api/src/cli/${c}.ts`)])),
  },
  outdir: path.join(pkgDir, 'api'),
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  chunkNames: 'chunks/[name]-[hash]',
  legalComments: 'linked',
  logLevel: 'warning',
  // Some bundled CommonJS dependencies call require() for Node built-ins.
  banner: { js: "import { createRequire as __smsCreateRequire } from 'node:module'; const require = __smsCreateRequire(import.meta.url);" },
});
await writeFile(
  path.join(pkgDir, 'api', 'package.json'),
  `${JSON.stringify({ name: 'sms-api', version, private: true, type: 'module', main: 'server.js', engines: { node } }, null, 2)}\n`,
);
await cp(path.join(root, 'apps/api/.env.example'), path.join(pkgDir, 'api', '.env.example'));

// 5. Web build and docs.
await cp(path.join(root, 'apps/web/dist'), path.join(pkgDir, 'web'), { recursive: true });
await mkdir(path.join(pkgDir, 'docs'));
for (const d of ['deployment.md', 'upgrade.md', 'backup-restore.md']) await cp(path.join(root, 'docs', d), path.join(pkgDir, 'docs', d));

const migrations = Object.keys(await migrationProvider.getMigrations()).sort();
const createdAt = new Date().toISOString();
let gitCommit: string | null = null;
try {
  gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  if (execFileSync('git', ['status', '--porcelain'], { cwd: root }).toString().trim()) {
    if (!values.unsigned) fail('The working tree has uncommitted changes. Commit first so the release matches a commit.');
    gitCommit += '-dirty';
  }
} catch {
  /* not a git checkout */
}
await writeFile(path.join(pkgDir, 'release.json'), `${JSON.stringify({ version, createdAt, gitCommit, node, migrations }, null, 2)}\n`);

// 6. Per-file hashes, then the archive.
const files: Record<string, string> = {};
for (const f of await listFiles(pkgDir)) files[f] = await sha256File(path.join(pkgDir, f));
const archiveName = `${name}.tar.gz`;
const archive = path.join(outDir, archiveName);
await rm(archive, { force: true });
// Relative paths from inside release/: GNU tar would read 'E:\…' as a remote host.
const tar = spawnSync('tar', ['-czf', archiveName, '-C', 'staging', name], { cwd: outDir, stdio: 'inherit' });
if (tar.status !== 0) fail('tar failed (tar must be on PATH).');
const archiveSha = await sha256File(archive);
const archiveBytes = (await stat(archive)).size;
await writeFile(`${archive}.sha256`, `${archiveSha}  ${archiveName}\n`);

// 7. Manifest + signature.
const publicKeyId = privateKeyPem ? keyIdOf((await import('node:crypto')).createPublicKey(privateKeyPem)) : 'unsigned';
const manifest: ReleaseManifest = {
  format: 1,
  product: 'school-management-system',
  version,
  createdAt,
  gitCommit,
  node,
  migrations,
  archive: { file: archiveName, bytes: archiveBytes, sha256: archiveSha },
  files,
  keyId: publicKeyId,
};
const manifestFile = path.join(outDir, `${name}.manifest.json`);
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(manifestFile, manifestBytes);
await rm(`${manifestFile}.sig`, { force: true });
if (privateKeyPem) await writeFile(`${manifestFile}.sig`, `${signBytes(manifestBytes, privateKeyPem)}\n`);
await rm(staging, { recursive: true, force: true });

console.log(`\nRelease ${version} built:`);
console.log(`  ${path.relative(root, archive)}  (${(archiveBytes / 1048576).toFixed(2)} MB, ${Object.keys(files).length} files)`);
console.log(`  ${path.relative(root, manifestFile)}`);
console.log(privateKeyPem ? `  signed with key ${publicKeyId}` : '  UNSIGNED — for local testing only; schools must not install it.');
