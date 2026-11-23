// Fails if the web app uses a translation key that en.json does not define.
// (si/ta fall back to English, so en.json must be complete.) Run by `npm run lint`.
//
// Checked: literal t('a.b') calls, `labelKey`/`titleKey` properties, string literals that look
// like keys of a known top-level section ('dashboard.goodMorning'), and every role in ROLES for
// the dynamic `roles.*` / `roleHelp.*` lookups. Plural keys may exist only as key_one/key_other.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const root = path.join(repo, 'apps', 'web', 'src');
const en = JSON.parse(readFileSync(path.join(root, 'i18n', 'locales', 'en.json'), 'utf8'));
const lookup = (key) => key.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : undefined), en);
const has = (key) => lookup(key) !== undefined || (lookup(`${key}_one`) !== undefined && lookup(`${key}_other`) !== undefined);

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f)) files.push(p);
  }
})(root);

const rolesSrc = readFileSync(path.join(repo, 'packages', 'shared', 'src', 'roles.ts'), 'utf8');
const listOf = (name) =>
  [...(rolesSrc.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`))?.[1] ?? '').matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);
const roles = listOf('ROLES');
// Permission names ('users.read') look like keys of the `users` section but are not translation keys.
const permissions = new Set(listOf('PERMISSIONS'));

const sections = Object.keys(en).join('|');
const keyLike = new RegExp(`'((?:${sections})\\.[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)*)'`, 'g');

const missing = new Set();
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const where = path.relative(root, file);
  const check = (k) => !permissions.has(k) && !has(k) && missing.add(`${k}  (${where})`);
  for (const m of src.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) check(m[1]);
  for (const m of src.matchAll(/(?:labelKey|titleKey): '([A-Za-z0-9_.]+)'/g)) check(m[1]);
  for (const m of src.matchAll(keyLike)) check(m[1]);
}

// Dynamic lookups by role name.
for (const r of roles) for (const prefix of ['roles', 'roleHelp']) if (!has(`${prefix}.${r}`)) missing.add(`${prefix}.${r}  (roles)`);

if (missing.size) {
  console.error(`Missing translation keys in en.json:\n  ${[...missing].join('\n  ')}`);
  process.exit(1);
}
console.log(`i18n: ${files.length} files and ${roles.length} roles checked, all keys exist in en.json`);
