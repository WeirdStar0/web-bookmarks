import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { TEST_INITIAL_ADMIN_PASSWORD } from '../constants';

describe('init', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('fails closed when administrator settings cannot be read during initialization', async () => {
        const db = env.DB as unknown as MockD1Database;
        const originalPrepare = db.prepare.bind(db);
        db.prepare = ((sql: string) => {
            if (sql.trim() === 'SELECT key, value FROM settings') {
                throw new Error('Simulated administrator settings read failure');
            }
            return originalPrepare(sql);
        }) as typeof db.prepare;
        resetInitState();

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
            body: JSON.stringify({ username: 'admin', password: TEST_INITIAL_ADMIN_PASSWORD }),
        }), env);

        expect(response.status).toBe(500);
    });

    it('requires an initial admin password in production when settings are empty', async () => {
        const productionEnv = {
            ...createEnv(),
            INITIAL_ADMIN_PASSWORD: undefined,
        };
        resetInitState();

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), productionEnv);

        expect(response.status).toBe(500);
        const db = productionEnv.DB as unknown as MockD1Database;
        expect(db.settings.has('username')).toBe(false);
        expect(db.settings.has('password')).toBe(false);
    });

    it('repairs partial admin settings when an initial admin password is configured', async () => {
        const db = env.DB as unknown as MockD1Database;
        db.settings.set('username', 'admin');

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), env);

        expect(response.status).toBe(200);
        expect(db.settings.get('password')).toBeTruthy();
    });
});
