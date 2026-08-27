import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

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
});
