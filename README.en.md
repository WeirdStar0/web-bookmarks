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

### Option 1: One-Click Deploy (Recommended)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/target?url=https://github.com/WeirdStar0/web-bookmarks)

Click the **Deploy to Cloudflare Workers** button. It will:
1. Fork/Clone this repo.
2. Create Worker in Cloudflare.
3. Automatically create and bind D1 database.

**What happens after deployment:**
*   Database and indexes are initialized automatically on first visit.
*   Set `INITIAL_ADMIN_PASSWORD` before the first production login; otherwise no default admin account is created.
*   `SECRET_KEY` is mandatory in production: the Deploy to Cloudflare setup page prompts for it (the deploy flow reads Worker secrets declared in `.dev.vars.example`); if skipped, requests fail closed after deployment and the setup error is available in Worker logs.

---

### Option 2: CLI Deployment (For Developers)

1. **Clone and Install**
   ```bash
   git clone https://github.com/WeirdStar0/web-bookmarks.git
   cd web-bookmarks
   # Use Node.js 22, pinned by .nvmrc
   nvm use
   npm install
   ```

2. **Initialize Database**
   ```bash
   npx wrangler login
   npx wrangler d1 create bookmarks-db
   # Fill database_id into wrangler.toml under [[d1_databases]]
   npm run check:migrations
   # Apply the complete migration history only to a fresh or migration-tracked D1 database
   npm run db:migrate:remote
   ```

3. **Set Secrets and Deploy**
   ```bash
   npx wrangler secret put SECRET_KEY
   npx wrangler secret put INITIAL_ADMIN_PASSWORD
   # Create RATE_LIMIT_KV, add its id to wrangler.toml, then verify:
   npm run deploy:check
   npm run deploy
   # Confirm the remote migration ledger after deploying
   npm run verify:remote-migrations
   ```

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

**Rotation** (order matters — `wrangler secret put` deploys immediately, and secret values cannot be read back later): keep the current full pepper in a password manager, write the old full value into `PASSWORD_PEPPER_PREVIOUS`, then the new id (e.g. `k2:<fresh random material>`) into `PASSWORD_PEPPER`, and log in once — the stored hash is re-hashed to the current id, after which `PASSWORD_PEPPER_PREVIOUS` can be removed. Never reuse an id and never change the material while keeping an id. **Losing the pepper** makes the corresponding hash unverifiable and login fails closed; the only recovery is the documented reset path (delete the `password` row in `settings`, then re-initialize with `INITIAL_ADMIN_PASSWORD`). See [`docs/password-v4-design.md`](docs/password-v4-design.md).

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

