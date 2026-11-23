/**
 * First-run setup: creates the installation's school record and the first
 * school_admin account. Safe to run only once — refuses if an admin exists.
 *
 *   npm run setup:admin -- --school "Example College" --email admin@example.lk --name "Admin Name"
 * The password is read from the terminal (not from argv, which leaks into shell history).
 */
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { newPasswordSchema } from '@sms/shared';
import { loadConfig } from '../config/env.js';
import { createDb } from '../db/client.js';
import { hashPassword } from '../lib/password.js';
import { recordAudit } from '../lib/audit.js';

const { values } = parseArgs({
  options: { school: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' } },
});
if (!values.school || !values.email || !values.name) {
  console.error('Usage: setup:admin -- --school "<school name>" --email <email> --name "<display name>"');
  process.exit(1);
}

const db = createDb(loadConfig());
try {
  const existing = await db.selectFrom('user_roles').select('user_id').where('role', '=', 'school_admin').executeTakeFirst();
  if (existing) {
    console.error('A school administrator already exists. Use the admin panel to add users.');
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = process.env.INITIAL_ADMIN_PASSWORD ?? (await rl.question('Password (min 10 chars): '));
  rl.close();
  const parsed = newPasswordSchema.safeParse(password);
  if (!parsed.success) {
    console.error('Password must be at least 10 characters.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(parsed.data);
  await db.transaction().execute(async (trx) => {
    const school = await trx.selectFrom('schools').select('id').executeTakeFirst();
    if (!school) await trx.insertInto('schools').values({ name: values.school!, default_locale: 'en', timezone: 'Asia/Colombo' }).execute();
    const res = await trx.insertInto('users').values({
      identifier: values.email!.trim().toLowerCase(),
      display_name: values.name!,
      password_hash: passwordHash,
      locale: 'en',
      status: 'active',
      password_changed_at: new Date(),
    }).executeTakeFirstOrThrow();
    const userId = Number(res.insertId);
    await trx.insertInto('user_roles').values({ user_id: userId, role: 'school_admin', granted_by: null }).execute();
    await recordAudit(trx, null, { action: 'setup.first_admin_created', actorUserId: null, entityType: 'user', entityId: userId });
  });
  console.log('School and first administrator created. You can now sign in.');
} finally {
  await db.destroy();
}
