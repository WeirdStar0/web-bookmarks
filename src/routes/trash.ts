import * as s from '../utils/schemas';
import {
    emptyTrash,
    permanentlyDeleteBookmarkFromTrash,
    permanentlyDeleteFolderSubtreeFromTrash,
    restoreBookmarkFromTrash,
    restoreFolderSubtreeFromTrash,
} from '../services/trash';
import { err, ErrCode } from '../utils/common';
import type { ApiApp } from './types';

const FOLDER_PUBLIC_COLUMNS = 'id, name, parent_id, sort_order, is_deleted, created_at, updated_at';
const BOOKMARK_PUBLIC_COLUMNS = 'id, title, url, description, folder_id, sort_order, is_deleted, created_at, updated_at';

export function registerTrashRoutes(app: ApiApp) {
    app.get('/trash', async (c) => {
        const { results: folders } = await c.env.DB.prepare(`SELECT ${FOLDER_PUBLIC_COLUMNS} FROM folders WHERE is_deleted = 1 ORDER BY name`).all();
        const { results: bookmarks } = await c.env.DB.prepare(`SELECT ${BOOKMARK_PUBLIC_COLUMNS} FROM bookmarks WHERE is_deleted = 1 ORDER BY created_at DESC`).all();
        return c.json({ folders, bookmarks });
    });

    app.post('/restore/folders/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json(err(ErrCode.INVALID_ID, 'Invalid ID'), 400);
        const result = await restoreFolderSubtreeFromTrash(c.env.DB, idRes.data);
        if (result === 'not_found_in_trash') {
            return c.json(err(ErrCode.NOT_FOUND, 'Folder not found in trash'), 404);
        }
        if (result === 'parent_folder_in_trash') {
            return c.json(err(ErrCode.PARENT_IN_TRASH, 'Parent folder is still in trash'), 409);
        }
        return c.json({ success: true });
    });

    app.post('/restore/bookmarks/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json(err(ErrCode.INVALID_ID, 'Invalid ID'), 400);
        const result = await restoreBookmarkFromTrash(c.env.DB, idRes.data);
        if (result === 'not_found_in_trash') {
            return c.json(err(ErrCode.NOT_FOUND, 'Bookmark not found in trash'), 404);
        }
        if (result === 'parent_folder_in_trash') {
            return c.json(err(ErrCode.PARENT_IN_TRASH, 'Parent folder is still in trash'), 409);
        }
        return c.json({ success: true });
    });

    app.delete('/trash/folders/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json(err(ErrCode.INVALID_ID, 'Invalid ID'), 400);
        const deleted = await permanentlyDeleteFolderSubtreeFromTrash(c.env.DB, idRes.data);
        if (!deleted) {
            return c.json(err(ErrCode.NOT_FOUND, 'Folder not found in trash'), 404);
        }
        return c.json({ success: true });
    });

    app.delete('/trash/bookmarks/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json(err(ErrCode.INVALID_ID, 'Invalid ID'), 400);
        const deleted = await permanentlyDeleteBookmarkFromTrash(c.env.DB, idRes.data);
        if (!deleted) {
            return c.json(err(ErrCode.NOT_FOUND, 'Bookmark not found in trash'), 404);
        }
        return c.json({ success: true });
    });

    app.delete('/trash/empty', async (c) => {
        await emptyTrash(c.env.DB);
        return c.json({ success: true });
    });
}
