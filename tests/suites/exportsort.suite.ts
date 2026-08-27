import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('exportsort', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('exports folders and bookmarks strictly sorted by sort_order', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        // 制造乱序的 sort_order，并写入 mock db
        const now = new Date().toISOString();
        db.folders.push({
            id: 10,
            name: 'Second Folder',
            parent_id: null,
            sort_order: 2,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });
        db.folders.push({
            id: 11,
            name: 'First Folder',
            parent_id: null,
            sort_order: 1,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });

        db.bookmarks.push({
            id: 20,
            title: 'Second Bookmark',
            url: 'https://b.com',
            description: null,
            folder_id: null,
            sort_order: 2,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });
        db.bookmarks.push({
            id: 21,
            title: 'First Bookmark',
            url: 'https://a.com',
            description: null,
            folder_id: null,
            sort_order: 1,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });

        const response = await app.fetch(new Request('https://example.com/api/export', {
            headers: {
                Cookie: cookie,
            },
        }), env);

        expect(response.status).toBe(200);
        const html = await response.text();

        // 验证 HTML 中，First Folder/First Bookmark 先于 Second Folder/Second Bookmark 出现
        const firstFolderIndex = html.indexOf('First Folder');
        const secondFolderIndex = html.indexOf('Second Folder');
        const firstBookmarkIndex = html.indexOf('First Bookmark');
        const secondBookmarkIndex = html.indexOf('Second Bookmark');

        expect(firstFolderIndex).toBeGreaterThan(0);
        expect(secondFolderIndex).toBeGreaterThan(0);
        expect(firstFolderIndex).toBeLessThan(secondFolderIndex);

        expect(firstBookmarkIndex).toBeGreaterThan(0);
        expect(secondBookmarkIndex).toBeGreaterThan(0);
        expect(firstBookmarkIndex).toBeLessThan(secondBookmarkIndex);
    });
});
