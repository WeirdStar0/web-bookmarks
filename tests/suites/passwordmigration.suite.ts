import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, MockD1Database, type TestEnv } from '../helpers';
import { hashPassword, hashPasswordV3, parsePasswordHashV3, parsePasswordHashV4, serializePasswordHashV3 } from '../../src/utils/common';
import { TEST_INITIAL_ADMIN_PASSWORD } from '../constants';

const PEPPER_MATERIAL = 'unit-test-pepper-material-with-enough-length';
const LEGACY_SALT = '0123456789abcdef0123456789abcdef';

async function seedLegacyV3(db: MockD1Database): Promise<string> {
    const storedValue = serializePasswordHashV3(await hashPasswordV3(TEST_INITIAL_ADMIN_PASSWORD, 25_000, LEGACY_SALT));
    db.settings.set('username', 'admin');
    db.settings.set('password', storedValue);
    return storedValue;
}

async function postLogin(env: TestEnv, password: string) {
    return app.fetch(new Request('https://example.com/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
        body: JSON.stringify({ username: 'admin', password }),
    }), env);
}

describe('passwordmigration', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('migrates a legacy v3 hash to v4 on successful login', async () => {
        const peppered = { ...createEnv(), PASSWORD_PEPPER: `k1:${PEPPER_MATERIAL}` };
        const db = peppered.DB as unknown as MockD1Database;
        const storedValue = await seedLegacyV3(db);

        const response = await postLogin(peppered, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ success: true, migrated: true });
        expect(parsePasswordHashV4(db.settings.get('password') ?? '')).toMatchObject({ pepperId: 'k1', iterations: 90_000 });
        expect(db.settings.get('password')).not.toBe(storedValue);
    });

    it('migrates a legacy v3 hash to a stronger v3 when no pepper is configured', async () => {
        const db = env.DB as unknown as MockD1Database;
        await seedLegacyV3(db);

        const response = await postLogin(env, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ success: true, migrated: true });
        expect(parsePasswordHashV3(db.settings.get('password') ?? '')).toMatchObject({ iterations: 90_000 });
    });

    it('leaves an already-current v3 hash untouched when no pepper is configured', async () => {
        const db = env.DB as unknown as MockD1Database;
        const current = serializePasswordHashV3(await hashPasswordV3(TEST_INITIAL_ADMIN_PASSWORD, 90_000, LEGACY_SALT));
        db.settings.set('username', 'admin');
        db.settings.set('password', current);

        const response = await postLogin(env, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true });
        expect(db.settings.get('password')).toBe(current);
    });

    it('does not fail the login when the migration write throws', async () => {
        const peppered = { ...createEnv(), PASSWORD_PEPPER: `k1:${PEPPER_MATERIAL}` };
        const db = peppered.DB as unknown as MockD1Database;
        const storedValue = await seedLegacyV3(db);
        const originalPrepare = db.prepare.bind(db);
        db.prepare = ((sql: string) => {
            const statement = originalPrepare(sql);
            if (sql.includes('UPDATE settings SET value = ? WHERE key = ? AND value = ?')) {
                statement.run = async () => {
                    throw new Error('Simulated storage failure during migration');
                };
            }
            return statement;
        }) as typeof db.prepare;

        const response = await postLogin(peppered, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true });
        expect(db.settings.get('password')).toBe(storedValue);
    });

    it('fails closed cleanly on stored hashes claiming more than 100k iterations', async () => {
        const db = env.DB as unknown as MockD1Database;
        const salt = '0123456789abcdef0123456789abcdef';
        const hash = 'a'.repeat(64);
        db.settings.set('username', 'admin');

        // workerd rejects PBKDF2 derivations above 100k, so such hashes can
        // never be verified; the parsers must reject them before derivation
        // instead of surfacing a 500 from deriveBits.
        db.settings.set('password', `v3:100001:${salt}:${hash}`);
        const v3Response = await postLogin(env, TEST_INITIAL_ADMIN_PASSWORD);
        expect(v3Response.status).toBe(401);
        expect(await v3Response.json()).toMatchObject({ error: 'INVALID_CREDENTIALS' });

        db.settings.set('password', `v4:k1:100001:${salt}:${hash}`);
        const v4Response = await postLogin(env, TEST_INITIAL_ADMIN_PASSWORD);
        expect(v4Response.status).toBe(401);
        expect(await v4Response.json()).toMatchObject({ error: 'INVALID_CREDENTIALS' });
    });

    it('aborts a legacy v1 login when the stored credential changed concurrently', async () => {
        const db = env.DB as unknown as MockD1Database;
        const legacyPassword = 'legacy-password-2026';
        const legacyHash = await hashPassword(legacyPassword);
        const concurrentPasswordValue = 'concurrent-password-replacement';
        db.settings.set('username', 'admin');
        db.settings.set('password', legacyHash);
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

        const response = await postLogin(env, legacyPassword);
        expect(response.status).toBe(401);
        expect(db.settings.get('password')).toBe(concurrentPasswordValue);
        expect(response.headers.get('set-cookie')).toBeNull();
    });
});
