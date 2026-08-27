import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importcascade', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('cascades folder creation failures to subfolders and bookmarks and updates counts', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialFolders = db.folders.length;
        const initialBookmarks = db.bookmarks.length;

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>FAIL_FOLDER</H3>
    <DL><p>
        <DT><H3>SubFolder</H3>
        <DL><p></DL><p>
        <DT><A HREF="https://example.org/child">Child Bookmark</A>
    </DL><p>
</DL><p>`;

        const response = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: importHtml,
        }), env);

        expect(response.status).toBe(200);
        const result = await response.json() as any;
        expect(result).toMatchObject({
            success: true,
            imported: { folders: 0, bookmarks: 0 },
        });

        expect(result.failures).toHaveLength(3);
        expect(result.failures[0]).toMatchObject({ type: 'folder', name: 'FAIL_FOLDER' });
        expect(result.failures[1]).toMatchObject({ type: 'folder', name: 'SubFolder', error: '父文件夹创建失败，级联跳过' });
        expect(result.failures[2]).toMatchObject({ type: 'bookmark', name: 'Child Bookmark', error: '父文件夹创建失败，级联跳过' });

        expect(db.folders.length).toBe(initialFolders);
        expect(db.bookmarks.length).toBe(initialBookmarks);
    });
});
