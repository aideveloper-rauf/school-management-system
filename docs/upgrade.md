# Installing and upgrading from a signed release

Releases are a signed package: `sms-<version>.tar.gz` plus `sms-<version>.manifest.json` and its signature
`sms-<version>.manifest.json.sig`. **Never install a package whose signature does not verify.** Nothing here needs
internet access on the server: the package contains everything (no `npm install`).

## What is in a package

```
sms-<version>/
  api/       server.js (Passenger startup file), cli/*.js, chunks/, package.json, .env.example
  web/       the website for public_html (includes .htaccess)
  docs/      deployment.md, upgrade.md (this file), backup-restore.md
  release.json   version, database changes and Node.js requirement
```

## 1. Verify the package

Verification uses the release keys built into the installation you already have:

```
cd ~/apps/sms/current/api
node cli/verify-release.js ~/uploads/sms-1.2.0.manifest.json --archive ~/uploads/sms-1.2.0.tar.gz
```

It must print `Signature OK` and `Package OK`. After extracting (step 3) you can also check every file:
`--dir ~/apps/sms/sms-1.2.0`.

**First install only** (no installation yet to verify with): on any computer with Node.js 22+, extract the package and
run `node sms-1.2.0/api/cli/verify-release.js sms-1.2.0.manifest.json --public-key product-team.pub.pem`. It prints the
key's fingerprint: compare it **by phone or letter** with the fingerprint the product team gives you. Do not continue
if it differs.

## 2. Back up (upgrades only)

With the **current** release: `node --env-file=.env cli/backup.js`, then copy the new backup off the server
(see [backup-restore.md](backup-restore.md)).

## 3. Put the new release next to the old one

Keep releases side by side so going back is just switching folders:

```
~/apps/sms/sms-1.1.0/      current
~/apps/sms/sms-1.2.0/      new (extracted from the verified package)
~/apps/sms/storage/        private files (STORAGE_DIR) — shared, outside any release folder
~/apps/sms/backups/        backups (BACKUP_DIR) — shared
```

Copy your `.env` from the old `api/` folder to the new one (never from the package — it ships only `.env.example`).
Use absolute paths for `STORAGE_DIR` and `BACKUP_DIR` so they do not depend on the release folder.

## 4. Pre-flight check

From the **new** release:

```
cd ~/apps/sms/sms-1.2.0/api
node --env-file=.env cli/upgrade-check.js
```

It must end with `Result: ready to upgrade.` It stops you if the database is newer than this release, if there is
no backup from the last 24 hours, or if the Node.js version is not supported. It lists the database changes that will
be applied. It writes nothing.

## 5. Switch over (short downtime)

1. In **Setup Node.js App**, stop the app.
2. Apply database changes with the new release: `node --env-file=.env cli/migrate.js`.
3. Change the app's *Application root* to `apps/sms/sms-1.2.0/api` (startup file `server.js`), set the same environment
   variables, start the app. Update the cron jobs to the new folder (`run-jobs.js`, `backup.js`).
4. Replace the contents of `public_html` with `sms-1.2.0/web/` (keep a copy of the old files).
5. Check: `https://<school domain>/api/v1/health` shows `{"status":"ok"}`; sign in as an administrator; *System status*
   shows the new version and "Everything is working".

## 6. If something goes wrong

- **The app does not start or misbehaves, database unchanged** (the release had no database changes): point Setup
  Node.js App and `public_html` back to the old release folder and restart.
- **Database changes were applied**: database changes are designed to be backward compatible (expand, then contract in
  a later release), so the previous release usually still runs — switch back and report the problem. A code rollback
  does **not** undo database changes. If data is wrong, restore the backup from step 2 into a new database
  ([backup-restore.md](backup-restore.md)) and point the old release at it.

## For the product team: building and signing

```
npm run release:keygen -- --out ~/keys/sms-release.key     # once; add the printed public key to trusted-keys.ts
npm run release -- --key ~/keys/sms-release.key            # from a clean, committed checkout
```

The build refuses uncommitted changes, a private key inside the repository, and mismatched version numbers. Output is in
`release/`. `npm run release -- --unsigned` makes a test package that verification rejects.
