const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const gatePath = path.join(rootDir, 'scripts', 'check_production_config.js');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-bookmarks-config-gate-'));

function runGate(config) {
    const configPath = path.join(tempDir, `wrangler-${Math.random().toString(16).slice(2)}.toml`);
    fs.writeFileSync(configPath, config, 'utf8');
    return spawnSync(process.execPath, [gatePath], {
        encoding: 'utf8',
        env: { ...process.env, WRANGLER_CONFIG_PATH: configPath },
    });
}

try {
    const previewOnly = runGate(`
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
preview_id = "preview-only-id"
`);
    assert.equal(previewOnly.status, 1, 'preview_id alone must block production deployment');
    assert.match(previewOnly.stderr, /production id/i);

    const productionId = runGate(`
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "production-namespace-id"
preview_id = "preview-namespace-id"
`);
    assert.equal(productionId.status, 0, 'a production KV id must satisfy deployment gate');
    assert.match(productionId.stdout, /passed/i);

    // The pre-deploy gate must stay local-only: a first deployment must not
    // be blocked by a remote database that has not been created or migrated
    // yet. Remote ledger verification is a separate, explicit command that
    // runs after `db:migrate:remote` and after deployment.
    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    assert.match(packageJson.scripts['deploy:check'], /check:migrations/, 'deploy:check must validate the local migration file set');
    assert.doesNotMatch(packageJson.scripts['deploy:check'], /check_remote_d1_migrations/, 'deploy:check must not require remote D1 migrations before first deploy');
    assert.match(packageJson.scripts['verify:remote-migrations'], /check_remote_d1_migrations/, 'verify:remote-migrations must run the remote ledger check');

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const deployCheck = spawnSync(npmCommand, ['run', 'deploy:check'], {
        cwd: rootDir,
        encoding: 'utf8',
        shell: process.platform === 'win32',
    });
    assert.equal(deployCheck.status, 0, `deploy:check must pass without touching remote D1 (error: ${deployCheck.error} stdout: ${deployCheck.stdout} stderr: ${deployCheck.stderr})`);

    console.log('Production configuration gate checks passed.');
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
