import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { TEST_INITIAL_ADMIN_PASSWORD } from '../constants';

describe('ratelimitttl', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('keeps login rate limiting working when the remaining KV window is shorter than the minimum TTL', async () => {
        const strictKv = new StrictTtlKVNamespace();
        const ttlEnv = {
            ...createEnv(),
            RATE_LIMIT_KV: strictKv as unknown as KVNamespace,
        };
        resetInitState();

        // Simulate an in-flight window whose remaining lifetime is below the
        // 60-second minimum TTL enforced by real Workers KV.
        await strictKv.seedRaw('ratelimit:login:unknown', JSON.stringify({
            count: 1,
            resetTime: Date.now() + 30_000,
        }));

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
        }), ttlEnv);

        expect(response.status).toBe(200);
        expect(strictKv.puts.length).toBeGreaterThan(0);
        for (const put of strictKv.puts) {
            expect(put.ttl === undefined || put.ttl >= 60).toBe(true);
        }
    });
});
