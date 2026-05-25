import * as s from '../utils/schemas';
import type { ApiApp } from './types';

export function registerBookmarkRoutes(app: ApiApp) {
    app.post('/bookmarks', async (c) => {
        const body = await c.req.json();
        const result = s.bookmarkSchema.safeParse(body);
        if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
        const { title, url, folder_id } = result.data;

        await c.env.DB.prepare('INSERT INTO bookmarks (title, url, folder_id) VALUES (?, ?, ?)').bind(title, url, folder_id || null).run();
        return c.json({ success: true });
    });

    app.put('/bookmarks/reorder', async (c) => {
        try {
            const result = s.reorderSchema.safeParse(await c.req.json());
            if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
            const { orderedIds } = result.data;

            let expectedFolderId: number | null | undefined;
            for (const id of orderedIds) {
                const bookmark = await c.env.DB.prepare('SELECT folder_id FROM bookmarks WHERE id = ? AND is_deleted = 0')
                    .bind(id)
                    .first<{ folder_id: number | null }>();
                if (!bookmark) {
                    return c.json({ error: 'Bookmark reorder contains invalid or deleted items' }, 400);
                }
                if (expectedFolderId === undefined) {
                    expectedFolderId = bookmark.folder_id;
                } else if (bookmark.folder_id !== expectedFolderId) {
                    return c.json({ error: 'Bookmark reorder items must belong to the same folder' }, 400);
                }
            }

            const batch = orderedIds.map((id: number, index: number) => {
                return c.env.DB.prepare('UPDATE bookmarks SET sort_order = ? WHERE id = ?').bind(index, id);
            });
            await c.env.DB.batch(batch);
            return c.json({ success: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return c.json({ error: message }, 500);
        }
    });

    app.put('/bookmarks/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json({ error: 'Invalid ID' }, 400);
        const id = idRes.data;

        const bodyRes = s.bookmarkSchema.partial().safeParse(await c.req.json());
        if (!bodyRes.success) return c.json({ error: bodyRes.error.issues[0].message }, 400);
        const { title, url, folder_id } = bodyRes.data;

        if (title && url && folder_id !== undefined) {
            await c.env.DB.prepare('UPDATE bookmarks SET title = ?, url = ?, folder_id = ? WHERE id = ?').bind(title, url, folder_id, id).run();
        } else if (title && url) {
            await c.env.DB.prepare('UPDATE bookmarks SET title = ?, url = ? WHERE id = ?').bind(title, url, id).run();
        } else if (title) {
            await c.env.DB.prepare('UPDATE bookmarks SET title = ? WHERE id = ?').bind(title, id).run();
        } else if (url) {
            await c.env.DB.prepare('UPDATE bookmarks SET url = ? WHERE id = ?').bind(url, id).run();
        } else if (folder_id !== undefined) {
            await c.env.DB.prepare('UPDATE bookmarks SET folder_id = ? WHERE id = ?').bind(folder_id, id).run();
        }
        return c.json({ success: true });
    });

    app.delete('/bookmarks/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json({ error: 'Invalid ID' }, 400);
        await c.env.DB.prepare('UPDATE bookmarks SET is_deleted = 1 WHERE id = ?').bind(idRes.data).run();
        return c.json({ success: true });
    });
}
