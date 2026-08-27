import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importtrash', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('does not skip import deduplication for items in the trash bin (is_deleted = 1)', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        const now = new Date().toISOString();
        db.folders.push({
            id: 100,
            name: 'TrashedFolder',
            parent_id: null,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        });

        db.bookmarks.push({
            id: 200,
            title: 'TrashedBookmark',
            url: 'https://example.org/trashed-url',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        });

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>TrashedFolder</H3>
    <DL><p>
        <DT><A HREF="https://example.org/trashed-url">New Active Bookmark</A>
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
            imported: { folders: 1, bookmarks: 1 },
            skipped: { folders: 0, bookmarks: 0 },
        });

        const activeFolder = db.folders.find((f) => f.name === 'TrashedFolder' && f.is_deleted === 0);
        const activeBookmark = db.bookmarks.find((b) => b.url === 'https://example.org/trashed-url' && b.is_deleted === 0);

        expect(activeFolder).toBeTruthy();
        expect(activeBookmark).toBeTruthy();
        expect(activeBookmark?.folder_id).toBe(activeFolder?.id);
    });
});
