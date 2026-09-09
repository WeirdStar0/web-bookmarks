import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { normalizeSql } from '../helpers'

describe('initfails', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('fails closed when a local session secret cannot be persisted or recovered from D1', async () => {
        resetInitState();
        const secretlessEnv = {
            ...createEnv(),
            SECRET_KEY: '',
        };
        const db = secretlessEnv.DB as unknown as MockD1Database;
        const originalExecuteRun = db.executeRun.bind(db);
        db.executeRun = async (sql: string, bindings: unknown[]) => {
            if (normalizeSql(sql).startsWith('INSERT INTO settings (key, value) VALUES (?, ?)')
                && bindings[0] === 'secret_key') {
                throw new Error('Simulated secret-key write failure');
            }
            return originalExecuteRun(sql, bindings);
        };

        // Non-local hosts fail closed before touching D1; the persist-or-recover
        // path only runs for local development.
        const response = await app.fetch(new Request('http://localhost:8787/'), secretlessEnv);
        expect(response.status).toBe(500);
        expect(db.settings.has('secret_key')).toBe(false);
    });
});
