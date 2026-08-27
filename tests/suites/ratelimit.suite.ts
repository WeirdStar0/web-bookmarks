import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('ratelimit', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('rate limiting returns 429 after configured threshold', async () => {
        env.RATE_LIMIT_MAX = '2';
        const cookie = await login(env);

        const request = () => app.fetch(new Request('https://example.com/api/data', {
            method: 'GET',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
                'cf-connecting-ip': '203.0.113.10',
            },
        }), env);

        expect((await request()).status).toBe(200);
        expect((await request()).status).toBe(200);

        const limitedResponse = await request();
        expect(limitedResponse.status).toBe(429);
        expect(await limitedResponse.json()).toMatchObject({
            error: 'RATE_LIMITED',
            message: '服务器繁忙，请稍后再试',
        });
    });
});
