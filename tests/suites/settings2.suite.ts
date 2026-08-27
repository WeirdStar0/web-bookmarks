import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('settings2', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('keeps credentials and session version unchanged when settings batch fails', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const originalUsername = db.settings.get('username');
        const originalPassword = db.settings.get('password');
        const originalSessionVersion = db.settings.get('session_version');
        db.batch = async () => {
            throw new Error('Simulated atomic settings batch failure');
        };

        const response = await app.fetch(new Request('https://example.com/api/settings', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ username: 'new-admin', password: 'new-password-after-batch-failure' }),
        }), env);
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ error: 'Internal Server Error' });
        expect(db.settings.get('username')).toBe(originalUsername);
        expect(db.settings.get('password')).toBe(originalPassword);
        expect(db.settings.get('session_version')).toBe(originalSessionVersion);

        const existingSessionResponse = await app.fetch(new Request('https://example.com/api/data', {
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);
        expect(existingSessionResponse.status).toBe(200);
    });
});
