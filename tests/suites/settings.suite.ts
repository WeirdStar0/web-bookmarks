import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('settings', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('invalidates existing sessions after administrator credentials change', async () => {
        const originalCookie = await login(env);
        const replacementPassword = 'rotated-session-password-2026';

        const updateResponse = await app.fetch(new Request('https://example.com/api/settings', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: originalCookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ password: replacementPassword }),
        }), env);
        expect(updateResponse.status).toBe(200);

        const staleSessionResponse = await app.fetch(new Request('https://example.com/api/data', {
            headers: { Cookie: originalCookie, Origin: 'https://example.com' },
        }), env);
        expect(staleSessionResponse.status).toBe(401);

        const freshLoginResponse = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
            body: JSON.stringify({ username: 'admin', password: replacementPassword }),
        }), env);
        expect(freshLoginResponse.status).toBe(200);
        const freshCookie = freshLoginResponse.headers.get('set-cookie');
        expect(freshCookie).toBeTruthy();

        const freshSessionResponse = await app.fetch(new Request('https://example.com/api/data', {
            headers: { Cookie: freshCookie as string, Origin: 'https://example.com' },
        }), env);
        expect(freshSessionResponse.status).toBe(200);
    });
});
