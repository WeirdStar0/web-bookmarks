import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

type SecretlessEnv = Omit<ReturnType<typeof createEnv>, 'SECRET_KEY'>;

function createEnvWithoutSecret(): SecretlessEnv {
    const { SECRET_KEY: _omitted, ...secretless } = createEnv();
    return secretless;
}

describe('initsecret', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('throws an error when auto-initialization fails during app boot', async () => {
        resetInitState();
        const badEnv = createEnv();
        (badEnv.DB as any).executeRun = async () => {
            throw new Error('Simulated D1 initialization failure');
        };

        const response = await app.fetch(new Request('https://example.com/'), badEnv);
        expect(response.status).toBe(500);

        const body = await response.json() as any;
        expect(body).toMatchObject({
            error: 'Internal Server Error',
        });
    });

    it('fails closed on a non-local host without SECRET_KEY even when D1 carries a legacy secret', async () => {
        const secretless = createEnvWithoutSecret();
        const db = secretless.DB as unknown as MockD1Database;
        db.settings.set('secret_key', 'legacy-d1-managed-secret');

        const response = await app.fetch(new Request('https://example.com/'), secretless);
        expect(response.status).toBe(503);

        const body = await response.json() as any;
        expect(body).toMatchObject({ error: 'DEPLOYMENT_NOT_INITIALIZED' });
    });

    it('still auto-generates a D1-backed secret for local development', async () => {
        const secretless = createEnvWithoutSecret();

        const response = await app.fetch(new Request('http://localhost:8787/'), secretless);
        expect(response.status).toBe(200);

        const db = secretless.DB as unknown as MockD1Database;
        expect(db.settings.get('secret_key')).toBeTruthy();
    });

    it('does not persist a D1 secret when SECRET_KEY is provided', async () => {
        const response = await app.fetch(new Request('https://example.com/'), env);
        expect(response.status).toBe(200);

        const db = env.DB as unknown as MockD1Database;
        expect(db.settings.get('secret_key')).toBeUndefined();
    });
});
