import * as s from '../utils/schemas';
import { err, ErrCode } from '../utils/common';
import type { ApiApp } from './types';

export function registerBookmarkRoutes(app: ApiApp) {
    app.post('/bookmarks', async (c) => {
        const body = await c.req.json();
        const result = s.bookmarkSchema.safeParse(body);
        if (!result.success) return c.json(err(ErrCode.VALIDATION, result.error.issues[0].message), 400);
        const { title, url, description, folder_id } = result.data;

        if (folder_id !== null && folder_id !== undefined) {
            const parent = await c.env.DB.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0')
                .bind(folder_id)
                .first<{ id: number }>();
            if (!parent) {
                return c.json(err(ErrCode.NOT_FOUND, 'Folder not found'), 404);
            }
        }

        await c.env.DB.prepare('INSERT INTO bookmarks (title, url, description, folder_id) VALUES (?, ?, ?, ?)').bind(title, url, description ?? null, folder_id ?? null).run();
        return c.json({ success: true });
    });

    app.put('/bookmarks/reorder', async (c) => {
        try {
            const result = s.reorderSchema.safeParse(await c.req.json());
            if (!result.success) return c.json(err(ErrCode.VALIDATION, result.error.issues[0].message), 400);
            const { orderedIds } = result.data;

            let expectedFolderId: number | null | undefined;
            for (const id of orderedIds) {
                const bookmark = await c.env.DB.prepare('SELECT folder_id FROM bookmarks WHERE id = ? AND is_deleted = 0')
                    .bind(id)
                    .first<{ folder_id: number | null }>();
                if (!bookmark) {
                    return c.json(err(ErrCode.REORDER_INVALID, 'Bookmark reorder contains invalid or deleted items'), 400);
                }
                if (expectedFolderId === undefined) {
                    expectedFolderId = bookmark.folder_id;
                } else if (bookmark.folder_id !== expectedFolderId) {
                    return c.json(err(ErrCode.REORDER_CROSS_SCOPE, 'Bookmark reorder items must belong to the same folder'), 400);
                }
            }

            const batch = orderedIds.map((id: number, index: number) => {
                return c.env.DB.prepare('UPDATE bookmarks SET sort_order = ? WHERE id = ?').bind(index, id);
            });
            await c.env.DB.batch(batch);
            return c.json({ success: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json(err(ErrCode.SERVER_ERROR, message), 500);
        }
    });

    app.put('/bookmarks/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json(err(ErrCode.INVALID_ID, 'Invalid ID'), 400);
        const id = idRes.data;

        const existing = await c.env.DB.prepare('SELECT id FROM bookmarks WHERE id = ? AND is_deleted = 0')
            .bind(id)
            .first<{ id: number }>();
        if (!existing) return c.json(err(ErrCode.NOT_FOUND, 'Bookmark not found'), 404);

        const bodyRes = s.bookmarkSchema.partial().safeParse(await c.req.json());
        if (!bodyRes.success) return c.json(err(ErrCode.VALIDATION, bodyRes.error.issues[0].message), 400);
        const { title, url, description, folder_id } = bodyRes.data;

        if (folder_id !== null && folder_id !== undefined) {
            const parent = await c.env.DB.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0')
                .bind(folder_id)
                .first<{ id: number }>();
            if (!parent) {
                return c.json(err(ErrCode.NOT_FOUND, 'Folder not found'), 404);
            }
        }

        const setClauses: string[] = [];
        const bindings: unknown[] = [];

        if (title !== undefined) { setClauses.push('title = ?'); bindings.push(title); }
        if (url !== undefined) { setClauses.push('url = ?'); bindings.push(url); }
        if (description !== undefined) { setClauses.push('description = ?'); bindings.push(description); }
        if (folder_id !== undefined) { setClauses.push('folder_id = ?'); bindings.push(folder_id); }

        if (setClauses.length > 0) {
            bindings.push(id);
            await c.env.DB.prepare(`UPDATE bookmarks SET ${setClauses.join(', ')} WHERE id = ?`).bind(...bindings).run();
        }
        return c.json({ success: true });
    });

    app.delete('/bookmarks/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json(err(ErrCode.INVALID_ID, 'Invalid ID'), 400);
        const existing = await c.env.DB.prepare('SELECT id FROM bookmarks WHERE id = ? AND is_deleted = 0').bind(idRes.data).first();
        if (!existing) return c.json(err(ErrCode.NOT_FOUND, 'Bookmark not found'), 404);
        await c.env.DB.prepare('UPDATE bookmarks SET is_deleted = 1 WHERE id = ?').bind(idRes.data).run();
        return c.json({ success: true });
    });
}
