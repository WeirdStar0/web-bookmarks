import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importdepth', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('enforces depth limit on import endpoint and rejects with 400', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialFolders = db.folders.length;

        // 构建 13 层深度文件夹
        let deepHtml = '<!DOCTYPE NETSCAPE-Bookmark-file-1>';
        for (let i = 0; i < 13; i++) {
            deepHtml += `<DL><p><DT><H3>Level ${i}</H3>`;
        }
        deepHtml += '<DT><A HREF="https://nested.com">Nested</A>';
        for (let i = 0; i < 13; i++) {
            deepHtml += '</DL><p>';
        }

        const response = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: deepHtml,
        }), env);

        expect(response.status).toBe(400);
        const result = await response.json() as any;
        expect(result).toMatchObject({
            error: 'DEPTH_LIMIT_EXCEEDED',
            message: '导入文件层级过深，最大允许嵌套 12 层',
        });
        expect(db.folders.length).toBe(initialFolders);
    });
});
