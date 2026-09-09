import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, type TestEnv } from '../helpers';
import { hashPasswordV3, hashPasswordV4, parsePasswordHashV4, serializePasswordHashV3 } from '../../src/utils/common';
import { TEST_INITIAL_ADMIN_PASSWORD } from '../constants';

const PEPPER_MATERIAL = 'unit-test-pepper-material-with-enough-length';
const LEGACY_SALT = '0123456789abcdef0123456789abcdef';

function pepperEnv(pepper: string, previous?: string) {
    return {
        ...createEnv(),
        PASSWORD_PEPPER: pepper,
        PASSWORD_HASH_ITERATIONS: '90000',
        ...(previous ? { PASSWORD_PEPPER_PREVIOUS: previous } : {}),
    };
}

function formatV4(id: string, value: { hash: string; salt: string; iterations: number }): string {
    return `v4:${id}:${value.iterations}:${value.salt}:${value.hash}`;
}

async function postLogin(env: TestEnv, password: string) {
    return app.fetch(new Request('https://example.com/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
        body: JSON.stringify({ username: 'admin', password }),
    }), env);
}

describe('passwordv4', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('creates v4 hashes with the current pepper and verifies them without re-migrating', async () => {
        const peppered = pepperEnv(`k1:${PEPPER_MATERIAL}`);
        expect(await login(peppered)).toBeTruthy();
        const db = peppered.DB as unknown as MockD1Database;
        const parsed = parsePasswordHashV4(db.settings.get('password') ?? '');
        expect(parsed).toMatchObject({ pepperId: 'k1', iterations: 90_000 });

        const second = await postLogin(peppered, TEST_INITIAL_ADMIN_PASSWORD);
        expect(second.status).toBe(200);
        expect(await second.json()).toEqual({ success: true });
    });

    it('fails closed when a stored v4 hash references an unknown pepper id', async () => {
        const peppered = pepperEnv(`k2:${PEPPER_MATERIAL}`);
        const db = peppered.DB as unknown as MockD1Database;
        db.settings.set('username', 'admin');
        const foreign = await hashPasswordV4(TEST_INITIAL_ADMIN_PASSWORD, { id: 'k9', material: PEPPER_MATERIAL }, 90_000);
        const storedValue = formatV4('k9', foreign);
        db.settings.set('password', storedValue);

        const response = await postLogin(peppered, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(401);
        expect(db.settings.get('password')).toBe(storedValue);
    });

    it('verifies against PASSWORD_PEPPER_PREVIOUS and migrates to the current pepper id', async () => {
        const rotated = pepperEnv(`k2:${PEPPER_MATERIAL}`, `k1:${PEPPER_MATERIAL}`);
        const db = rotated.DB as unknown as MockD1Database;
        db.settings.set('username', 'admin');
        const old = await hashPasswordV4(TEST_INITIAL_ADMIN_PASSWORD, { id: 'k1', material: PEPPER_MATERIAL }, 90_000);
        db.settings.set('password', formatV4('k1', old));

        const response = await postLogin(rotated, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ success: true, migrated: true });
        expect(parsePasswordHashV4(db.settings.get('password') ?? '')).toMatchObject({ pepperId: 'k2', iterations: 90_000 });

        const settled = await postLogin(rotated, TEST_INITIAL_ADMIN_PASSWORD);
        expect(settled.status).toBe(200);
        expect(await settled.json()).toEqual({ success: true });
    });

    it('keeps a v4 hash when only PASSWORD_PEPPER_PREVIOUS resolves it', async () => {
        const previousOnly = {
            ...createEnv(),
            PASSWORD_PEPPER_PREVIOUS: `k1:${PEPPER_MATERIAL}`,
        };
        const db = previousOnly.DB as unknown as MockD1Database;
        db.settings.set('username', 'admin');
        const old = await hashPasswordV4(TEST_INITIAL_ADMIN_PASSWORD, { id: 'k1', material: PEPPER_MATERIAL }, 90_000);
        const storedValue = formatV4('k1', old);
        db.settings.set('password', storedValue);

        const response = await postLogin(previousOnly, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true });
        expect(db.settings.get('password')).toBe(storedValue);
    });

    it('keeps a v4 hash when the configured current pepper is malformed', async () => {
        const malformedCurrent = {
            ...createEnv(),
            PASSWORD_PEPPER: 'broken-no-colon',
            PASSWORD_PEPPER_PREVIOUS: `k1:${PEPPER_MATERIAL}`,
        };
        const db = malformedCurrent.DB as unknown as MockD1Database;
        db.settings.set('username', 'admin');
        const old = await hashPasswordV4(TEST_INITIAL_ADMIN_PASSWORD, { id: 'k1', material: PEPPER_MATERIAL }, 90_000);
        const storedValue = formatV4('k1', old);
        db.settings.set('password', storedValue);

        const response = await postLogin(malformedCurrent, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true });
        expect(db.settings.get('password')).toBe(storedValue);
    });

    it('keeps v3 hashes when the configured pepper is malformed', async () => {
        const malformed = {
            ...createEnv(),
            PASSWORD_PEPPER: 'just-a-typo',
        };
        const db = malformed.DB as unknown as MockD1Database;
        db.settings.set('username', 'admin');
        const storedValue = serializePasswordHashV3(await hashPasswordV3(TEST_INITIAL_ADMIN_PASSWORD, 90_000, LEGACY_SALT));
        db.settings.set('password', storedValue);

        const response = await postLogin(malformed, TEST_INITIAL_ADMIN_PASSWORD);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true });
        expect(db.settings.get('password')).toBe(storedValue);
    });

    it('fails closed on password change while the configured pepper is malformed', async () => {
        const malformed = {
            ...createEnv(),
            PASSWORD_PEPPER: 'just-a-typo',
        };
        const db = malformed.DB as unknown as MockD1Database;
        const storedValue = serializePasswordHashV3(await hashPasswordV3(TEST_INITIAL_ADMIN_PASSWORD, 90_000, LEGACY_SALT));
        db.settings.set('username', 'admin');
        db.settings.set('password', storedValue);
        const cookie = await login(malformed);

        const update = await app.fetch(new Request('https://example.com/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ password: 'another-strong-password-2026!' }),
        }), malformed);
        expect(update.status).toBe(500);
        expect(db.settings.get('password')).toBe(storedValue);
    });

    it('applies the pepper when the password changes through settings', async () => {
        const peppered = pepperEnv(`k1:${PEPPER_MATERIAL}`);
        const cookie = await login(peppered);
        const replacement = 'another-strong-password-2026!';

        const update = await app.fetch(new Request('https://example.com/api/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ password: replacement }),
        }), peppered);
        expect(update.status).toBe(200);

        const db = peppered.DB as unknown as MockD1Database;
        expect(parsePasswordHashV4(db.settings.get('password') ?? '')).toMatchObject({ pepperId: 'k1' });

        const relogin = await postLogin(peppered, replacement);
        expect(relogin.status).toBe(200);
    });
});
