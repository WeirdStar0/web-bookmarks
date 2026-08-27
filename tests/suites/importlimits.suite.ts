import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importlimits', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('enforces folder limits on import endpoint and prevents DB pollution', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialFoldersCount = db.folders.length;

        // 生成 201 个不同的文件夹
        let overLimitHtml = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>';
        for (let i = 0; i < 201; i++) {
            overLimitHtml += `<DT><H3>Folder ${i}</H3><DL><p></DL><p>`;
        }
        overLimitHtml += '</DL><p>';

        const response = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: overLimitHtml,
        }), env);

        expect(response.status).toBe(400);
        const data = await response.json() as any;
        expect(data).toMatchObject({
            error: 'LIMIT_EXCEEDED',
        });

        // 验证数据库没有任何写入
        expect(db.folders.length).toBe(initialFoldersCount);
    });

    it('dry-run and real import return identical deduplication statistics for nested virtual structures', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialFolders = db.folders.length;
        const initialBookmarks = db.bookmarks.length;

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>Parent</H3>
    <DL><p>
        <DT><H3>SubFolder</H3>
        <DL><p></DL><p>
        <DT><H3>SubFolder</H3>
        <DL><p></DL><p>
        <DT><A HREF="https://example.org/a">Bookmark A</A>
        <DT><A HREF="https://example.org/b">Bookmark B</A>
        <DT><A HREF="https://example.org/a">Bookmark A Dup</A>
    </DL><p>
</DL><p>`;

        // 1. Dry run
        const dryRunResponse = await app.fetch(new Request('https://example.com/api/import?dryRun=true', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: importHtml,
        }), env);

        expect(dryRunResponse.status).toBe(200);
        const dryResult = await dryRunResponse.json() as any;
        expect(dryResult).toMatchObject({
            success: true,
            dryRun: true,
            imported: { folders: 2, bookmarks: 2 },
            skipped: { folders: 1, bookmarks: 1 }
        });
        expect(db.folders.length).toBe(initialFolders);
        expect(db.bookmarks.length).toBe(initialBookmarks);

        // 2. Real import
        const realResponse = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: importHtml,
        }), env);

        expect(realResponse.status).toBe(200);
        const realResult = await realResponse.json() as any;
        expect(realResult).toMatchObject({
            success: true,
            imported: { folders: 2, bookmarks: 2 },
            skipped: { folders: 1, bookmarks: 1 }
        });
        expect(db.folders.length).toBe(initialFolders + 2);
        expect(db.bookmarks.length).toBe(initialBookmarks + 2);
    });
});
