const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e',
    testMatch: '**/*.e2e.cjs',
    timeout: 30_000,
    expect: { timeout: 5_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: process.env.CI ? 'line' : 'list',
    use: {
        baseURL: 'http://127.0.0.1:8787',
        headless: true,
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'npm run db:migrate:local && npm run dev -- --ip 127.0.0.1 --port 8787',
        url: 'http://127.0.0.1:8787',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
});
