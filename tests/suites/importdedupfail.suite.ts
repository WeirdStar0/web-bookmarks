import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importdedupfail', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('skips bookmark import when database deduplication query fails', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialBookmarks = db.bookmarks.length;

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><A HREF="https://example.org/query-fail-bookmark">Query Fail Bookmark</A>
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
            skipped: { folders: 0, bookmarks: 0 },
        });

        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]).toMatchObject({
            type: 'bookmark',
            name: 'Query Fail Bookmark',
            error: '数据库检索失败',
        });

        expect(db.bookmarks.length).toBe(initialBookmarks);
    });
});
