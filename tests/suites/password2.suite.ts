import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { hashPasswordV2 } from '../../src/utils/common'

describe('password2', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('does not overwrite a concurrent credential change during legacy password upgrade', async () => {
        const db = env.DB as unknown as MockD1Database;
        const legacyPassword = 'legacy-password-2026';
        const legacySalt = '0123456789abcdef0123456789abcdef';
        const legacyHash = await hashPasswordV2(legacyPassword, legacySalt);
        const concurrentPasswordValue = 'concurrent-password-replacement';
        db.settings.set('username', 'admin');
        db.settings.set('password', `v2:${legacyHash.salt}:${legacyHash.hash}`);
        const originalPrepare = db.prepare.bind(db);
        db.prepare = ((sql: string) => {
            const statement = originalPrepare(sql);
            if (sql.includes('UPDATE settings SET value = ? WHERE key = ? AND value = ?')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    db.settings.set('password', concurrentPasswordValue);
                    return originalRun();
                };
            }
            return statement;
        }) as typeof db.prepare;

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
            body: JSON.stringify({ username: 'admin', password: legacyPassword }),
        }), env);

        expect(response.status).toBe(401);
        expect(db.settings.get('password')).toBe(concurrentPasswordValue);
        expect(response.headers.get('set-cookie')).toBeNull();
    });
});
