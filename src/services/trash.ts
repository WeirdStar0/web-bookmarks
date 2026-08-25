import type { D1Database } from '@cloudflare/workers-types';

async function getFolderSubtreeIds(db: D1Database, folderId: number, deletedState?: 0 | 1) {
    let sql: string;
    let bindings: unknown[];

    if (deletedState === undefined) {
        sql = `
            WITH RECURSIVE sub(id, depth, path) AS (
                SELECT id, 0, printf('/%d/', id) FROM folders WHERE id = ?
                UNION ALL
                SELECT f.id, sub.depth + 1, sub.path || printf('%d/', f.id)
                FROM folders f
                JOIN sub ON f.parent_id = sub.id
                WHERE instr(sub.path, printf('/%d/', f.id)) = 0
            )
            SELECT id FROM sub ORDER BY depth ASC, id ASC
        `;
        bindings = [folderId];
    } else {
        sql = `
            WITH RECURSIVE sub(id, depth, path) AS (
                SELECT id, 0, printf('/%d/', id)
                FROM folders WHERE id = ? AND is_deleted = ?
                UNION ALL
                SELECT f.id, sub.depth + 1, sub.path || printf('%d/', f.id)
                FROM folders f
                JOIN sub ON f.parent_id = sub.id
                WHERE f.is_deleted = ?
                  AND instr(sub.path, printf('/%d/', f.id)) = 0
            )
            SELECT id FROM sub ORDER BY depth ASC, id ASC
        `;
        bindings = [folderId, deletedState, deletedState];
    }

    const { results } = await db.prepare(sql).bind(...bindings).all<{ id: number }>();

    return results.map((row) => row.id);
}

async function markFolderSubtreeDeleted(db: D1Database, folderId: number, isDeleted: 0 | 1) {
    if (isDeleted === 1) {
        // Delete only the requested root. The database trigger discovers the
        // subtree when this statement executes, preventing a stale preflight
        // from deleting a descendant that has concurrently moved elsewhere.
        const deleted = await db.prepare(`
            UPDATE folders
            SET is_deleted = 1
            WHERE id = ? AND is_deleted = 0
        `).bind(folderId).run();
        return Number(deleted.meta.changes ?? 0) === 1;
    }

    // Restoration is deliberately parent-before-child because soft-delete
    // propagation is one-way. Every update verifies the folder is still in the
    // trash and that its current parent is active, turning a race into a
    // controlled zero-row result instead of a trigger exception.
    const allIds = await getFolderSubtreeIds(db, folderId, 1);
    if (allIds.length === 0) {
        return false;
    }

    const batch = allIds.flatMap((id) => ([
        db.prepare(`
            UPDATE folders
            SET is_deleted = 0
            WHERE id = ?
              AND is_deleted = 1
              AND (
                parent_id IS NULL
                OR EXISTS (SELECT 1 FROM folders AS parent WHERE parent.id = folders.parent_id AND parent.is_deleted = 0)
              )
        `).bind(id),
        db.prepare(`
            UPDATE bookmarks
            SET is_deleted = 0
            WHERE folder_id = ?
              AND is_deleted = 1
              AND EXISTS (SELECT 1 FROM folders WHERE id = bookmarks.folder_id AND is_deleted = 0)
        `).bind(id),
    ]));

    const results = await db.batch(batch);
    return Number(results[0]?.meta.changes ?? 0) === 1;
}

export async function softDeleteFolderSubtree(db: D1Database, folderId: number) {
    return markFolderSubtreeDeleted(db, folderId, 1);
}

export type RestoreFolderResult = 'ok' | 'not_found_in_trash' | 'parent_folder_in_trash';

export async function restoreFolderSubtreeFromTrash(db: D1Database, folderId: number): Promise<RestoreFolderResult> {
    const folder = await db.prepare('SELECT id, parent_id FROM folders WHERE id = ? AND is_deleted = 1')
        .bind(folderId)
        .first<{ id: number; parent_id: number | null }>();
    if (!folder) {
        return 'not_found_in_trash';
    }

    if (folder.parent_id !== null) {
        const parentFolder = await db.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0')
            .bind(folder.parent_id)
            .first<{ id: number }>();
        if (!parentFolder) {
            return 'parent_folder_in_trash';
        }
    }

    const restored = await markFolderSubtreeDeleted(db, folderId, 0);
    if (restored) return 'ok';

    // State may have changed between the preflight and the guarded batch.
    // Return the same controlled statuses as the preflight instead of claiming
    // success for a no-op or leaking a database-trigger error.
    const current = await db.prepare('SELECT id, parent_id, is_deleted FROM folders WHERE id = ?')
        .bind(folderId)
        .first<{ id: number; parent_id: number | null; is_deleted: number }>();
    if (!current || current.is_deleted !== 1) return 'not_found_in_trash';
    if (current.parent_id !== null) {
        const activeParent = await db.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0')
            .bind(current.parent_id)
            .first<{ id: number }>();
        if (!activeParent) return 'parent_folder_in_trash';
    }
    return 'not_found_in_trash';
}

export async function permanentlyDeleteFolderSubtreeFromTrash(db: D1Database, folderId: number) {
    // Use set-based CTEs instead of a two-statement-per-node batch. Large or
    // manually imported trees would otherwise produce unbounded D1 batches.
    // Both statements share the same precondition: the requested root and all
    // reachable descendants must still be in the trash when this transaction
    // executes. That avoids deleting a subtree that a concurrent restore has
    // made active after the caller selected it for permanent deletion.
    const subtreeCte = `
        WITH RECURSIVE subtree(id, path) AS (
            SELECT id, printf('/%d/', id) FROM folders WHERE id = ?
            UNION ALL
            SELECT f.id, subtree.path || printf('%d/', f.id)
            FROM folders f
            JOIN subtree ON f.parent_id = subtree.id
            WHERE instr(subtree.path, printf('/%d/', f.id)) = 0
        )
    `;
    const trashStateGuard = `
        EXISTS (SELECT 1 FROM folders WHERE id = ? AND is_deleted = 1)
        AND NOT EXISTS (
            ${subtreeCte}
            SELECT 1 FROM folders WHERE id IN (SELECT id FROM subtree) AND is_deleted = 0
        )
    `;
    const bookmarkDelete = `
        DELETE FROM bookmarks
        WHERE is_deleted = 1
          AND folder_id IN (
            ${subtreeCte}
            SELECT id FROM subtree
          )
          AND ${trashStateGuard}
    `;
    const folderDelete = `
        DELETE FROM folders
        WHERE id IN (
            ${subtreeCte}
            SELECT id FROM subtree
        )
          AND ${trashStateGuard}
    `;

    const results = await db.batch([
        db.prepare(bookmarkDelete).bind(folderId, folderId, folderId),
        db.prepare(folderDelete).bind(folderId, folderId, folderId),
    ]);
    return Number(results[1]?.meta.changes ?? 0) > 0;
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

    const restored = await db.prepare(`
        UPDATE bookmarks
        SET is_deleted = 0
        WHERE id = ?
          AND is_deleted = 1
          AND (
            folder_id IS NULL
            OR EXISTS (SELECT 1 FROM folders WHERE id = bookmarks.folder_id AND is_deleted = 0)
          )
    `).bind(bookmarkId).run();
    if (Number(restored.meta.changes) === 1) return 'ok';

    // The bookmark or its parent changed after the preflight read. Re-check
    // the current state so callers receive a controlled race result rather
    // than a misleading success or a trigger error.
    const current = await db.prepare('SELECT id, folder_id, is_deleted FROM bookmarks WHERE id = ?')
        .bind(bookmarkId)
        .first<{ id: number; folder_id: number | null; is_deleted: number }>();
    if (!current || current.is_deleted !== 1) return 'not_found_in_trash';
    if (current.folder_id !== null) {
        const activeParent = await db.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0')
            .bind(current.folder_id)
            .first<{ id: number }>();
        if (!activeParent) return 'parent_folder_in_trash';
    }
    return 'not_found_in_trash';
}

export async function permanentlyDeleteBookmarkFromTrash(db: D1Database, bookmarkId: number) {
    // Do not physically delete a bookmark that was restored after the caller
    // observed it in the trash.
    const deleted = await db.prepare('DELETE FROM bookmarks WHERE id = ? AND is_deleted = 1')
        .bind(bookmarkId)
        .run();
    return Number(deleted.meta.changes) === 1;
}

export async function emptyTrash(db: D1Database) {
    await db.batch([
        db.prepare('DELETE FROM bookmarks WHERE is_deleted = 0 AND folder_id IN (SELECT id FROM folders WHERE is_deleted = 1)'),
        db.prepare('DELETE FROM folders WHERE is_deleted = 1'),
        db.prepare('DELETE FROM bookmarks WHERE is_deleted = 1'),
    ]);
}
