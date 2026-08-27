import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('ratelimitlogin', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('enforces strict rate limiting on login endpoint', async () => {
        env.RATE_LIMIT_LOGIN_MAX = '2';
        env.RATE_LIMIT_LOGIN_WINDOW = '60';

        const makeLoginRequest = () => app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
                'cf-connecting-ip': '203.0.113.50',
            },
            body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
        }), env);

        expect((await makeLoginRequest()).status).toBe(401);
        expect((await makeLoginRequest()).status).toBe(401);

        const limitedResponse = await makeLoginRequest();
        expect(limitedResponse.status).toBe(429);
        expect(await limitedResponse.json()).toMatchObject({
            error: 'RATE_LIMITED',
        });
    });
});
