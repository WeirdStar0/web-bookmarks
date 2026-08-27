import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { getConfig } from '../../src/utils/common'

describe('ratelimitclamp', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('clamps rate limit windows to the KV minimum TTL', () => {
        const config = getConfig({
            RATE_LIMIT_WINDOW: '30',
            RATE_LIMIT_LOGIN_WINDOW: '10',
        } as Parameters<typeof getConfig>[0]);
        expect(config.rateLimitWindow).toBe(60);
        expect(config.rateLimitLoginWindow).toBe(60);
    });
});
