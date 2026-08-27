import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { normalizeSql } from '../helpers'

describe('importinit', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('serializes concurrent first-request database initialization', async () => {
        resetInitState();
        const db = env.DB as unknown as MockD1Database;
        const originalExecuteFirst = db.executeFirst.bind(db);
        let releaseInitialProbe: (() => void) | undefined;
        let initialProbeStarted = false;
        db.executeFirst = async (sql: string, bindings: unknown[]) => {
            if (!initialProbeStarted && normalizeSql(sql).startsWith('SELECT 1 FROM settings LIMIT 1') && !db.initialized) {
                initialProbeStarted = true;
                await new Promise<void>((resolve) => {
                    releaseInitialProbe = resolve;
                });
            }
            return originalExecuteFirst(sql, bindings);
        };

        const firstRequest = app.fetch(new Request('https://example.com/'), env);
        for (let attempt = 0; attempt < 10 && !initialProbeStarted; attempt += 1) {
            await Promise.resolve();
        }
        expect(initialProbeStarted).toBe(true);

        const secondRequest = app.fetch(new Request('https://example.com/'), env);
        await Promise.resolve();
        expect(db.settingsProbeCount).toBe(0);
        releaseInitialProbe?.();

        const [firstResponse, secondResponse] = await Promise.all([firstRequest, secondRequest]);
        expect(firstResponse.status).toBe(200);
        expect(secondResponse.status).toBe(200);
        expect(db.settingsProbeCount).toBe(1);
    });
});
