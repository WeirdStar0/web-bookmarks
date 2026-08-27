import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { FolderRow, BookmarkRow } from '../helpers'

describe('data', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('allows data clients to omit the bookmark collection', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const timestamp = new Date().toISOString();
        db.folders.push({
            id: 9001,
            name: 'Lightweight data folder',
            parent_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: timestamp,
            updated_at: timestamp,
        });
        db.bookmarks.push({
            id: 9001,
            title: 'Bookmark omitted from lightweight response',
            url: 'https://example.com/lightweight',
            description: null,
            folder_id: 9001,
            sort_order: 0,
            is_deleted: 0,
            created_at: timestamp,
            updated_at: timestamp,
        });

        const response = await app.fetch(new Request('https://example.com/api/data?includeBookmarks=false', {
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);
        expect(response.status).toBe(200);
        const data = await response.json() as { folders: FolderRow[]; bookmarks: BookmarkRow[] };
        expect(data.folders).toHaveLength(1);
        expect(data.bookmarks).toEqual([]);
    });

    it('loads only the selected folder bookmarks while preserving whole-library counts', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const timestamp = new Date().toISOString();
        db.folders.push(
            { id: 9101, name: 'Selected folder', parent_id: null, sort_order: 0, is_deleted: 0, created_at: timestamp, updated_at: timestamp },
            { id: 9102, name: 'Other folder', parent_id: null, sort_order: 1, is_deleted: 0, created_at: timestamp, updated_at: timestamp },
        );
        db.bookmarks.push(
            { id: 9101, title: 'Selected', url: 'https://example.com/selected', description: null, folder_id: 9101, sort_order: 0, is_deleted: 0, created_at: timestamp, updated_at: timestamp },
            { id: 9102, title: 'Other', url: 'https://example.com/other', description: null, folder_id: 9102, sort_order: 0, is_deleted: 0, created_at: timestamp, updated_at: timestamp },
        );

        const response = await app.fetch(new Request('https://example.com/api/data?folderId=9101', {
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);
        expect(response.status).toBe(200);
        const data = await response.json() as { bookmarks: BookmarkRow[]; bookmarkCounts: Record<string, number> };
        expect(data.bookmarks.map((bookmark) => bookmark.id)).toEqual([9101]);
        expect(data.bookmarkCounts).toMatchObject({ '9101': 1, '9102': 1 });
        expect(data.bookmarks[0]).not.toHaveProperty('client_request_id');
    });
});
