import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importmalformed', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('rejects excessive malformed import tag candidates before rich parsing', async () => {
        const cookie = await login(env);
        const malformedBody = '<H3>'.repeat(5001);
        const response = await app.fetch(new Request('https://example.com/api/import?dryRun=true', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: malformedBody,
        }), env);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: 'COMPLEXITY_LIMIT_EXCEEDED' });
    });
});
