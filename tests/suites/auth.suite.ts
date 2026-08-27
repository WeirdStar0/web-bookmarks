import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { TEST_INITIAL_ADMIN_PASSWORD } from '../constants';
import { createEnvWithoutExtensionAllowlist } from '../helpers'

describe('auth', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('uses Lax session cookies for web logins and None only for trusted extension logins', async () => {
        const webResponse = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
            body: JSON.stringify({ username: 'admin', password: TEST_INITIAL_ADMIN_PASSWORD }),
        }), env);
        expect(webResponse.status).toBe(200);
        expect(webResponse.headers.get('set-cookie')).toContain('SameSite=Lax');

        const extensionResponse = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'chrome-extension://allowed-extension-id',
            },
            body: JSON.stringify({ username: 'admin', password: TEST_INITIAL_ADMIN_PASSWORD }),
        }), env);
        expect(extensionResponse.status).toBe(200);
        expect(extensionResponse.headers.get('set-cookie')).toContain('SameSite=None');
        expect(extensionResponse.headers.get('set-cookie')).toContain('Secure');
    });

    it('only returns CORS headers for configured extension origins', async () => {
        const allowedResponse = await app.fetch(new Request('https://example.com/api/data', {
            method: 'OPTIONS',
            headers: {
                Origin: 'chrome-extension://allowed-extension-id',
                'Access-Control-Request-Method': 'GET',
            },
        }), env);
        expect(allowedResponse.headers.get('access-control-allow-origin')).toBe('chrome-extension://allowed-extension-id');

        const blockedResponse = await app.fetch(new Request('https://example.com/api/data', {
            method: 'OPTIONS',
            headers: {
                Origin: 'chrome-extension://blocked-extension-id',
                'Access-Control-Request-Method': 'GET',
            },
        }), env);
        expect(blockedResponse.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('allows the idempotency header for configured extension bookmark saves', async () => {
        const response = await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'OPTIONS',
            headers: {
                Origin: 'chrome-extension://allowed-extension-id',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type,idempotency-key',
            },
        }), env);

        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-origin')).toBe('chrome-extension://allowed-extension-id');
        expect(response.headers.get('access-control-allow-credentials')).toBe('true');
        expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('idempotency-key');
    });

    it('rejects extension requests when no allowlist is configured', async () => {
        const noAllowlistEnv = createEnvWithoutExtensionAllowlist();

        const corsResponse = await app.fetch(new Request('https://example.com/api/data', {
            method: 'OPTIONS',
            headers: {
                Origin: 'chrome-extension://existing-extension-id',
                'Access-Control-Request-Method': 'GET',
            },
        }), noAllowlistEnv);
        expect(corsResponse.status).toBe(403);
        expect(corsResponse.headers.get('access-control-allow-origin')).toBeNull();

        const loginResponse = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'chrome-extension://existing-extension-id',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), noAllowlistEnv);
        expect(loginResponse.status).toBe(403);
    });

    it('enforces the allowlist once extension origins are explicitly configured', async () => {
        const blockedPreflightResponse = await app.fetch(new Request('https://example.com/api/data', {
            method: 'OPTIONS',
            headers: {
                Origin: 'chrome-extension://blocked-extension-id',
                'Access-Control-Request-Method': 'GET',
            },
        }), env);

        expect(blockedPreflightResponse.status).toBe(403);
        expect(blockedPreflightResponse.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('rejects credentialed api calls from other workers.dev origins', async () => {
        const cookie = await login(env);

        const response = await app.fetch(new Request('https://bookmarks.example.workers.dev/api/data', {
            method: 'GET',
            headers: {
                Cookie: cookie,
                Origin: 'https://attacker.workers.dev',
            },
        }), env);

        expect(response.status).toBe(403);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        expect(await response.json()).toMatchObject({
            error: 'FORBIDDEN',
            message: 'Origin not allowed',
        });
    });

    it('rejects protected api routes without a valid auth cookie', async () => {
        const response = await app.fetch(new Request('https://example.com/api/data', {
            method: 'GET',
            headers: {
                Origin: 'https://example.com',
            },
        }), env);

        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({
            error: 'UNAUTHORIZED',
            message: 'Unauthorized',
        });
    });
});
