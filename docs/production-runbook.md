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
