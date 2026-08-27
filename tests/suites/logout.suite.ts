import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('logout', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('invalidates copied sessions after logout', async () => {
        const copiedCookie = await login(env);
        const logoutResponse = await app.fetch(new Request('https://example.com/api/logout', {
            method: 'POST',
            headers: { Cookie: copiedCookie, Origin: 'https://example.com' },
        }), env);
        expect(logoutResponse.status).toBe(200);

        const staleCopyResponse = await app.fetch(new Request('https://example.com/api/data', {
            headers: { Cookie: copiedCookie, Origin: 'https://example.com' },
        }), env);
        expect(staleCopyResponse.status).toBe(401);
    });
});
