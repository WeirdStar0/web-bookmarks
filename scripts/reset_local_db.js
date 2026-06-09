const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const d1StateDir = path.join(repoRoot, '.wrangler', 'state', 'v3', 'd1');

console.log('🔄 开始重置本地 D1 数据库...');

if (fs.existsSync(d1StateDir)) {
    try {
        fs.rmSync(d1StateDir, { recursive: true, force: true });
        console.log('✅ 成功清除本地 D1 SQLite 数据库文件。');
    } catch (err) {
        console.error('❌ 清除本地数据库文件失败:', err.message);
        process.exit(1);
    }
} else {
    console.log('ℹ️ 未检测到已有的本地 D1 数据库状态，将直接初始化。');
}

console.log('⏳ 正在重新初始化本地表结构与索引...');
try {
    execSync(
        'npx wrangler d1 execute bookmarks-db --local --file=./schema.sql && ' +
        'npx wrangler d1 execute bookmarks-db --local --file=./migrations/002_add_indexes.sql && ' +
        'npx wrangler d1 execute bookmarks-db --local --file=./migrations/004_enforce_trash_consistency.sql && ' +
        'npx wrangler d1 execute bookmarks-db --local --file=./migrations/005_add_bookmark_sort_index.sql',
        { stdio: 'inherit', cwd: repoRoot }
    );
    console.log('🎉 本地 D1 数据库重置并初始化成功！');
} catch (err) {
    console.error('❌ 本地数据库初始化失败:', err.message);
    process.exit(1);
}
