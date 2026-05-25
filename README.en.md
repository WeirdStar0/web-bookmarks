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

- Node.js 20.x or higher
- Wrangler CLI


## 🚀 Quick Deployment

### Option 1: One-Click Deploy (Recommended)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/target?url=https://github.com/WeirdStar0/web-bookmarks-)

Click the **Deploy to Cloudflare Workers** button. It will:
1. Fork/Clone this repo.
2. Create Worker in Cloudflare.
3. Automatically create and bind D1 database.

**What happens after deployment:**
*   **Zero Configuration**: Database, indexes, admin account, and `SECRET_KEY` are auto-initialized on first visit.
*   **Ready to Use**: Access your Worker URL and start managing bookmarks.

---

### Option 2: CLI Deployment (For Developers)

1. **Clone and Install**
   ```bash
   git clone https://github.com/WeirdStar0/web-bookmarks-.git
   cd web-bookmarks-
   npm install
   ```

2. **Initialize Database**
   ```bash
   npx wrangler login
   npx wrangler d1 create bookmarks-db
   # Fill database_id into wrangler.toml under [[d1_databases]]
   npm run db:reset:remote
   ```

3. **Set Secret and Deploy**
   ```bash
   npx wrangler secret put SECRET_KEY
   npm run deploy
   ```

## 🛠️ Local Development

1. **Clone and Install**
```bash
git clone https://github.com/WeirdStar0/web-bookmarks-.git
cd web-bookmarks-
npm install
```

2. **Configure Local DB**
```bash
npx wrangler d1 create bookmarks-db
npx wrangler d1 execute bookmarks-db --local --file=./schema.sql
npx wrangler d1 execute bookmarks-db --local --file=./migrations/002_add_indexes.sql
npx wrangler d1 execute bookmarks-db --local --file=./migrations/004_enforce_trash_consistency.sql
npx wrangler d1 execute bookmarks-db --local --file=./migrations/005_add_bookmark_sort_index.sql
```

3. **Environment Setup**
Create `.dev.vars`:
```bash
openssl rand -base64 32
```
Add to `.dev.vars`: `SECRET_KEY=your-random-key`

4. **Start Development**
```bash
npm run dev
```
Visit `http://localhost:8787`. Default: `admin` / `123456`

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

### Enable Rate Limiting (Optional)
1. Create KV: `npx wrangler kv:namespace create RATE_LIMIT_KV`
2. Add `id` to `wrangler.toml`.
3. Re-deploy: `npm run deploy`.

## 🧩 Browser Extension

A full-featured extension for the best bookmark saving experience.

### ✨ Extension Features
- **Premium UI**: Modern design based on Inter font and HSL colors.
- **Custom Theme**: Auto-follow system or manual switch.
- **Smart Save**: Auto-fetch page title and URL.
- **Fast Categorization**: Memory of last used folder, real-time search.
- **Favicon Support**: See icons in search results.

### 📦 Installation
1. Open Chrome, go to `chrome://extensions/`.
2. Enable "**Developer mode**".
3. Click "**Load unpacked**".
4. Select the `extension` folder.

### ⚙️ Setup
1. Click the icon, go to settings.
2. Fill in your Cloudflare Worker URL.
3. Login and start saving.

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

### 3. Reset Password
```bash
npm run db:reset:remote
```
Passwords are stored as hashes, so writing plaintext into `settings.password` is no longer valid. After reset, the default admin credentials are `admin` / `123456`.

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
1. **Change Default Password** immediately.
2. **Use HTTPS** (Provided by default).
3. **Regular Backups**.

## 🤝 Contributing
Issues and PRs are welcome!

## 📄 License
ISC License

## 📞 Support
Submit an [Issue](https://github.com/WeirdStar0/web-bookmarks/issues)

---
⭐ Give it a Star if it helped!

