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

    console.log('Production configuration gate checks passed.');
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
