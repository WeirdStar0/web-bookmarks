import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { normalizeSql } from '../helpers'

describe('folders', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('soft delete and restore keep folder subtree and bookmarks consistent', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'root' }),
        }), env);
        const rootId = db.folders[0].id;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'child', parent_id: rootId }),
        }), env);
        const childId = db.folders[1].id;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark', url: 'https://example.org', folder_id: childId }),
        }), env);

        const deleteResponse = await app.fetch(new Request(`https://example.com/api/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);
        expect(deleteResponse.status).toBe(200);
        expect(db.folders.every((item) => item.is_deleted === 1)).toBe(true);
        expect(db.bookmarks.every((item) => item.is_deleted === 1)).toBe(true);

        const restoreResponse = await app.fetch(new Request(`https://example.com/api/restore/folders/${rootId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);
        expect(restoreResponse.status).toBe(200);
        expect(db.folders.every((item) => item.is_deleted === 0)).toBe(true);
        expect(db.bookmarks.every((item) => item.is_deleted === 0)).toBe(true);
    });

    it('soft delete preserves a descendant moved out of the subtree before the root mutation', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        const rootId = 8701;
        const movedChildId = 8702;
        const destinationId = 8703;
        db.folders.push(
            { id: rootId, name: 'root', parent_id: null, sort_order: 0, is_deleted: 0, created_at: now, updated_at: now },
            { id: movedChildId, name: 'moved-child', parent_id: rootId, sort_order: 0, is_deleted: 0, created_at: now, updated_at: now },
            { id: destinationId, name: 'destination', parent_id: null, sort_order: 1, is_deleted: 0, created_at: now, updated_at: now },
        );
        db.bookmarks.push({
            id: 8701,
            title: 'moved bookmark',
            url: 'https://example.com/moved-bookmark',
            description: null,
            folder_id: movedChildId,
            sort_order: 0,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });

        const originalExecuteRun = db.executeRun.bind(db);
        let moved = false;
        db.executeRun = async (sql, bindings) => {
            const normalized = normalizeSql(sql);
            if (!moved
                && normalized.startsWith('UPDATE folders SET is_deleted =')
                && Number(bindings[bindings.length - 1]) === rootId) {
                db.folders.find((folder) => folder.id === movedChildId)!.parent_id = destinationId;
                moved = true;
            }
            return originalExecuteRun(sql, bindings);
        };

        const response = await app.fetch(new Request(`https://example.com/api/folders/${rootId}`, {
            method: 'DELETE',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(response.status).toBe(200);
        expect(db.folders.find((folder) => folder.id === rootId)?.is_deleted).toBe(1);
        expect(db.folders.find((folder) => folder.id === movedChildId)).toMatchObject({
            parent_id: destinationId,
            is_deleted: 0,
        });
        expect(db.bookmarks.find((bookmark) => bookmark.folder_id === movedChildId)?.is_deleted).toBe(0);
    });

    it('does not report folder deletion success when the folder enters trash after the precheck', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        const folderId = 8711;
        db.folders.push({
            id: folderId,
            name: 'racing-folder',
            parent_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });

        const originalExecuteRun = db.executeRun.bind(db);
        let raced = false;
        db.executeRun = async (sql, bindings) => {
            const normalized = normalizeSql(sql);
            if (!raced
                && normalized.startsWith('UPDATE folders SET is_deleted =')
                && Number(bindings[bindings.length - 1]) === folderId) {
                db.folders.find((folder) => folder.id === folderId)!.is_deleted = 1;
                raced = true;
            }
            return originalExecuteRun(sql, bindings);
        };

        const response = await app.fetch(new Request(`https://example.com/api/folders/${folderId}`, {
            method: 'DELETE',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(response.status).toBe(404);
        expect(db.folders.find((folder) => folder.id === folderId)?.is_deleted).toBe(1);
    });

    it('does not report bookmark deletion success when the bookmark enters trash after the precheck', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        const bookmarkId = 8721;
        db.bookmarks.push({
            id: bookmarkId,
            title: 'racing bookmark',
            url: 'https://example.com/racing-bookmark',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });

        const originalExecuteRun = db.executeRun.bind(db);
        let raced = false;
        db.executeRun = async (sql, bindings) => {
            const normalized = normalizeSql(sql);
            if (!raced
                && normalized.startsWith('UPDATE bookmarks SET is_deleted = 1 WHERE id = ?')
                && Number(bindings[0]) === bookmarkId) {
                db.bookmarks.find((bookmark) => bookmark.id === bookmarkId)!.is_deleted = 1;
                raced = true;
            }
            return originalExecuteRun(sql, bindings);
        };

        const response = await app.fetch(new Request(`https://example.com/api/bookmarks/${bookmarkId}`, {
            method: 'DELETE',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(response.status).toBe(404);
        expect(db.bookmarks.find((bookmark) => bookmark.id === bookmarkId)?.is_deleted).toBe(1);
    });

    it('permanent delete removes the whole folder subtree', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'root' }),
        }), env);
        const rootId = db.folders[0].id;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'child', parent_id: rootId }),
        }), env);
        const childId = db.folders[1].id;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark', url: 'https://example.org', folder_id: childId }),
        }), env);

        await app.fetch(new Request(`https://example.com/api/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        const permanentDeleteResponse = await app.fetch(new Request(`https://example.com/api/trash/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(permanentDeleteResponse.status).toBe(200);
        expect(db.folders).toHaveLength(0);
        expect(db.bookmarks).toHaveLength(0);
    });

    it('permanently deletes a legacy cyclic trashed folder graph without recursive exhaustion', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.folders.push(
            { id: 8801, name: 'cycle-a', parent_id: 8802, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
            { id: 8802, name: 'cycle-b', parent_id: 8801, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
        );
        db.bookmarks.push(
            { id: 8801, title: 'cycle-a bookmark', url: 'https://example.com/cycle-a', description: null, folder_id: 8801, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
            { id: 8802, title: 'cycle-b bookmark', url: 'https://example.com/cycle-b', description: null, folder_id: 8802, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
        );

        const response = await app.fetch(new Request('https://example.com/api/trash/folders/8801', {
            method: 'DELETE',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);
        expect(response.status).toBe(200);
        expect(db.folders).toHaveLength(0);
        expect(db.bookmarks).toHaveLength(0);
    });

    it('does not permanently delete a folder subtree restored during the deletion race', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.folders.push(
            { id: 8901, name: 'restored-root', parent_id: null, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
            { id: 8902, name: 'restored-child', parent_id: 8901, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
        );
        db.bookmarks.push({
            id: 8901,
            title: 'restored bookmark',
            url: 'https://example.com/restored-bookmark',
            description: null,
            folder_id: 8902,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        });
        const originalBatch = db.batch.bind(db);
        db.batch = async (statements) => {
            db.folders.forEach((folder) => { folder.is_deleted = 0; });
            db.bookmarks.forEach((bookmark) => { bookmark.is_deleted = 0; });
            return originalBatch(statements);
        };

        const response = await app.fetch(new Request('https://example.com/api/trash/folders/8901', {
            method: 'DELETE',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(response.status).toBe(404);
        expect(db.folders).toHaveLength(2);
        expect(db.bookmarks).toHaveLength(1);
        expect(db.folders.every((folder) => folder.is_deleted === 0)).toBe(true);
        expect(db.bookmarks.every((bookmark) => bookmark.is_deleted === 0)).toBe(true);
    });

    it('rejects permanent delete for folders that are not in trash', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'active-root' }),
        }), env);
        const rootId = db.folders[0].id;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'active-child', parent_id: rootId }),
        }), env);
        const childId = db.folders[1].id;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'active-bookmark', url: 'https://example.org/active', folder_id: childId }),
        }), env);

        const permanentDeleteResponse = await app.fetch(new Request(`https://example.com/api/trash/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(permanentDeleteResponse.status).toBe(404);
        expect(await permanentDeleteResponse.json()).toMatchObject({
            error: 'NOT_FOUND',
            message: 'Folder not found in trash',
        });
        expect(db.folders).toHaveLength(2);
        expect(db.bookmarks).toHaveLength(1);
        expect(db.folders.every((item) => item.is_deleted === 0)).toBe(true);
        expect(db.bookmarks.every((item) => item.is_deleted === 0)).toBe(true);
    });

    it('rejects permanent delete for bookmarks that are not in trash', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'active-bookmark', url: 'https://example.org/active' }),
        }), env);

        const bookmarkId = db.bookmarks[0].id;
        const permanentDeleteResponse = await app.fetch(new Request(`https://example.com/api/trash/bookmarks/${bookmarkId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(permanentDeleteResponse.status).toBe(404);
        expect(await permanentDeleteResponse.json()).toMatchObject({
            error: 'NOT_FOUND',
            message: 'Bookmark not found in trash',
        });
        expect(db.bookmarks).toHaveLength(1);
        expect(db.bookmarks[0].is_deleted).toBe(0);
    });

    it('rejects restoring a trashed bookmark when its parent folder is still in trash', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'root' }),
        }), env);
        const rootId = db.folders[0].id;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark', url: 'https://example.org', folder_id: rootId }),
        }), env);
        const bookmarkId = db.bookmarks[0].id;

        await app.fetch(new Request(`https://example.com/api/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        const restoreResponse = await app.fetch(new Request(`https://example.com/api/restore/bookmarks/${bookmarkId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(restoreResponse.status).toBe(409);
        expect(await restoreResponse.json()).toMatchObject({
            error: 'PARENT_IN_TRASH',
            message: 'Parent folder is still in trash',
        });
        expect(db.bookmarks[0].is_deleted).toBe(1);
    });

    it('restores a root-level trashed bookmark successfully', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'root-bookmark', url: 'https://example.org/root' }),
        }), env);
        const bookmarkId = db.bookmarks[0].id;

        await app.fetch(new Request(`https://example.com/api/bookmarks/${bookmarkId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        const restoreResponse = await app.fetch(new Request(`https://example.com/api/restore/bookmarks/${bookmarkId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(restoreResponse.status).toBe(200);
        expect(db.bookmarks[0].is_deleted).toBe(0);
        expect(db.bookmarks[0].folder_id).toBeNull();
    });

    it('returns not found when restoring a bookmark already restored with its parent folder', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'root' }),
        }), env);
        const rootId = db.folders[0].id;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark', url: 'https://example.org', folder_id: rootId }),
        }), env);
        const bookmarkId = db.bookmarks[0].id;

        await app.fetch(new Request(`https://example.com/api/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        const restoreFolderResponse = await app.fetch(new Request(`https://example.com/api/restore/folders/${rootId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);
        expect(restoreFolderResponse.status).toBe(200);

        expect(db.bookmarks[0].is_deleted).toBe(0);

        const restoreBookmarkResponse = await app.fetch(new Request(`https://example.com/api/restore/bookmarks/${bookmarkId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(restoreBookmarkResponse.status).toBe(404);
        expect(await restoreBookmarkResponse.json()).toMatchObject({
            error: 'NOT_FOUND',
            message: 'Bookmark not found in trash',
        });
        expect(db.folders[0].is_deleted).toBe(0);
        expect(db.bookmarks[0].is_deleted).toBe(0);
    });

    it('rejects restoring a bookmark that is not in trash', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'active-bookmark', url: 'https://example.org/active' }),
        }), env);
        const bookmarkId = db.bookmarks[0].id;

        const restoreResponse = await app.fetch(new Request(`https://example.com/api/restore/bookmarks/${bookmarkId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(restoreResponse.status).toBe(404);
        expect(await restoreResponse.json()).toMatchObject({
            error: 'NOT_FOUND',
            message: 'Bookmark not found in trash',
        });
        expect(db.bookmarks[0].is_deleted).toBe(0);
    });

    it('rejects restoring a folder that is not in trash', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'active-folder' }),
        }), env);
        const folderId = db.folders[0].id;

        const restoreResponse = await app.fetch(new Request(`https://example.com/api/restore/folders/${folderId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(restoreResponse.status).toBe(404);
        expect(await restoreResponse.json()).toMatchObject({
            error: 'NOT_FOUND',
            message: 'Folder not found in trash',
        });
        expect(db.folders[0].is_deleted).toBe(0);
    });

    it('restores a trashed folder subtree from parent to child under the database parent-state constraint', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.folders.push(
            { id: 200, name: 'RootTrashFolder', parent_id: null, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
            { id: 201, name: 'ChildTrashFolder', parent_id: 200, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
        );

        const restoreResponse = await app.fetch(new Request('https://example.com/api/restore/folders/200', {
            method: 'POST',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(restoreResponse.status).toBe(200);
        expect(db.folders.find((folder) => folder.id === 200)?.is_deleted).toBe(0);
        expect(db.folders.find((folder) => folder.id === 201)?.is_deleted).toBe(0);
    });

    it('rejects restoring a folder if its parent folder is still in trash', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        const now = new Date().toISOString();
        db.folders.push({
            id: 100,
            name: 'ParentTrashFolder',
            parent_id: null,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        });

        db.folders.push({
            id: 101,
            name: 'ChildTrashFolder',
            parent_id: 100,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        });

        const restoreResponse = await app.fetch(new Request('https://example.com/api/restore/folders/101', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(restoreResponse.status).toBe(409);
        expect(await restoreResponse.json()).toMatchObject({
            error: 'PARENT_IN_TRASH',
            message: 'Parent folder is still in trash',
        });

        const child = db.folders.find((f) => f.id === 101);
        expect(child?.is_deleted).toBe(1);
    });
});
