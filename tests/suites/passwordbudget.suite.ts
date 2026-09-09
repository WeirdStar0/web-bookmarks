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

    it('derives new password hashes at the Free-safe default work factor', async () => {
        await login(env);
        const db = env.DB as unknown as MockD1Database;
        const stored = db.settings.get('password') ?? '';
        const parsed = parsePasswordHashV3(stored);
        expect(parsed).not.toBeNull();
        // Workers Free enforces a 10 ms CPU budget per invocation, and a
        // migration login can derive twice (verify at the stored factor plus
        // the re-hash), so 25k is the only default with production evidence
        // under it. See docs/password-v4-design.md.
        expect(parsed!.iterations).toBe(25_000);
    });

    it('honors an in-range configured work factor and falls back out of range', async () => {
        const configured = { ...createEnv(), PASSWORD_HASH_ITERATIONS: '90000' };
        await login(configured);
        const configuredDb = configured.DB as unknown as MockD1Database;
        expect(parsePasswordHashV3(configuredDb.settings.get('password') ?? '')).toMatchObject({ iterations: 90_000 });

        // Each env carries its own fresh mock database, so the init
        // middleware's one-per-isolate boot cache must be reset between them.
        resetInitState();
        const outOfRange = { ...createEnv(), PASSWORD_HASH_ITERATIONS: '150000' };
        await login(outOfRange);
        const fallbackDb = outOfRange.DB as unknown as MockD1Database;
        expect(parsePasswordHashV3(fallbackDb.settings.get('password') ?? '')).toMatchObject({ iterations: 25_000 });
    });
});
