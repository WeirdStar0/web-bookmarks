import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { getConfig } from '../../src/utils/common'

describe('config', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('uses bounded secure defaults for malformed session and rate-limit configuration', () => {
        const config = getConfig({
            ...env,
            SESSION_MAX_AGE: 'not-a-number',
            RATE_LIMIT_MAX: '-1',
            RATE_LIMIT_WINDOW: '0',
            RATE_LIMIT_LOGIN_MAX: '101',
            RATE_LIMIT_LOGIN_WINDOW: '999999',
        });

        expect(config).toMatchObject({
            sessionMaxAge: 604800,
            rateLimitMax: 100,
            rateLimitWindow: 60,
            rateLimitLoginMax: 5,
            rateLimitLoginWindow: 60,
        });
    });
});
