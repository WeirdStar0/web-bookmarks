// Post-migration verification that the remote D1 ledger contains exactly the
// migrations in ./migrations. Deliberately NOT part of `deploy:check`: a
// first deployment must not be blocked by asking a database that may not
// exist yet to prove it has already been migrated. Apply migrations first
// (`npm run db:migrate:remote`), then confirm with
// `npm run verify:remote-migrations`.

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const migrationsDir = path.join(rootDir, 'migrations');
const databaseBinding = 'DB';
const requiredMigrations = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

if (requiredMigrations.length === 0) {
    throw new Error('Remote D1 migration check failed: no migration files were found.');
}

function collectMigrationNames(value, names = new Set()) {
    if (Array.isArray(value)) {
        value.forEach((item) => collectMigrationNames(item, names));
        return names;
    }
    if (!value || typeof value !== 'object') return names;
    if (typeof value.name === 'string') names.add(value.name);
    Object.values(value).forEach((item) => collectMigrationNames(item, names));
    return names;
}

try {
    const args = [
        'wrangler', 'd1', 'execute', databaseBinding,
        '--remote',
        '--command', 'SELECT name FROM d1_migrations ORDER BY name;',
        '--json',
    ];
    const output = process.platform === 'win32'
        ? execSync(`npx.cmd wrangler d1 execute ${databaseBinding} --remote --command "SELECT name FROM d1_migrations ORDER BY name;" --json`, {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        : execFileSync('npx', args, {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });

    const appliedMigrations = collectMigrationNames(JSON.parse(output));
    const missing = requiredMigrations.filter((name) => !appliedMigrations.has(name));
    const unexpected = [...appliedMigrations].filter((name) => !requiredMigrations.includes(name));
    if (missing.length > 0 || unexpected.length > 0) {
        const details = [];
        if (missing.length > 0) details.push(`missing remote migrations: ${missing.join(', ')}`);
        if (unexpected.length > 0) details.push(`unexpected remote migrations: ${unexpected.join(', ')}`);
        throw new Error(details.join('; '));
    }

    console.log(`Remote D1 migration check passed (${requiredMigrations.length} migrations applied).`);
} catch (error) {
    const detail = [
        error?.stderr?.toString().trim(),
        error?.stdout?.toString().trim(),
        error?.message,
    ].filter(Boolean).join('\n') || String(error);

    if (/no such table:\s*d1_migrations/i.test(detail)) {
        console.error('Remote D1 migration check could not inspect an uninitialized database: table "d1_migrations" does not exist.');
        console.error('For a new database, run "npm run db:migrate:remote" to apply the complete migration history, or run "npm run db:init:remote" to initialize the runtime schema, then run this check again.');
    } else {
        console.error('Remote D1 migration check failed. Run "npm run db:migrate:remote" before deployment.');
    }
    console.error(detail);
    process.exit(1);
}
