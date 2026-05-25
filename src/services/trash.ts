import type { D1Database } from '@cloudflare/workers-types';

async function getFolderSubtreeIds(db: D1Database, folderId: number, deletedState?: 0 | 1) {
    const conditions = deletedState === undefined ? '' : ' AND f.is_deleted = ?';
    const rootConditions = deletedState === undefined ? '' : ' AND is_deleted = ?';
    const bindings = deletedState === undefined
        ? [folderId]
        : [folderId, deletedState, deletedState];

    const { results } = await db.prepare(`
        WITH RECURSIVE sub(id) AS (
            SELECT id FROM folders WHERE id = ?${rootConditions}
            UNION ALL
            SELECT f.id
            FROM folders f
            JOIN sub ON f.parent_id = sub.id
            WHERE 1 = 1${conditions}
        )
        SELECT id FROM sub
    `).bind(...bindings).all<{ id: number }>();

    return results.map((row) => row.id);
}

async function markFolderSubtreeDeleted(db: D1Database, folderId: number, isDeleted: 0 | 1) {
    const allIds = await getFolderSubtreeIds(db, folderId, isDeleted === 1 ? 0 : 1);

    if (allIds.length === 0) {
        return false;
    }

    const batch = allIds.flatMap((id) => ([
        db.prepare('UPDATE folders SET is_deleted = ? WHERE id = ?').bind(isDeleted, id),
        db.prepare('UPDATE bookmarks SET is_deleted = ? WHERE folder_id = ?').bind(isDeleted, id),
    ]));

    await db.batch(batch);
    return true;
}

export async function softDeleteFolderSubtree(db: D1Database, folderId: number) {
    await markFolderSubtreeDeleted(db, folderId, 1);
}

export async function restoreFolderSubtreeFromTrash(db: D1Database, folderId: number) {
    return markFolderSubtreeDeleted(db, folderId, 0);
}

export async function permanentlyDeleteFolderSubtreeFromTrash(db: D1Database, folderId: number) {
    const allIds = await getFolderSubtreeIds(db, folderId, 1);

    if (allIds.length === 0) {
        return false;
    }

    const reversedIds = [...allIds].reverse();
    const batch = reversedIds.flatMap((id) => ([
        db.prepare('DELETE FROM bookmarks WHERE folder_id = ?').bind(id),
        db.prepare('DELETE FROM folders WHERE id = ?').bind(id),
    ]));

    await db.batch(batch);
    return true;
}

export type RestoreBookmarkResult = 'ok' | 'not_found_in_trash' | 'parent_folder_in_trash';

export async function restoreBookmarkFromTrash(db: D1Database, bookmarkId: number): Promise<RestoreBookmarkResult> {
    const bookmark = await db.prepare('SELECT id, folder_id FROM bookmarks WHERE id = ? AND is_deleted = 1')
        .bind(bookmarkId)
        .first<{ id: number; folder_id: number | null }>();
    if (!bookmark) {
        return 'not_found_in_trash';
    }

    if (bookmark.folder_id !== null) {
        const parentFolder = await db.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0')
            .bind(bookmark.folder_id)
            .first<{ id: number }>();
        if (!parentFolder) {
            return 'parent_folder_in_trash';
        }
    }

    await db.prepare('UPDATE bookmarks SET is_deleted = 0 WHERE id = ?').bind(bookmarkId).run();
    return 'ok';
}

export async function permanentlyDeleteBookmarkFromTrash(db: D1Database, bookmarkId: number) {
    const trashedBookmark = await db.prepare('SELECT id FROM bookmarks WHERE id = ? AND is_deleted = 1')
        .bind(bookmarkId)
        .first<{ id: number }>();
    if (!trashedBookmark) {
        return false;
    }
    await db.prepare('DELETE FROM bookmarks WHERE id = ?').bind(bookmarkId).run();
    return true;
}

export async function emptyTrash(db: D1Database) {
    await db.batch([
        db.prepare('DELETE FROM bookmarks WHERE is_deleted = 0 AND folder_id IN (SELECT id FROM folders WHERE is_deleted = 1)'),
        db.prepare('DELETE FROM folders WHERE is_deleted = 1'),
        db.prepare('DELETE FROM bookmarks WHERE is_deleted = 1'),
    ]);
}
