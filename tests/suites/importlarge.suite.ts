import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importlarge', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('rejects large import payloads even if Content-Length header is missing', async () => {
        const cookie = await login(env);
        const largeBody = 'a'.repeat(2 * 1024 * 1024 + 1);

        const response = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
                // 故意不传 Content-Length
            },
            body: largeBody,
        }), env);

        expect(response.status).toBe(413);
        const data = await response.json() as any;
        expect(data).toMatchObject({
            error: 'PAYLOAD_TOO_LARGE',
        });
    });
});
