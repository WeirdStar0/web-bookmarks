import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { INIT_SQL } from '../../src/db/schema';

describe('importtriggers', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('ensures INIT_SQL trigger definitions are syntactically complete and not empty', () => {
        for (const sql of INIT_SQL) {
            const normalized = sql.replace(/\s+/g, ' ').trim();
            const upper = normalized.toUpperCase();

            if (upper.includes('CREATE TRIGGER')) {
                expect(upper).toContain(' BEGIN ');
                expect(upper.endsWith(' END')).toBe(true);

                const hasAction = upper.includes('RAISE(') || upper.includes('UPDATE ');
                expect(hasAction).toBe(true);
            }
        }
    });
});
