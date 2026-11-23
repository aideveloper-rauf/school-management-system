// Fails if the web app uses a literal translation key that en.json does not define.
// (si/ta fall back to English, so en.json must be complete.) Run by `npm run lint`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'apps', 'web', 'src');
const en = JSON.parse(readFileSync(path.join(root, 'i18n', 'locales', 'en.json'), 'utf8'));
const has = (key) => key.split('.').reduce((o, p) => (o && typeof o === 'object' ? o[p] : undefined), en) !== undefined;

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f)) files.push(p);
  }
})(root);

const missing = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) if (!has(m[1])) missing.push(`${m[1]}  (${path.relative(root, file)})`);
  for (const m of src.matchAll(/(?:labelKey|titleKey): '([A-Za-z0-9_.]+)'/g))
    if (!has(m[1])) missing.push(`${m[1]}  (${path.relative(root, file)})`);
}

if (missing.length) {
  console.error(`Missing translation keys in en.json:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}
console.log(`i18n: ${files.length} files checked, all literal keys exist in en.json`);
