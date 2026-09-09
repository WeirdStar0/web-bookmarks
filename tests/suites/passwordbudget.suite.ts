import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { parsePasswordHashV3 } from '../../src/utils/common'

describe('passwordbudget', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('derives new password hashes within the free-plan CPU budget', async () => {
        await login(env);
        const db = env.DB as unknown as MockD1Database;
        const stored = db.settings.get('password') ?? '';
        const parsed = parsePasswordHashV3(stored);
        expect(parsed).not.toBeNull();
        // Fresh hashes target 90k iterations: measured workerd timings are
        // 25k=5ms, 90k=15ms, 100k=17ms, the v2 era already ran 100k per login
        // in production, and workerd rejects counts above 100k
        // (cloudflare/workerd#1346). See docs/password-v4-design.md.
        expect(parsed!.iterations).toBe(90_000);
    });
});
