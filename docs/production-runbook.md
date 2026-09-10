# Production Deployment Runbook

This runbook describes the safe release path for the Web Bookmarks Worker, D1 database, and rate-limit KV namespace. It assumes Node.js 22.13.0, as pinned by `.nvmrc`.

## 1. Preflight

Run all commands from the repository root. Do not deploy from a working tree whose migration files have not been reviewed.

```bash
nvm use
npm ci
npm run check
npm run check:migrations
node scripts/check_production_config.js
```

Before a schema change, create a database backup using the Cloudflare Dashboard or the Wrangler D1 export command supported by the installed Wrangler version. Store the export outside the Git repository and record its timestamp and database name.

```bash
npx wrangler d1 export DB --remote --output ./bookmarks-backup.sql
```

If the installed Wrangler version does not support this exact export syntax, stop and use the Dashboard export/backup flow instead of guessing a destructive command.

## 2. New D1 database

For a brand-new database, create the database, put its real ID in `wrangler.toml`, and apply the complete migration chain:

```bash
npx wrangler d1 create bookmarks-db
npm run check:migrations
npm run db:migrate:remote
npm run verify:remote-migrations
```

Do not run `schema.sql` and `db:migrate:remote` against the same new database unless you intentionally choose one initialization path and verify the resulting `d1_migrations` ledger.

## 3. Existing D1 database with data

Never run `npm run db:init:remote` or upload `schema.sql` to an existing production database. First inspect the migration ledger and schema:

```bash
npx wrangler d1 execute DB --remote --command \
  "SELECT name FROM d1_migrations ORDER BY name;"
npx wrangler d1 execute DB --remote --command \
  "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name;"
npx wrangler d1 execute DB --remote --command \
  "SELECT COALESCE(parent_id, 0) AS parent_key, name, COUNT(*) AS active_count, GROUP_CONCAT(id) AS folder_ids FROM folders WHERE is_deleted = 0 GROUP BY COALESCE(parent_id, 0), name HAVING COUNT(*) > 1;"
```

If `d1_migrations` is missing while application tables already exist, do not blindly replay migrations from `001`. Compare the actual columns, indexes, triggers, and data with the migration files. The initial schema and later `ALTER TABLE` migrations are not interchangeable. Reconcile the ledger only after each already-present schema object has been verified, and keep an audit record of any manual ledger repair.

The 013 migration adds a unique active sibling-folder name constraint. Resolve all active sibling duplicates before applying it; do not silently delete or merge folders. Decide and document the product policy for case, whitespace, and Unicode normalization before treating names as canonical.

After the schema is reconciled, apply only the remaining migrations and verify the ledger:

```bash
npm run db:migrate:remote
npm run verify:remote-migrations
```

If a Wrangler migration command reports an SQL parser error for a trigger migration, stop and inspect `d1_migrations` and `sqlite_master` before retrying. A failed migration can leave earlier migrations applied. Do not repeat the entire chain automatically.

## 4. Production secrets and bindings

The rate-limit KV namespace is required. Create it once, add its real ID to the active `[[kv_namespaces]]` block, and do not commit credentials or secret values.

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```

Set secrets interactively or through a protected CI environment:

```bash
openssl rand -base64 32
npx wrangler secret put SECRET_KEY
npx wrangler secret put INITIAL_ADMIN_PASSWORD
```

`SECRET_KEY` is mandatory for production: on a non-localhost host every request fails closed until it exists. Installations upgrading from a version that auto-generated a D1-managed `secret_key` must set the Worker secret **before** deploying this version — the new version no longer reads the D1-managed secret.

`INITIAL_ADMIN_PASSWORD` must be a unique strong password of at least 12 characters. Never use the local development fallback in production and never put the value in `.dev.vars`, `wrangler.toml`, GitHub logs, screenshots, or issue reports.

### Password pepper rotation

`PASSWORD_PEPPER` (optional but recommended) mixes a D1-external secret into the stored password hash, so a database-only leak cannot verify or crack it. Values are `<id>:<material>` with a unique alphanumeric id per rotation and `openssl rand -base64 32` as the material. Setting it is not upgrade-breaking: the next successful login migrates the stored hash to the peppered v4 format.

Rotate in this order — `wrangler secret put` deploys immediately and secret values cannot be read back afterwards, so keep the current full pepper in a password manager or secret manager first:

1. Write the **old** full value into `PASSWORD_PEPPER_PREVIOUS`. Every stored hash stays verifiable from this moment.
2. Write the fresh id and material into `PASSWORD_PEPPER`.
3. Log in once; the login re-hashes the stored hash to the new id.
4. Confirm the re-hash actually landed before touching `PREVIOUS` — the migration write fails silently by design. Query only the pepper id, never the hash:
   `npx wrangler d1 execute DB --remote --command "SELECT CASE WHEN value LIKE 'v4:k2:%' THEN 'migrated' ELSE 'not-migrated' END AS state FROM settings WHERE key = 'password';"`
   Retry the login until it reports `migrated`.
5. Remove `PASSWORD_PEPPER_PREVIOUS`.

Removing `PASSWORD_PEPPER` while v4 hashes exist locks the account — the recovery path is the password reset procedure (delete the `password` settings row, then re-initialize with `INITIAL_ADMIN_PASSWORD`). See `docs/password-v4-design.md` for the full format and semantics.

## 5. Release and smoke test

```bash
npm run check
npm run deploy:check
npm run deploy
npm run verify:remote-migrations
```

`deploy:check` is intentionally local-only (migration files and production bindings). `npm run deploy` applies pending remote migrations before publishing, so new code can never run against an outdated schema; the remote ledger is then confirmed after deployment with `verify:remote-migrations`, and a first deployment is never blocked by a database that has not been migrated yet.

After deployment, verify the public login page and an unauthenticated API response without submitting credentials:

```text
https://web-bookmarks.weirdstar.workers.dev/
https://web-bookmarks.weirdstar.workers.dev/api/data
```

The second URL should return an unauthorized response. Complete an authenticated CRUD smoke test only with a designated test account, and remove test data afterward.

## 6. CI and repository handoff

The normal CI workflow uses `.nvmrc` and checks the migration file set. The remote production configuration job is kept behind a protected `production` environment because it requires a Cloudflare API token. Configure `CLOUDFLARE_API_TOKEN` as a protected GitHub Actions secret before enabling that job.

Before merging, verify that every file in `migrations/` is tracked:

```bash
git ls-files migrations
git status --short
```

The working tree should be clean after the release commit, except for intentionally ignored local files such as `.dev.vars` and local database files.

## 7. D1 Time Travel incident recovery

Cloudflare D1 Time Travel is point-in-time recovery for databases on the production storage backend. It is always enabled; there is no backup switch to turn on. The retention window is plan-dependent: **7 days on Workers Free and 30 days on Workers Paid**. Time Travel is for short-horizon operational recovery; keep independent SQL exports when you need retention beyond that window.

A Time Travel restore overwrites the database **in place** and cancels in-flight queries and transactions. Never automate the restore command in CI, and do not repeatedly try timestamps until something looks right.

### 7.1 Establish the recovery point before changing data

First stop or minimize writes at the application/operator level. Record the incident time with an explicit timezone. Then verify that the database is on the supported backend:

```bash
npx wrangler d1 info DB
```

The output must report `version: production` before using this runbook. If it reports an older/unsupported backend, stop and use the backup mechanism appropriate to that database instead.

Capture the **current** bookmark before any restore. This is the primary rollback handle if the chosen recovery point is wrong:

```bash
npx wrangler d1 time-travel info DB
```

When practical, also export the current database state before restoring and store the export outside the repository:

```bash
npx wrangler d1 export DB --remote --output ./bookmarks-before-restore.sql
```

Resolve the intended incident timestamp to a bookmark before executing a destructive restore. Use RFC3339 with an explicit offset or `Z`; do not use an ambiguous local time:

```bash
npx wrangler d1 time-travel info DB --timestamp="2026-09-10T10:15:00Z"
```

Copy the returned target bookmark into the incident notes and independently verify that the timestamp is inside the plan's retention window.

### 7.2 Restore by the reviewed bookmark

After the target is agreed, restore by bookmark rather than retyping the timestamp:

```bash
npx wrangler d1 time-travel restore DB --bookmark="<TARGET_BOOKMARK>"
```

Wrangler requires interactive confirmation. Save the `previous bookmark` reported by the restore command; it represents the database state immediately before the restore and is the fastest way to undo a mistaken recovery.

Do not immediately run `npm run deploy` after a restore. That command applies pending migrations before publishing and may mutate the just-restored schema again.

### 7.3 Verify application/schema compatibility before reopening writes

Inspect the migration ledger and core schema after the restore:

```bash
npx wrangler d1 execute DB --remote --command \
  "SELECT name FROM d1_migrations ORDER BY name;"
npx wrangler d1 execute DB --remote --command \
  "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name;"
```

If the target point is **after** all migrations expected by the currently deployed Worker, run `npm run verify:remote-migrations` and then the normal authenticated smoke test.

If the target point predates a schema migration, the current Worker may no longer be compatible with the restored schema. Keep writes closed and pair the database restore with the last known Worker deployment that expects that schema, or deliberately re-apply reviewed migrations only after deciding that doing so is part of the recovery. Do not leave newer code serving an older schema by accident.

### 7.4 Undo a mistaken restore

If validation shows that the chosen recovery point was wrong, restore to the `previous bookmark` captured from the restore output:

```bash
npx wrangler d1 time-travel restore DB --bookmark="<PREVIOUS_BOOKMARK>"
```

A restore does not invalidate older bookmarks, so an earlier valid point can still be selected if necessary. D1 currently limits restore operations per database; treat restore attempts as controlled incident actions rather than an exploratory loop.

## 8. Workers compatibility-date maintenance

`compatibility_date` opts the Worker into backwards-incompatible runtime fixes and features through that date. Updating the file does **not** change the already deployed Worker; the new date takes effect on the next Worker deployment.

The repository keeps this date current through `.github/workflows/compatibility-date-review.yml`. The workflow runs monthly and fails its own scheduled check when `wrangler.toml` is more than 90 days old. It intentionally has read-only repository permissions and does not edit files, open PRs, or deploy anything automatically. Normal feature/hotfix PRs are not blocked merely because the scheduled reminder is stale.

Run the same check locally at any time:

```bash
node scripts/check_compatibility_date.js --max-age-days 90
```

When advancing the date:

1. Read Cloudflare's compatibility-flags history for every default change between the old and proposed dates.
2. Change `wrangler.toml` in a dedicated PR. Avoid mixing unrelated dependency or application changes into the same compatibility bump.
3. Run the normal quality gate and require `Browser smoke (Chromium)` to execute under the new date. The browser smoke starts `wrangler dev`, so it exercises the Worker runtime using the proposed compatibility configuration.
4. If a newly enabled flag changes behavior the application depends on, adapt the code. A documented `no_*` compatibility flag can be used as a temporary holdback when necessary, but it should not become an undocumented permanent escape hatch.
5. Merge only after the required checks pass. Deploy through the normal production release path; that deployment is the point at which the new compatibility date becomes live.

The 2026-09-10 bump from 2025-11-21 crosses Cloudflare's 2026-08-04 change that enables Node.js compatibility by default for newer compatibility dates. The Worker request path does not intentionally depend on Node.js-only APIs, so the browser/runtime gate is mandatory for this bump rather than assuming the change is inert.
