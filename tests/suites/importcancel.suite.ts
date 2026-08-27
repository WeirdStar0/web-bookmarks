import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importcancel', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('returns 413 when cancelling an oversized import stream fails', async () => {
        const cookie = await login(env);
        let cancelCalled = false;
        const oversizedStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('a'.repeat(2 * 1024 * 1024 + 1)));
            },
            cancel() {
                cancelCalled = true;
                return Promise.reject(new Error('Simulated stream cancel failure'));
            },
        });
        const request = new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: oversizedStream,
            // Required by the Node-compatible Request implementation for a
            // streaming POST body; ignored by the Workers runtime.
            duplex: 'half',
        } as RequestInit & { duplex: string });

        const response = await app.fetch(request, env);
        expect(response.status).toBe(413);
        expect(cancelCalled).toBe(true);
        expect(await response.json()).toMatchObject({ error: 'PAYLOAD_TOO_LARGE' });
    });
});
