# Web Bookmarks Manager

[简体中文](README.md) | English

A modern bookmark management system built on Cloudflare Workers and D1 database.

<p align="center">
  <img src="docs/images/dashboard-light.png" width="45%" alt="Dashboard Light">
  <img src="docs/images/dashboard-dark.png" width="45%" alt="Dashboard Dark">
</p>
<p align="center">
  <img src="docs/images/extension-light.png" width="200" alt="Extension Light">
  <img src="docs/images/extension-dark.png" width="200" alt="Extension Dark">
</p>


## ✨ Features

- 📁 **Folder Management** - Create, edit, delete folders, support nested structures
- 🔖 **Bookmark Management** - Add, edit, delete bookmarks
- 🗑️ **Trash** - Soft delete mechanism, restore deleted bookmarks and folders
- 📤 **Import/Export** - Support Netscape HTML format
- 🔐 **Authentication** - Cookie-based secure authentication
- 🔒 **Security** - Input validation, rate limiting, SQL injection protection
- 🎯 **Sorting** - Drag and drop sorting in "Sort" mode
- ⚡ **Serverless** - Deployed on Cloudflare Workers
- 💾 **D1 Database** - Using Cloudflare D1 SQLite database
- 🚀 **Performance** - Pre-calculated bookmark counts for ultra-fast response
- 🎨 **Themes** - Support Dark/Light mode
- 🌍 **Multi-language** - Supports 11 languages (Simplified Chinese, English, Traditional Chinese, Japanese, Korean, Spanish, French, German, Russian, Portuguese, Italian)
- 🧩 **Extension** - Cross-browser extension for one-click saving

## 🚀 Tech Stack

- **Backend**: [Hono](https://hono.dev/)
- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Frontend**: Native HTML/CSS/JS + Alpine.js
- **Language**: TypeScript

## 📋 Prerequisites

- Cloudflare Account


## 📋 Development Requirements

- Node.js 22.13.0 (the repository pins this version in `.nvmrc`)
- Wrangler CLI


## 🚀 Quick Deployment

### Login credentials first

**There is no fixed production default password.** `12345`, `123456`, and `admin` are not valid production defaults in the current version.

After first initialization, sign in with:

- **Username:** `admin`
- **Password:** the value you set in `INITIAL_ADMIN_PASSWORD` (minimum 12 characters; use a strong, unique password)

`INITIAL_ADMIN_PASSWORD` is used only to **create the initial administrator account** and to replace a historical known weak default credential. Once the administrator has already been initialized, changing this Worker Secret **does not change the current login password**. If you can still sign in, change the long-term password from Settings in the application.

Production also requires:

- `SECRET_KEY`: **required**, used to sign session cookies; generate at least 32 random bytes;
- `RATE_LIMIT_KV`: **required**, used for login rate limiting;
- `PASSWORD_PEPPER`: optional but recommended for additional password-hash protection.

### Option 1: One-Click Deploy (Recommended)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/target?url=https://github.com/WeirdStar0/web-bookmarks)

If your goal is simply to get the application running, **use this method first**. The steps below follow the actual Cloudflare setup flow; in the normal case you do not need to run Wrangler commands manually.

#### Step 1: Open Deploy to Cloudflare Workers

Click the button above and sign in to Cloudflare. Select the Cloudflare account requested by the setup page and confirm that you want to create a Worker from this repository.

Cloudflare reads the Wrangler configuration and prepares the Worker plus declared resources. Production requires:

- D1 binding: `DB`
- KV binding: `RATE_LIMIT_KV`
- Secret: `SECRET_KEY`
- Secret: `INITIAL_ADMIN_PASSWORD`
- Optional secret: `PASSWORD_PEPPER`

#### Step 2: Confirm the Worker / D1 / KV resources

Review the resource list shown by the deployment flow. A normal setup should include the Worker together with the declared D1 and KV resources.

The final bindings must be:

```text
D1 binding: DB
KV binding: RATE_LIMIT_KV
```

If Cloudflare provisions the D1 database and KV namespace automatically, use those resources. Do not rename the bindings, because the application accesses them as `DB` and `RATE_LIMIT_KV`.

#### Step 3: Set SECRET_KEY

If the Deploy page shows a Secret input, set `SECRET_KEY` to a fresh random value.

Generate one locally with:

```bash
openssl rand -base64 32
```

Without OpenSSL:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Copy the **entire output** into `SECRET_KEY`. Do not use a placeholder from the README and do not commit the value to Git.

#### Step 4: Set INITIAL_ADMIN_PASSWORD

Set `INITIAL_ADMIN_PASSWORD` to the password you want to use for the first administrator login:

- minimum 12 characters;
- do not use `12345`, `123456`, `admin`, or another weak password;
- preferably generate and store it in a password manager.

You can generate a random value with:

```bash
openssl rand -base64 24
```

**Your first production login will be:**

```text
Username: admin
Password: the INITIAL_ADMIN_PASSWORD value you entered here
```

The application stores only a password hash in D1, so it cannot recover this plaintext value later. Save it before continuing.

#### Step 5: Optionally set PASSWORD_PEPPER

This is not required to start the application, but it is recommended for stronger password-hash protection.

Generate random material:

```bash
openssl rand -base64 32
```

Then set the `PASSWORD_PEPPER` secret to:

```text
k1:<the generated random value>
```

For example:

```text
k1:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=
```

Keep the complete pepper only in Cloudflare Worker Secrets and your password manager. **Do not store it in D1 or commit it to Git.**

#### Step 6: Deploy

After confirming resources and secrets, click Cloudflare's **Deploy / Create and deploy** action. The exact button label may change slightly as Cloudflare updates the UI.

If the setup page shows a Build / Deploy command, keep the repository-detected deployment flow. Production should use:

```bash
npm run deploy
```

Do not replace it with bare:

```bash
npx wrangler deploy
```

`npm run deploy` applies remote D1 migrations before publishing the Worker, preventing new code from running against an outdated schema.

#### Step 7: If the Deploy page did not ask for secrets, add them in Dashboard after deployment

Cloudflare's current Dashboard path is:

```text
Cloudflare Dashboard
→ Workers & Pages
→ select the Worker you just deployed
→ Settings
→ Variables and Secrets
→ Add
```

Add:

```text
Type: Secret
Variable name: SECRET_KEY
Value: your random SECRET_KEY
```

Then add:

```text
Type: Secret
Variable name: INITIAL_ADMIN_PASSWORD
Value: your initial administrator password (at least 12 characters)
```

If you want the optional pepper, also add:

```text
Type: Secret
Variable name: PASSWORD_PEPPER
Value: k1:<random material>
```

Select **Deploy** after adding the secrets so the new values become active.

> Cloudflare does not reveal a secret's original value after it is saved. Keep `SECRET_KEY`, `INITIAL_ADMIN_PASSWORD`, and the full `PASSWORD_PEPPER` (if enabled) in a password manager.

#### Step 8: Verify D1 and KV bindings

Stay on the Worker's **Settings** page and verify its resource bindings.

You must have:

```text
D1 binding name = DB
KV binding name = RATE_LIMIT_KV
```

If `RATE_LIMIT_KV` is missing, the page itself may still load, but `/api/login` returns 503 because this project refuses to expose authentication without login rate limiting.

If the D1 binding is not named `DB`, the application cannot read or write its database correctly.

#### Step 9: Open the Worker URL and sign in

Return to the Worker Overview / Deployments area and open the `*.workers.dev` URL provided by Cloudflare, or your custom domain.

Sign in with:

```text
Username: admin
Password: the INITIAL_ADMIN_PASSWORD value you set
```

After the first successful login, open Settings in the application and change the initial password to your long-term administrator password. Changing the username or password revokes existing sessions, so sign in again with the new credentials.

#### Step 10: If you see 503, check initialization settings first

If the first request returns:

```text
503 DEPLOYMENT_NOT_INITIALIZED
```

it usually means the production initialization requirements are incomplete, not that the application is broken.

Start here:

```text
Workers & Pages
→ your Worker
→ Settings
→ Variables and Secrets
```

Confirm that:

- `SECRET_KEY` exists;
- `INITIAL_ADMIN_PASSWORD` exists and has at least 12 characters;
- then verify that D1 `DB` and KV `RATE_LIMIT_KV` bindings both exist.

### One-click post-deploy checklist

After deployment, verify these five items:

- [ ] D1 binding is named `DB`
- [ ] KV binding is named `RATE_LIMIT_KV`
- [ ] `SECRET_KEY` is configured as a Secret
- [ ] `INITIAL_ADMIN_PASSWORD` is configured and has at least 12 characters
- [ ] `admin` + `INITIAL_ADMIN_PASSWORD` can sign in successfully

#### One-click deployment troubleshooting

| Symptom | Most likely cause | Fix |
|---|---|---|
| Page returns `503 DEPLOYMENT_NOT_INITIALIZED` | `SECRET_KEY` or `INITIAL_ADMIN_PASSWORD` is missing, or the initial password is shorter than 12 characters | Worker → Settings → Variables and Secrets → Add; create/fix the value as type `Secret`, then select Deploy |
| Page opens but `/api/login` returns 503 | `RATE_LIMIT_KV` is missing or unavailable | Verify that a KV namespace is bound to the Worker as `RATE_LIMIT_KV` |
| You changed `INITIAL_ADMIN_PASSWORD` but the old login password still works | The administrator is already initialized; this secret is not a continuously synchronized current password | Change the password from Settings, or use the reset procedure below if locked out |
| D1 reports `no such table` / `no such column` | The migration chain was not fully applied | Deploy through `npm run deploy`; if needed run `npm run db:migrate:remote`, then `npm run verify:remote-migrations` |
| Login succeeds and immediately expires | `SECRET_KEY` is missing/changed or the browser still has a cookie signed with an older key | Verify the secret; after a key rotation, clear site cookies and sign in again |

---

### Option 2: CLI Deployment (Developers / Custom Deployments)

CLI deployment requires Node.js 22 and Wrangler. Run all commands from the repository root.

#### Step 1: Clone and authenticate

```bash
git clone https://github.com/WeirdStar0/web-bookmarks.git
cd web-bookmarks
nvm use
npm install
npx wrangler login
```

#### Step 2: Create and bind D1

```bash
npx wrangler d1 create bookmarks-db
```

Copy the returned `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "bookmarks-db"
database_id = "your-D1-database-id"
```

Keep the binding name exactly `DB`; the code and migration commands access the database through that binding.

#### Step 3: Create and bind the login rate-limit KV namespace

```bash
npx wrangler kv namespace create RATE_LIMIT_KV
```

Copy the returned namespace id into:

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "your-KV-namespace-id"
```

This binding is mandatory in production. The project fails closed: when the KV binding is missing or unavailable, `/api/login` returns 503 rather than exposing an un-rate-limited login endpoint.

#### Step 4: Configure production secrets

Generate `SECRET_KEY`:

```bash
openssl rand -base64 32
```

Then run:

```bash
npx wrangler secret put SECRET_KEY
```

Paste the generated value when Wrangler prompts for it.

Set the initial administrator password:

```bash
npx wrangler secret put INITIAL_ADMIN_PASSWORD
```

Enter a strong password with **at least 12 characters**. The first initialized account is `admin`, and its password is the value entered here.

Optional: enable a password pepper:

```bash
openssl rand -base64 32
npx wrangler secret put PASSWORD_PEPPER
```

Enter `k1:<the generated random value>` for `PASSWORD_PEPPER`.

#### Step 5: Check and deploy

```bash
# Full quality gate: build, typecheck, lint, tests, migration and deploy-config checks
npm run check

# Verify production bindings and migration configuration
npm run deploy:check

# Production deploy: apply remote D1 migrations first, then publish the Worker
npm run deploy

# Confirm the remote migration ledger matches this repository
npm run verify:remote-migrations
```

**Do not replace `npm run deploy` with bare `npx wrangler deploy`.** The bare command bypasses this repository's remote migration application step.

#### Step 6: Sign in

Open the Worker URL printed by Wrangler:

```text
Username: admin
Password: the value stored in INITIAL_ADMIN_PASSWORD
```

After the first successful login, change the administrator password from Settings.

### Upgrading an existing deployment

If you already have a D1 database containing application data, **do not re-run `schema.sql`, `db:init:remote`, or recreate the database**.

Normal upgrade sequence:

```bash
git pull
npm install
npm run check
npm run deploy:check
npm run deploy
npm run verify:remote-migrations
```

For upgrades from older releases, production must also have:

```bash
npx wrangler secret put SECRET_KEY
npx wrangler secret put INITIAL_ADMIN_PASSWORD   # only if not initialized yet or a legacy weak default is detected
```

If an old production database already contains the application tables but has no `d1_migrations` ledger, **do not blindly replay the entire migration history**. Inspect the real schema and follow [`docs/production-runbook.md`](docs/production-runbook.md) first.

## 🛠️ Local Development

1. **Clone and Install**
```bash
git clone https://github.com/WeirdStar0/web-bookmarks.git
cd web-bookmarks
npm install
```

2. **Configure Local DB**
```bash
npx wrangler d1 create bookmarks-db
# Recommended: apply the complete migration history from 001 (local mode, fresh DB)
npm run db:migrate:local
```

3. **Environment Setup**
Create `.dev.vars`:
```bash
openssl rand -base64 32
```
Add to `.dev.vars`:
```bash
SECRET_KEY=your-random-key
# Use a strong password with at least 12 characters in production
INITIAL_ADMIN_PASSWORD=your-strong-initial-admin-password
```

4. **Start Development**
```bash
npm run dev
```
Visit `http://localhost:8787`. Local development falls back to `admin` / `local-development-only` when `INITIAL_ADMIN_PASSWORD` is not set; this is for local debugging only. Production requires an explicit, strong initial password with at least 12 characters. If an older installation still stores a historical known weak default credential, production requests fail closed until `INITIAL_ADMIN_PASSWORD` is supplied; the application replaces that legacy credential with the configured strong password instead of migrating it to another known default.

5. **D1 Database Initialization and Migration**

The migration history now begins with `001_initial_schema.sql`. **Use the migration commands as the preferred path for fresh empty databases and existing databases that already have a correct `d1_migrations` ledger**; they create or upgrade the required structures in sequence. After deploying, `npm run verify:remote-migrations` confirms that the remote database's migration ledger matches the local migration files; this verification is separate from the deployment gate, so a first deployment is never blocked by a remote database that has not been initialized yet. `npm run deploy` also applies pending remote migrations before publishing, so new code never runs against an outdated schema.

For an existing database containing application data, **do NOT re-run `schema.sql` or a `db:init` command**, as this bypasses migration governance and may cause state confusion. If the database was initialized by an older runtime path and has the current tables but no `d1_migrations` ledger, do not blindly replay the full chain: inspect the actual schema and follow [`docs/production-runbook.md`](docs/production-runbook.md) first. Otherwise, upgrade safely using Cloudflare D1's migration features:
```bash
# Upgrade local development DB
npm run db:migrate:local

# Upgrade remote production DB
npm run db:migrate:remote
```

`npm run db:init:local` and `npm run db:init:remote` remain available only when a fresh database must be populated with the current complete runtime schema in one step; they record migrations `001` through the current version. Never use an initialization command against an existing database with application data. For a production database with data, use the inspection and recovery procedure in [`docs/production-runbook.md`](docs/production-runbook.md) if `npm run verify:remote-migrations` reports that `d1_migrations` does not exist.

Frontend assets are generated locally. Do not edit generated files directly:
- `src/templates/appAsset.ts` from `npm run build:app-asset`
- `src/templates/appCssAsset.ts` from `npm run build:app-css`
- `src/templates/vendorAsset.ts` from `npm run build:vendor-asset`

Source ownership is:
- `src/client/app.js` and `src/client/fragments/` for app logic
- `src/client/styles.css` for Tailwind input
- `src/client/vendor.js` for Alpine.js and collapse plugin bootstrap

`npm run dev`, `npm test`, and `npm run deploy` regenerate these assets automatically first.

Use `npm run check` as the pre-commit and pre-deploy quality gate. It runs asset generation, TypeScript, ESLint, and tests in sequence.

---

## 🔒 Advanced Configuration

### Configure Rate Limiting (Required for Production)
1. Create KV: `npx wrangler kv namespace create RATE_LIMIT_KV`.
2. Add the returned real namespace ID to the active `[[kv_namespaces]]` block in `wrangler.toml`.
3. Set production secrets with `npx wrangler secret put SECRET_KEY` and `npx wrangler secret put INITIAL_ADMIN_PASSWORD`; `SECRET_KEY` is mandatory in production and the service fails closed without it.
4. Run `npm run deploy:check` (local migration-file and production-binding checks), deploy with `npm run deploy` (applies pending remote migrations before publishing), then confirm the remote migration ledger with `npm run verify:remote-migrations`. Do not deploy with bare `npx wrangler deploy`; it skips migration application.

Without this binding, or when the bound KV fails at runtime, `/api/login` fails closed with `503`; this prevents the login endpoint from degrading into an unprotected brute-force target. The pre-deploy check also blocks publication when the KV binding is absent.

The following optional variables can be configured in the Cloudflare Dashboard or `wrangler.toml`. Invalid, out-of-range, and non-integer values fall back to safe defaults, avoiding effectively permanent sessions, invalid cookies, or unpredictable rate limiting caused by a bad deployment value.

| Variable | Default | Accepted range |
|---|---:|---:|
| `SESSION_MAX_AGE` (seconds) | 604800 | 60–2592000 (1 minute–30 days) |
| `RATE_LIMIT_MAX` | 100 | 1–10000 |
| `RATE_LIMIT_WINDOW` (seconds) | 60 | 1–86400 |
| `RATE_LIMIT_LOGIN_MAX` | 5 | 1–100 |
| `RATE_LIMIT_LOGIN_WINDOW` (seconds) | 60 | 1–86400 |
| `PASSWORD_HASH_ITERATIONS` | 25000 | 25000–100000 |

### Password Hashing Hardening (PASSWORD_PEPPER, recommended)

The v4 password hash format mixes a **pepper** into the derivation — secret material that exists only in Workers Secrets and never in D1. Even a full database leak then leaves an attacker unable to verify the password, let alone crack it offline. Fresh hashes default to 25,000 PBKDF2 iterations — the conservative default under the Workers Free 10 ms CPU budget — configurable to 25,000–100,000 via `PASSWORD_HASH_ITERATIONS` (for example 90000 on Paid plans; out-of-range values fall back to the default), and stored hashes migrate lazily on the next login.

Setup (value format `<id>:<material>`, with a 1–16 character alphanumeric id that must be unique per rotation):

```bash
openssl rand -base64 32
npx wrangler secret put PASSWORD_PEPPER   # enter k1:<the output>
```

The next successful login migrates the stored hash to v4 automatically; password changes and initial admin creation produce v4 directly. Without a pepper the system keeps working (v3, the default 25,000 iterations), so this is recommended rather than required.

**Rotation** (order matters — `wrangler secret put` deploys immediately, and secret values cannot be read back later): keep the current full pepper in a password manager, write the old full value into `PASSWORD_PEPPER_PREVIOUS`, then the new id (e.g. `k2:<fresh random material>`) into `PASSWORD_PEPPER`, and log in once to trigger the re-hash. Before removing `PASSWORD_PEPPER_PREVIOUS`, confirm the stored hash actually references the new id — the migration write fails silently, so run the boolean-only D1 query documented in the runbook first. Never reuse an id and never change the material while keeping an id. **Losing the pepper** makes the corresponding hash unverifiable and login fails closed; the only recovery is the documented reset path (delete the `password` row in `settings`, then re-initialize with `INITIAL_ADMIN_PASSWORD`). See [`docs/password-v4-design.md`](docs/password-v4-design.md).

### Folder and Data-Loading Bounds

The folder tree is limited to **12 levels** (with a root folder counted as level 1). The limit applies to both creating a folder and moving a folder containing descendants. A violating request returns `400` with `FOLDER_DEPTH_LIMIT`, protecting recursive export, counts, and folder selectors from pathological nesting.

`GET /api/data` retains its compatible default and returns active folders and bookmarks. Clients that only require a folder selector should call `GET /api/data?includeBookmarks=false`; the server skips the whole-bookmark query and returns an empty `bookmarks` array. The bundled browser extension uses this lightweight mode. When a user navigates between folders, the main site requests the selected `folderId` on demand; `bookmarkCounts` remains available for sidebar counts without loading every bookmark into the initial response.

### Allow Browser Extension Access (Optional)
By default, arbitrary extension origins are not allowed. Set `ALLOWED_EXTENSION_ORIGINS` in `wrangler.toml` or Cloudflare Dashboard, for example:
```toml
ALLOWED_EXTENSION_ORIGINS = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef"
```
This repo uses a fixed extension `key`, so the generated ID stays stable for the same source. If you regenerate the `key`, update the allowlist too. When the extension switches to a different server, it attempts to revoke the old host's optional access permission after the new host is authorized; changing only a path on the same host does not revoke that permission.

## 🧩 Browser Extension

A full-featured extension for the best bookmark saving experience.

### ✨ Extension Features
- **Premium UI**: Modern design based on Inter font and HSL colors.
- **Custom Theme**: Auto-follow system or manual switch.
- **Smart Save**: Auto-fetch page title and URL.
- **Fast Categorization**: Memory of last used folder, real-time search.
- **Privacy-first Dashboard**: The main dashboard does not contact third-party favicon services with bookmark URLs.

### 📦 Installation
1. Open Chrome, go to `chrome://extensions/`.
2. Enable "**Developer mode**".
3. Click "**Load unpacked**".
4. Select the `extension` folder.

### ⚙️ Setup
1. Click the icon, go to settings.
2. Enter an HTTPS Cloudflare Worker URL. HTTP is permitted only for `localhost` and `127.0.0.1` development.
3. Approve the browser permission for that server, then log in and start saving.

---

## 💡 Tips & FAQ

### 1. Generate SECRET_KEY
```bash
openssl rand -base64 32
# or
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2. Immediate Logout?
- Ensure `SECRET_KEY` is set via `npx wrangler secret put`.
- If key changed, clear cookies and relogin.
- If you regenerated the extension `key`, update `ALLOWED_EXTENSION_ORIGINS` with the new `chrome-extension://...` value too.
- **Upgrade note**: production (non-localhost) deployments now require `SECRET_KEY` and no longer fall back to the D1-managed `secret_key`. Existing installations must set the Worker secret **before** deploying this version — set the secret first, then deploy; otherwise every request fails closed.

### 3. Reset Password
Passwords are stored as hashes, so writing plaintext into `settings.password` is no longer valid.
- To reset the password, you can delete the `password` record from the `settings` table, then log in again with `INITIAL_ADMIN_PASSWORD`.
- ⚠️ WARNING: Avoid using database reset commands in production to prevent data loss. If you need to completely reset the database locally, run:
```bash
npm run db:reset:local
```
After a local reset, the default local account fallback is `admin` / `local-development-only`.

## 🔧 Configuration

### wrangler.toml
Main config for Worker name, D1 binding, and compatibility.

### Environment
Use `.dev.vars` for local development secrets.

## 📖 API Documentation

### Auth
- `POST /api/login`
- `POST /api/logout`
- `PUT /api/settings`

### Data
- `GET /api/data`
- `GET /api/trash`

### Folders
- `POST /api/folders`
- `PUT /api/folders/:id`
- `DELETE /api/folders/:id`
- `POST /api/restore/folders/:id`

### Bookmarks
- `POST /api/bookmarks`
- `PUT /api/bookmarks/:id`
- `DELETE /api/bookmarks/:id`

## 🗄️ Database Schema

### folders
`id`, `name`, `parent_id`, `sort_order`, `is_deleted`, `created_at`

### bookmarks
`id`, `title`, `url`, `description`, `folder_id`, `is_deleted`, `created_at`

## 🔒 Security Recommendations
1. **Change Default Password** immediately. Changing the administrator username or password revokes all existing sessions, so sign in again with the updated credentials.
2. **Use HTTPS** (Provided by default).
3. **Log Out Actively**. Logout rotates the shared session version, invalidating copied cookies and sessions in other tabs.
4. **Regular Backups**.

## 🤝 Contributing
Issues and PRs are welcome!

## 📄 License
ISC License

## 📞 Support
Submit an [Issue](https://github.com/WeirdStar0/web-bookmarks/issues)

---
⭐ Give it a Star if it helped!