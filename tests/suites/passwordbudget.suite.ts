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
        // Production workerd rejects PBKDF2 iteration counts above 100k
        // (cloudflare/workerd#1346), and the Workers Free plan enforces a
        // 10 ms CPU budget that even 100k iterations would exceed.
        expect(parsed!.iterations).toBe(25_000);
    });
});
