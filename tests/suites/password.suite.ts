import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { TEST_INITIAL_ADMIN_PASSWORD } from '../constants';

describe('password', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('replaces the legacy default password with the configured initial password', async () => {
        const db = env.DB as unknown as MockD1Database;
        db.settings.set('username', 'admin');
        db.settings.set('password', '5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5');

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
        expect(db.settings.get('password')).not.toBe('5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5');
    });
});
