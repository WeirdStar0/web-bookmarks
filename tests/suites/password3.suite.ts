import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('password3', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('fails closed in production when a legacy default password has no configured replacement', async () => {
        const noInitialPasswordEnv = {
            ...createEnv(),
            INITIAL_ADMIN_PASSWORD: undefined,
        };
        const db = noInitialPasswordEnv.DB as unknown as MockD1Database;
        const legacyHash = '5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5';
        db.settings.set('username', 'admin');
        db.settings.set('password', legacyHash);
        resetInitState();

        const response = await app.fetch(new Request('https://example.com/'), noInitialPasswordEnv);
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ error: 'DEPLOYMENT_NOT_INITIALIZED' });
        expect(db.settings.get('password')).toBe(legacyHash);
    });
});
