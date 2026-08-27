import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importsnapshot', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('fails closed when the import folder snapshot cannot be loaded', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialFolders = db.folders.length;
        db.snapshotShouldFail = true;

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>SnapshotFailFolder</H3>
</DL><p>`;

        const response = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: importHtml,
        }), env);

        // 无法安全去重时整体失败，绝不产生重复数据。
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ error: 'SERVER_ERROR' });
        expect(db.folders.length).toBe(initialFolders);
    });
});
