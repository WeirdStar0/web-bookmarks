import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, MockD1Database, type TestEnv } from '../helpers';
import { hashPassword, hashPasswordV2, hashPasswordV3, hashPasswordV4, parsePasswordHashV3, parsePasswordHashV4, serializePasswordHashV3 } from '../../src/utils/common';
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
        const peppered = {
            ...createEnv(),
            PASSWORD_PEPPER: `k1:${PEPPER_MATERIAL}`,
            PASSWORD_HASH_ITERATIONS: '90000',
        };
        const db = peppered.DB as unknown as MockD1Database;
        const storedValue = await seedLegacyV3(db);

        const response = await postLogin(peppered, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ success: true, migrated: true });
        expect(parsePasswordHashV4(db.settings.get('password') ?? '')).toMatchObject({ pepperId: 'k1', iterations: 90_000 });
        expect(db.settings.get('password')).not.toBe(storedValue);
    });

    it('migrates a legacy v3 hash to a stronger v3 when a higher factor is configured', async () => {
        const configured = { ...createEnv(), PASSWORD_HASH_ITERATIONS: '90000' };
        const db = configured.DB as unknown as MockD1Database;
        await seedLegacyV3(db);

        const response = await postLogin(configured, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ success: true, migrated: true });
        expect(parsePasswordHashV3(db.settings.get('password') ?? '')).toMatchObject({ iterations: 90_000 });
    });

    it('leaves an already-current v3 hash untouched when no pepper is configured', async () => {
        const db = env.DB as unknown as MockD1Database;
        const current = serializePasswordHashV3(await hashPasswordV3(TEST_INITIAL_ADMIN_PASSWORD, 25_000, LEGACY_SALT));
        db.settings.set('username', 'admin');
        db.settings.set('password', current);

        const response = await postLogin(env, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true });
        expect(db.settings.get('password')).toBe(current);
    });

    it('keeps a 90k v4 hash when the configured factor drops back to the default', async () => {
        const peppered = { ...createEnv(), PASSWORD_PEPPER: `k1:${PEPPER_MATERIAL}` };
        const db = peppered.DB as unknown as MockD1Database;
        db.settings.set('username', 'admin');
        const high = await hashPasswordV4(TEST_INITIAL_ADMIN_PASSWORD, { id: 'k1', material: PEPPER_MATERIAL }, 90_000);
        const storedValue = `v4:k1:${high.iterations}:${high.salt}:${high.hash}`;
        db.settings.set('password', storedValue);

        const response = await postLogin(peppered, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true });
        expect(parsePasswordHashV4(db.settings.get('password') ?? '')).toMatchObject({ pepperId: 'k1', iterations: 90_000 });
    });

    it('migrates a 90k v3 hash to v4 without lowering the work factor', async () => {
        const peppered = { ...createEnv(), PASSWORD_PEPPER: `k1:${PEPPER_MATERIAL}` };
        const db = peppered.DB as unknown as MockD1Database;
        db.settings.set('username', 'admin');
        db.settings.set('password', serializePasswordHashV3(await hashPasswordV3(TEST_INITIAL_ADMIN_PASSWORD, 90_000, LEGACY_SALT)));

        const response = await postLogin(peppered, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ success: true, migrated: true });
        expect(parsePasswordHashV4(db.settings.get('password') ?? '')).toMatchObject({ pepperId: 'k1', iterations: 90_000 });
    });

    it('keeps a 90k v3 hash when no pepper is configured and the factor drops', async () => {
        const db = env.DB as unknown as MockD1Database;
        const storedValue = serializePasswordHashV3(await hashPasswordV3(TEST_INITIAL_ADMIN_PASSWORD, 90_000, LEGACY_SALT));
        db.settings.set('username', 'admin');
        db.settings.set('password', storedValue);

        const response = await postLogin(env, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true });
        expect(db.settings.get('password')).toBe(storedValue);
    });

    it('migrates a legacy v2 hash to v3 without lowering the 100k factor', async () => {
        const db = env.DB as unknown as MockD1Database;
        const legacy = await hashPasswordV2('legacy-password-2026', LEGACY_SALT);
        db.settings.set('username', 'admin');
        db.settings.set('password', `v2:${legacy.salt}:${legacy.hash}`);

        const response = await postLogin(env, 'legacy-password-2026');
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ success: true, migrated: true });
        expect(parsePasswordHashV3(db.settings.get('password') ?? '')).toMatchObject({ iterations: 100_000 });
    });

    it('migrates a legacy v2 hash to v4 at 100k when a pepper is configured', async () => {
        const peppered = { ...createEnv(), PASSWORD_PEPPER: `k1:${PEPPER_MATERIAL}` };
        const db = peppered.DB as unknown as MockD1Database;
        const legacy = await hashPasswordV2('legacy-password-2026', LEGACY_SALT);
        db.settings.set('username', 'admin');
        db.settings.set('password', `v2:${legacy.salt}:${legacy.hash}`);

        const response = await postLogin(peppered, 'legacy-password-2026');
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ success: true, migrated: true });
        expect(parsePasswordHashV4(db.settings.get('password') ?? '')).toMatchObject({ pepperId: 'k1', iterations: 100_000 });
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
