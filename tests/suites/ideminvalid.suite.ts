import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('ideminvalid', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('rejects malformed idempotency keys before processing a bookmark create', async () => {
        const cookie = await login(env);
        const response = await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
                Cookie: cookie,
                'Idempotency-Key': 'short',
            },
            body: JSON.stringify({
                title: 'Invalid key',
                url: 'https://example.com/invalid-key',
                folder_id: null,
            }),
        }), env);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: 'IDEMPOTENCY_KEY_INVALID' });
    });
});
