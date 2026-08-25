const fs = require('fs');
const path = require('path');

const configPath = process.env.WRANGLER_CONFIG_PATH || path.resolve(__dirname, '..', 'wrangler.toml');
const config = fs.readFileSync(configPath, 'utf8');

const kvNamespaceBlocks = config.match(/\[\[kv_namespaces\]\][\s\S]*?(?=\n\s*\[\[|$)/g) || [];
const hasRateLimitBinding = kvNamespaceBlocks.some((block) => {
    return /^\s*binding\s*=\s*["']RATE_LIMIT_KV["']\s*$/m.test(block)
        && /^\s*id\s*=\s*["'][^"']+["']\s*$/m.test(block);
});

if (!hasRateLimitBinding) {
    console.error('\nProduction deployment blocked: RATE_LIMIT_KV is not bound in wrangler.toml.');
    console.error('Create a KV namespace, then add a [[kv_namespaces]] block with binding = "RATE_LIMIT_KV" and its production id (preview_id alone is not sufficient).');
    console.error('This is required because /api/login fails closed when rate limiting is unavailable.\n');
    process.exit(1);
}

console.log('Production configuration check passed: RATE_LIMIT_KV binding found.');
