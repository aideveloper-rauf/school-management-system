# Backup and restore runbook

**Applies to:** v0.1.0+ (migrations 0001–0004) · **Last rehearsed:** 23 November 2026, local MySQL 8.4 (dev data:
14 tables, 84 rows; restored copy signed in and served data). Rehearse again on the real hosting plan before go-live.

## What a backup contains

- Every database table from **one consistent moment** (a read-only snapshot; the school keeps working meanwhile).
- The private file store (`STORAGE_DIR`), e.g. future uploads and submissions.
- **Not included, on purpose:** sign-in sessions, password-reset and invitation links, login attempts, queued jobs,
  and the development email outbox. After a restore everybody signs in again and old links do not work.
- The table structure is not dumped: restore rebuilds it with the app's own migrations.

The file (`sms-backup-YYYYMMDD-HHMMSSZ.smsbak`) is gzipped and encrypted with **AES-256-GCM**; the key comes from
`BACKUP_PASSPHRASE` (scrypt). Any change to the file, or a wrong passphrase, makes it unreadable — it is never
partly restored.

## One-time setup

1. Choose a passphrase of at least 16 characters (a long sentence is fine). Put it in the app's environment as
   `BACKUP_PASSPHRASE`, **and store a copy away from the server** (the principal's safe, a password manager).
   Without it the backups cannot be opened — the product team cannot recover it.
2. `BACKUP_DIR` must be outside `public_html` (default `../../backups` from `apps/api`). `BACKUP_KEEP` (default 14)
   is how many backups stay on the server.
3. Add a daily cron job (cPanel → Cron Jobs), e.g. 01:30:

   ```
   30 1 * * * cd ~/apps/sms/apps/api && /path/to/node dist/cli/backup.js >> ~/logs/sms-backup.log 2>&1
   ```

4. **Copy backups off the server** regularly (download from cPanel File Manager, or your provider's remote backup).
   A backup that only lives on the same hosting account does not survive losing that account.

## Routine checks

- *System status* (`GET /api/v1/ops/status`) shows `lastBackup` (time, file name, size). Alert if it is older than a day.
- Monthly, check a recent backup opens and is complete — this writes nothing:

  ```
  node dist/cli/verify-backup.js ../../backups/sms-backup-20270101-013000Z.smsbak
  ```

## Restore (disaster recovery or moving server)

Restore **always goes into a new, empty database**. It never overwrites the live one, so a mistake cannot make
things worse.

1. Put the app in a safe state: announce downtime; if the old server still runs, stop the cron jobs.
2. In cPanel → MySQL Databases, create a new empty database (utf8mb4), e.g. `school_sms_r1`, and give the app's
   database user all privileges on it.
3. Make sure the same release (or newer) of the app is installed. A backup from a **newer** release is refused.
4. With the environment pointing at the new database (`DB_NAME=school_sms_r1`) and the right `BACKUP_PASSPHRASE`:

   ```
   node dist/cli/verify-backup.js /path/to/sms-backup-….smsbak
   node dist/cli/restore.js /path/to/sms-backup-….smsbak
   ```

   Restore checks the whole file first, rebuilds the tables, loads all rows **in one transaction**, checks every
   table's row count, upgrades the schema to this release, and only then puts files into `STORAGE_DIR`.
   If anything fails it rolls back; drop the database and try again.
5. Point the live app at the new database (Setup Node.js App → environment `DB_NAME`), restart it, sign in as an
   administrator and spot-check: users, the academic year, classes. *System status* shows `lastRestore`.
6. Everyone signs in again (sessions are not restored). Pending invitations and reset links must be sent again.
7. Keep the old database until the school confirms the restored copy is right, then remove it.

## Rehearsal (do this at go-live and every term)

Restore the latest backup into a throw-away database exactly as above, sign in against it, compare a few counts
with the live system, then drop it. Record the date at the top of this file.

## Limits (current)

- Backups are full each time (no incrementals); fine for one school's data, revisit if files grow large.
- Large uploaded files are carried inside the backup; very large file stores will make backups slow.
- There is no download button in the admin screens yet; copy files off the server with the hosting tools.
