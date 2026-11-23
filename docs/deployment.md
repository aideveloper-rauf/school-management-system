# Deployment (draft — validate on the real hosting plan)

> Nothing here is a compatibility promise until it has been tested on the pilot school's actual cPanel plan
> (see the compatibility gate in the blueprint §11).

## Requirements to confirm with the host

- cPanel **Application Manager / "Setup Node.js App"** (Passenger) with Node.js 22 or 24 LTS.
- MySQL 8.0+ or MariaDB 10.6+, utf8mb4, InnoDB.
- HTTPS certificate on the school's (sub)domain.
- Cron (5-minute interval or better), outbound HTTPS (for mail/updates — optional), private storage outside `public_html`.
- Memory/process limits sufficient for one Node.js process (~150–250 MB) — to be measured.

## Layout on the account (example)

```
/home/USER/apps/sms/                 release (apps/api/dist, node_modules, package.json…)
/home/USER/apps/sms/apps/api/.env    secrets — not web-accessible, permissions 600
/home/USER/sms-storage/              private uploads (STORAGE_DIR)
/home/USER/public_html/              contents of apps/web/dist (incl. .htaccess)
```

## Steps

1. Build locally or in CI: `npm ci && npm run build`.
2. Upload the release (excluding `.env`, `node_modules` if the host installs them) to `~/apps/sms`.
3. In **Setup Node.js App**: application root `apps/sms/apps/api`, URL `/api` on the same domain as the web app,
   startup file `dist/server.js`, Node 22/24. Add environment variables from `.env.example`
   (`NODE_ENV=production`, `COOKIE_SECURE=true`, `APP_ORIGIN=https://school.example.lk`, DB settings).
   Run *NPM Install* from the panel.
4. Run migrations from the app's virtual environment shell: `node dist/cli/migrate.js`.
5. First admin: `node dist/cli/create-admin.js --school "…" --email … --name "…"` (prompts for the password).
6. Upload `apps/web/dist/*` (including `.htaccess`) to `public_html`.
7. Cron every 5 minutes: `cd ~/apps/sms/apps/api && <node path from the panel> dist/cli/run-jobs.js >> ~/logs/sms-jobs.log 2>&1`.
   Invitation and reset emails are sent by this cron job, so they arrive up to one interval later.
   Set `MAIL_TRANSPORT=smtp` and the `SMTP_*` variables (the host's mail server or a provider). With `MAIL_TRANSPORT=file`
   messages only land in `STORAGE_DIR/outbox`; schools without email can still use temporary passwords.
8. Verify: `https://school.example.lk/api/v1/health` returns `{"status":"ok"}`; sign in; check *System status*.

## Local (WAMP) notes

WAMP provides MySQL only; run the API with `npm run dev:api` and the web with `npm run dev:web` (Vite proxies `/api`).
To try the production web build under Apache, copy `apps/web/dist` to a WAMP vhost and reverse-proxy `/api` to `127.0.0.1:4000`
(`mod_proxy`, `ProxyPass /api http://127.0.0.1:4000/api`).

## Backups

Daily cron `node dist/cli/backup.js` with `BACKUP_PASSPHRASE` set; copy backups off the server. Full procedure,
restore and rehearsal: [backup-restore.md](backup-restore.md).

## Installing from a release package

Production installs use a signed package (no `npm install` on the server): verify it, then follow
[upgrade.md](upgrade.md). In that layout the API root is `sms-<version>/api`, the startup file is `server.js`, and the
CLIs are `node cli/<name>.js` (instead of `dist/cli/...`).

## Not yet implemented

In-app update client and maintenance mode — see `backlog.md` (Phase 1).
