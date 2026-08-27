import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { TEST_INITIAL_ADMIN_PASSWORD } from '../constants';

describe('ratelimithrow', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('fails closed for login when rate limiting storage throws at runtime', async () => {
        const failingRateLimitEnv = {
            ...createEnv(),
            RATE_LIMIT_KV: new FailingKVNamespace() as unknown as KVNamespace,
        };
        resetInitState();

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), failingRateLimitEnv);

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
            error: 'RATE_LIMIT_UNAVAILABLE',
        });
    });
});
