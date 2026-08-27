import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importsize', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('enforces size and complexity limits on import endpoint', async () => {
        const cookie = await login(env);

        const sizeResponse = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
                'Content-Length': (3 * 1024 * 1024).toString(),
            },
            body: 'a'.repeat(100),
        }), env);
        expect(sizeResponse.status).toBe(413);

        let deepHtml = '<!DOCTYPE NETSCAPE-Bookmark-file-1>';
        for(let i=0; i<10; i++) {
            deepHtml += `<DL><p><DT><H3>Folder ${i}</H3>`;
        }
        deepHtml += '<DT><A HREF="https://nested.com">Nested</A>';
        for(let i=0; i<10; i++) {
            deepHtml += '</DL><p>';
        }

        const depthResponse = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: deepHtml,
        }), env);
        expect(depthResponse.status).toBe(200);
        const data = await depthResponse.json() as any;
        expect(data.success).toBe(true);
    });
});
