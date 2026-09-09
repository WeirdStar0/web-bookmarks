# Web Bookmarks Manager

简体中文 | [English](README.en.md)

 一个基于 Cloudflare Workers 和 D1 数据库构建的现代化书签管理系统。

<p align="center">
  <img src="docs/images/dashboard-light.png" width="45%" alt="Dashboard Light">
  <img src="docs/images/dashboard-dark.png" width="45%" alt="Dashboard Dark">
</p>
<p align="center">
  <img src="docs/images/extension-light.png" width="200" alt="Extension Light">
  <img src="docs/images/extension-dark.png" width="200" alt="Extension Dark">
</p>


## ✨ 功能特性

- 📁 **文件夹管理** - 创建、编辑、删除文件夹,支持嵌套结构
- 🔖 **书签管理** - 添加、编辑、删除书签
- 🗑️ **回收站** - 软删除机制,可恢复已删除的书签和文件夹
- 📤 **导入/导出** - 支持 Netscape HTML 格式的书签导入导出
- 🔐 **身份验证** - 基于 Cookie 的安全认证系统
- 🔒 **安全增强** - 输入验证、速率限制、SQL 注入防护
- 🎯 **自由排序** - 点击“排序”进入管理模式，拖拽项目进行重新排序
- ⚡ **无服务器架构** - 部署在 Cloudflare Workers，全球边缘网络加速
- 💾 **D1 数据库** - 使用 Cloudflare D1 SQLite 数据库存储数据
- 🚀 **性能卓越** - 侧边栏预计算书签数量，极速响应，即使书签再多也不卡顿

- 🎨 **主题皮肤** - 完美支持暗黑/亮色模式切换,保护视力
- 🌍 **多语言支持** - 内置 11 种语言支持 (简体中文, English, 繁體中文, 日本語, 한국어, Español, Français, Deutsch, Русский, Português, Italiano)
- 🧩 **浏览器扩展** - 跨浏览器插件,随时随地一键保存书签

## 🚀 技术栈

- **后端框架**: [Hono](https://hono.dev/) - 轻量级 Web 框架
- **运行时**: Cloudflare Workers
- **数据库**: Cloudflare D1 (SQLite)
- **前端**: 原生 HTML/CSS/JavaScript + Alpine.js
- **语言**: TypeScript

## 📋 使用前置要求

- Cloudflare 账号


## 📋 开发前置要求

- Node.js 22.13.0（仓库通过 `.nvmrc` 固定此版本）
- Wrangler CLI (Cloudflare 开发工具)



## 🚀 快速部署

### 方法一：一键部署 (推荐)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/target?url=https://github.com/WeirdStar0/web-bookmarks)

点击上方的 **Deploy to Cloudflare Workers** 按钮。它会自动：
1. Fork/Clone 本仓库到你的账号。
2. 在 Cloudflare 中创建 Worker。
3. 自动创建并绑定 D1 数据库。

**部署后的结果：**
*   数据库和索引会在首次访问时自动初始化。
*   首次生产登录前必须设置 `INITIAL_ADMIN_PASSWORD`，否则不会创建默认管理员账号。
*   生产环境强制要求 `SECRET_KEY`：一键部署完成后，请在 Worker 的设置中添加 `SECRET_KEY`（Settings → Variables → Secrets），缺失时请求会失败并提示设置方法。

---

### 方法二：使用命令行部署 (适合开发)

1. **克隆并安装**
   ```bash
   git clone https://github.com/WeirdStar0/web-bookmarks.git
   cd web-bookmarks
   npm install
   ```

2. **初始化数据库**
   ```bash
   npx wrangler login
   npx wrangler d1 create bookmarks-db
   # 将输出的 database_id 填入 wrangler.toml (必须在 [[d1_databases]] 下填写)
   npm run check:migrations
   # 仅对全新或已有正确迁移账本的 D1 数据库应用迁移
   npm run db:migrate:remote
   ```

3. **设置密钥、初始管理员密码并部署**
   ```bash
   npx wrangler secret put SECRET_KEY
   npx wrangler secret put INITIAL_ADMIN_PASSWORD
   npm run deploy:check
   # 自动应用远程迁移后发布,避免新代码运行在旧 schema 上
   npm run deploy
   # 部署后确认远程迁移账本完整
   npm run verify:remote-migrations
   ```

## 🛠️ 本地开发 (Local Development)

如果你想在本地环境中运行或贡献代码，请参考以下步骤：

### 1. 克隆与安装
```bash
git clone https://github.com/WeirdStar0/web-bookmarks.git
cd web-bookmarks
# 使用 Node.js 22（仓库通过 .nvmrc 固定版本）
nvm use
npm install
```

### 2. 配置本地数据库
```bash
# 创建本地 D1 数据库实例
npx wrangler d1 create bookmarks-db

# 推荐：从 001 开始应用完整迁移序列（本地模式，全新数据库）
npm run db:migrate:local
```

### 3. 环境变量配置
创建 `.dev.vars` 文件用于本地存储密钥：
```bash
# 生成生成的随机密钥
openssl rand -base64 32
```
在 `.dev.vars` 中填入：
```bash
SECRET_KEY=你的随机密钥
# 生产环境必须至少 12 个字符，并使用强随机口令
INITIAL_ADMIN_PASSWORD=你的强初始管理员密码
```

### 4. 启动开发服务器
```bash
npm run dev
```
访问 `http://localhost:8787`。本地开发未设置 `INITIAL_ADMIN_PASSWORD` 时，默认账号为 `admin`，密码为 `local-development-only`；该默认值仅用于本地调试。生产环境必须显式设置至少 12 个字符的强初始密码。若旧安装仍保存历史已知弱默认口令，生产请求会失败关闭，直到提供 `INITIAL_ADMIN_PASSWORD`；系统会用该配置的强口令替换历史弱口令，而不会再迁移到另一组已知默认凭据。

### 5. 数据库初始化与升级 (D1 迁移)

迁移序列现以 `001_initial_schema.sql` 为基线。**全新空数据库，以及已经存在正确 `d1_migrations` 账本的旧数据库，应优先使用迁移命令**；它会按顺序创建或升级所需结构。部署完成后可运行 `npm run verify:remote-migrations`，确认远程库的迁移账本与本地迁移文件完全一致；该验证独立于部署门禁，因此首次部署不会因为远程库尚未初始化而被阻断。`npm run deploy` 也会在发布前自动应用待执行的远程迁移，避免新代码运行在旧 schema 上。

对于已投入使用的旧数据库，**请不要重新执行 `schema.sql` 或 `db:init` 命令**，以避免跳过迁移治理或产生状态混淆。如果旧库由早期运行时路径初始化，已经有完整业务表但没有 `d1_migrations` 账本，也不要盲目重放整条迁移链；请先按照 [`docs/production-runbook.md`](docs/production-runbook.md) 检查实际模式和数据，再执行迁移。其他情况请使用 D1 迁移命令进行无损升级：
```bash
# 升级本地开发数据库
npm run db:migrate:local

# 升级远程线上数据库
npm run db:migrate:remote
```

`npm run db:init:local` 与 `npm run db:init:remote` 仅保留给需要一次性装载当前完整运行时模式的全新数据库；它们会同时写入 `001` 至当前版本的迁移记录。无论采用哪种方式，均不要在已有业务数据的数据库上使用初始化命令。生产旧库若缺少 `d1_migrations` 表，请按照 [`docs/production-runbook.md`](docs/production-runbook.md) 做模式核对和账本修复，不要直接执行全新库初始化。

`010_enforce_folder_depth_limit.sql` 会为目录的 **12 层最大深度** 增加数据库级插入与移动保护。`011_enforce_active_parent_existence.sql` 会进一步要求活动目录和书签只能引用**存在且未删除**的父目录。`013_unique_active_folder_sibling_name.sql` 会阻止同一父目录下出现同名活动目录，从数据库层消除并发写入竞态。三项迁移均不会主动重写现有目录关系；如果旧库已经存在同级同名活动目录，应用 `013` 前应先人工合并或重命名重复项。旧库必须通过 `npm run db:migrate:remote` 应用这些迁移，才能使直接 SQL 写入和并发写入也遵守相同约束。

前端资源由本地构建链自动生成，不要直接手改生成产物：
- `src/templates/appAsset.ts` 由 `npm run build:app-asset` 生成
- `src/templates/appCssAsset.ts` 由 `npm run build:app-css` 生成
- `src/templates/vendorAsset.ts` 由 `npm run build:vendor-asset` 生成

其中：
- `src/client/app.js` 和 `src/client/fragments/` 负责应用主逻辑
- `src/client/styles.css` 负责 Tailwind 输入
- `src/client/vendor.js` 负责 Alpine.js 与 collapse 插件初始化

`npm run dev`、`npm test` 和 `npm run deploy` 前都会自动先生成这些前端资产。

建议把 `npm run check` 当成提交前和部署前的标准质量门。它会串行执行前端资产生成、TypeScript 检查、ESLint 和测试。

---

## 🔒 进阶配置

### 配置速率限制（生产部署必需）
为避免登录端点在缺少限流时暴露给暴力破解，生产部署必须绑定 KV 存储：
1. 创建 KV 命名空间：`npx wrangler kv namespace create RATE_LIMIT_KV`
2. 将返回的真实 `id` 填入 `wrangler.toml` 中启用的 `[[kv_namespaces]]` 配置块。
3. 使用 `npx wrangler secret put SECRET_KEY` 和 `npx wrangler secret put INITIAL_ADMIN_PASSWORD` 设置生产密钥；`SECRET_KEY` 为生产强制项，未设置时服务会失败关闭。
4. 运行 `npm run deploy:check` 确认迁移文件与生产绑定配置通过，执行 `npm run deploy`（先自动应用远程迁移再发布）后用 `npm run verify:remote-migrations` 复核远程迁移账本。不要直接运行 `npx wrangler deploy`，那会跳过迁移应用。

若未完成绑定，或者已绑定的 KV 在运行时读写失败，`/api/login` 都会返回 `503`；这能避免限流不可用时登录端点退化为可暴力破解状态。部署前检查同样会阻止未绑定 KV 的发布。

可在 Cloudflare Dashboard 或 `wrangler.toml` 中调整下列可选变量。无效、超范围或非整数值会自动回退到安全默认值，避免错误部署配置产生永久会话、失效 Cookie 或不可预期的限流行为。

| 变量 | 默认值 | 有效范围 |
|---|---:|---:|
| `SESSION_MAX_AGE`（秒） | 604800 | 60–2592000（1 分钟–30 天） |
| `RATE_LIMIT_MAX` | 100 | 1–10000 |
| `RATE_LIMIT_WINDOW`（秒） | 60 | 1–86400 |
| `RATE_LIMIT_LOGIN_MAX` | 5 | 1–100 |
| `RATE_LIMIT_LOGIN_WINDOW`（秒） | 60 | 1–86400 |

### 目录与数据读取边界

目录树最大深度为 **12 层**（根目录计为第 1 层）。该限制同时适用于创建目录和移动包含子目录的目录；超出时 API 返回 `400` 与 `FOLDER_DEPTH_LIMIT`，从而避免递归导出、统计和目录选择器因异常深度失去可用性。

`GET /api/data` 默认返回活动目录、当前目录下的书签和全库直系书签计数。主站切换到具体目录时使用 `GET /api/data?folderId=<id>`，根目录使用不带 `folderId` 的兼容形式；服务端不会再为每次目录切换传输整库书签。仅需要目录选择器的客户端应使用 `GET /api/data?includeBookmarks=false`，服务端会跳过书签查询和计数聚合并返回空的 `bookmarks` 数组；随仓库提供的浏览器扩展已使用该轻量模式。

### 允许浏览器扩展访问 (可选)
默认不会放行任意浏览器扩展源。需要显式配置允许的扩展 Origin：
1. 在扩展商店或开发者模式中确认扩展 ID。
2. 在 `wrangler.toml` 或 Cloudflare Dashboard 变量里设置 `ALLOWED_EXTENSION_ORIGINS`。
3. 多个值用英文逗号分隔，例如：
   ```toml
   ALLOWED_EXTENSION_ORIGINS = "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef"
   ```
4. 这个仓库的扩展已固定 `key`，因此同一份源码生成的扩展 ID 会保持一致；如果你重新生成 `key`，对应 ID 也会变化。
5. 扩展切换到不同服务器时，会在新主机授权成功后自动尝试撤销旧主机的可选访问权限；同一主机的不同路径不会触发撤销。

## 🧩 浏览器扩展 (Browser Extension)

项目配备了功能齐全的浏览器扩展程序,旨在提供极致的保存体验。

### ✨ 扩展功能
- **Premium UI**: 现代化的设计,基于 Inter 字体和 HSL 配色,支持丝滑的动效。
- **自定义主题**: 支持自动跟随系统或手动切换亮色/暗色模式。
- **智能保存**: 自动获取当前页面标题和网址,支持添加描述。
- **快速归类**: 自动记住上次选择的文件夹,并支持基于名称和 URL 的实时搜索。
- **隐私优先**: 主应用不再请求第三方 favicon 服务，避免将书签地址暴露给外部服务。

### 📦 安装步骤
1. 打开 Chrome 浏览器,访问 `chrome://extensions/`
2. 开启右上角的“**开发者模式**”
3. 点击“**加载已解压的扩展程序**”
4. 在文件选择对话框中,选择本项目根目录下的 `extension` 文件夹

### ⚙️ 配置说明
1. 点击扩展程序图标,首次打开会进入设置页面
2. 在“服务器地址”中填入 HTTPS Cloudflare Worker URL；仅 `localhost` 和 `127.0.0.1` 允许 HTTP 开发连接。
3. 浏览器会要求确认该服务器域名的访问权限；授权后再登录管理员账号。

---

## 💡 技巧与常见问题

### 1. 生成安全密钥 (SECRET_KEY)

```bash
# 使用 OpenSSL
openssl rand -base64 32

# 或使用 Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 2. 登录后立即退出？
- 确保生产环境的 `SECRET_KEY` 已通过 `npx wrangler secret put SECRET_KEY` 设置，且与本地一致。
- 如果更换了密钥，请清除浏览器 Cookie 后重新登录。
- 如果你重新生成过扩展 `key`，也要同步更新 `ALLOWED_EXTENSION_ORIGINS` 里的 `chrome-extension://...`。
- **升级注意**：生产（非 localhost）环境现在强制要求 `SECRET_KEY`，且不再回退读取 D1 内自动生成的 `secret_key`。旧安装必须先设置 Worker Secret 再部署新版本（先设 Secret，再部署），否则所有请求都会失败关闭。

### 3. 如何重置密码？
当前密码在数据库中以哈希形式存储，不能直接把明文密码写进 `settings.password`。

推荐做法：
- 登录后在页面“设置”中修改用户名和密码
- 如果你只是想回到默认管理员密码，可以删除 settings 表中的 password 记录后再走初始化流程。
- ⚠️ 注意：不要轻易在生产环境中抹除数据。如需在本地完全重新开始，可以使用本地重置命令：
```bash
npm run db:reset:local
```
重置后本地开发使用 `admin / local-development-only`；生产环境需要通过配置 `INITIAL_ADMIN_PASSWORD` 来进行新管理员初始化。

### 4. 速率限制不生效？
- 确保已创建 KV 命名空间：`npx wrangler kv:namespace create RATE_LIMIT_KV`
- 确保 `wrangler.toml` 中已正确绑定该 KV。

## 🔧 配置说明

### wrangler.toml

主要配置文件,包含:
- Worker 名称
- D1 数据库绑定
- 兼容性日期

### 环境变量

如需使用环境变量,创建 `.dev.vars` 文件(本地开发):

```
# .dev.vars
SECRET_KEY=your-secret-key
INITIAL_ADMIN_PASSWORD=your-initial-admin-password
ALLOWED_EXTENSION_ORIGINS=chrome-extension://your-extension-id
```

## 📖 API 文档

### 认证相关

- `POST /api/login` - 用户登录
- `POST /api/logout` - 用户登出
- `PUT /api/settings` - 更新用户名和密码

### 数据管理

- `GET /api/data` - 获取所有文件夹和书签
- `GET /api/trash` - 获取回收站内容

### 文件夹操作

- `POST /api/folders` - 创建文件夹
- `PUT /api/folders/:id` - 更新文件夹
- `DELETE /api/folders/:id` - 删除文件夹(软删除)
- `POST /api/restore/folders/:id` - 恢复文件夹
- `DELETE /api/trash/folders/:id` - 永久删除文件夹

### 书签操作

- `POST /api/bookmarks` - 创建书签
- `PUT /api/bookmarks/:id` - 更新书签
- `DELETE /api/bookmarks/:id` - 删除书签(软删除)
- `POST /api/restore/bookmarks/:id` - 恢复书签
- `DELETE /api/trash/bookmarks/:id` - 永久删除书签

### 排序操作 (新增)

- `PUT /api/folders/reorder` - 批量更新文件夹顺序
- `PUT /api/bookmarks/reorder` - 批量更新书签顺序 (基于时间戳)

### 导入导出

- `GET /api/export` - 导出书签为 HTML 格式
- `POST /api/import` - 导入 Netscape HTML 格式书签

## 🗄️ 数据库结构

### folders 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| name | TEXT | 文件夹名称 |
| parent_id | INTEGER | 父文件夹 ID |
| sort_order | INTEGER | 排序权重 (越小越靠前) |
| is_deleted | INTEGER | 是否已删除 (0/1) |
| created_at | TIMESTAMP | 创建时间 |

### bookmarks 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 主键 |
| title | TEXT | 书签标题 |
| url | TEXT | 书签 URL |
| description | TEXT | 描述 |
| folder_id | INTEGER | 所属文件夹 ID |
| is_deleted | INTEGER | 是否已删除 (0/1) |
| created_at | TIMESTAMP | 创建时间 |

### settings 表

| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT | 设置键 (主键) |
| value | TEXT | 设置值 |

## 🔒 安全建议

1. **修改初始密码**: 生产环境使用 `INITIAL_ADMIN_PASSWORD` 首次登录后，立即在设置中改成长期密码；修改用户名或密码会撤销所有既有会话，需使用新凭据重新登录。
2. **使用 HTTPS**: Cloudflare Workers 默认提供 HTTPS
3. **主动注销**: 注销会撤销现有会话版本，可使其他标签页或被复制的旧 Cookie 立即失效。
4. **定期备份**: 定期导出书签数据作为备份
5. **API Token 安全**: 不要将 Cloudflare API Token 提交到代码库

## 🤝 贡献

欢迎提交 Issue 和 Pull Request!

## 📄 许可证

ISC License


## 📞 支持

如有问题,请提交 [Issue](https://github.com/YOUR_USERNAME/web-bookmarks/issues)

---

⭐ 如果这个项目对你有帮助,请给个 Star!
