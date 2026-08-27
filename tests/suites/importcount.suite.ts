import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importcount', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('correctly reverts bookmark import count when skipped during physical database insertion', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>CONFLICT_PARENT</H3>
    <DL><p>
        <DT><A HREF="https://example.org/conflict">Conflict Bookmark</A>
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
            imported: { folders: 1, bookmarks: 0 },
            skipped: { folders: 0, bookmarks: 1 },
        });

        const conflictParentId = db.folders.find(f => f.name === 'CONFLICT_PARENT')?.id;
        expect(conflictParentId).toBeDefined();
        const bookmarksInParent = db.bookmarks.filter(b => b.folder_id === conflictParentId);
        expect(bookmarksInParent).toHaveLength(1);
    });
});
