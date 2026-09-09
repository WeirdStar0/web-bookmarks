import type { ApiApp } from './types';
import { BOOKMARK_PUBLIC_COLUMNS, FOLDER_PUBLIC_COLUMNS } from './columns';
import { idSchema } from '../utils/schemas';
import { err, ErrCode, getSessionVersion } from '../utils/common';

const MAX_SEARCH_QUERY_LENGTH = 200;

export function registerDataRoutes(app: ApiApp) {
    app.get('/data', async (c) => {
        // The extension only needs folders. The dashboard asks for the current
        // folder so a large library does not have to be sent on every load.
        const includeBookmarks = c.req.query('includeBookmarks') !== 'false';
        const requestedFolder = c.req.query('folderId');
        let folderId: number | null = null;
        if (requestedFolder && requestedFolder !== 'root') {
            const folderResult = idSchema.safeParse(requestedFolder);
            if (!folderResult.success) return c.json(err(ErrCode.INVALID_ID, 'Invalid folder ID'), 400);
            folderId = folderResult.data;
        }

        const sessionVersionCookie = c.get('sessionVersionCookie');
        const sessionVersionPromise = c.get('sessionVersionPromise') || getSessionVersion(c.env.DB);
        const foldersPromise = c.env.DB.prepare(`SELECT ${FOLDER_PUBLIC_COLUMNS} FROM folders WHERE is_deleted = 0 ORDER BY sort_order ASC, name ASC`).all();
        const [sessionVersion, { results: folders }] = await Promise.all([sessionVersionPromise, foldersPromise]);
        if (!sessionVersionCookie || sessionVersionCookie !== sessionVersion) {
            return c.json(err(ErrCode.UNAUTHORIZED, 'Unauthorized'), 401);
        }
        if (folderId !== null && !folders.some((folder) => Number(folder.id) === folderId)) {
            return c.json(err(ErrCode.NOT_FOUND, 'Folder not found'), 404);
        }
        if (!includeBookmarks) {
            return c.json({ folders, bookmarks: [], bookmarkCounts: {} });
        }

        const bookmarksPromise = folderId === null
            ? c.env.DB.prepare(`SELECT ${BOOKMARK_PUBLIC_COLUMNS} FROM bookmarks WHERE is_deleted = 0 AND folder_id IS NULL ORDER BY sort_order ASC, created_at ASC`).all()
            : c.env.DB.prepare(`SELECT ${BOOKMARK_PUBLIC_COLUMNS} FROM bookmarks WHERE is_deleted = 0 AND folder_id = ? ORDER BY sort_order ASC, created_at ASC`).bind(folderId).all();
        const bookmarkCountsPromise = c.env.DB.prepare(
            'SELECT folder_id, COUNT(*) AS count FROM bookmarks WHERE is_deleted = 0 AND folder_id IS NOT NULL GROUP BY folder_id'
        ).all<{ folder_id: number; count: number }>();

        const [
            { results: bookmarks },
            { results: countRows },
        ] = await Promise.all([bookmarksPromise, bookmarkCountsPromise]);

        const bookmarkCounts: Record<string, number> = {};
        for (const row of countRows) bookmarkCounts[String(row.folder_id)] = Number(row.count);
        return c.json({ folders, bookmarks, bookmarkCounts });
    });

    app.get('/search', async (c) => {
        const query = c.req.query('q')?.trim() || '';
        if (!query) {
            return c.json({ bookmarks: [] });
        }
        if (query.length > MAX_SEARCH_QUERY_LENGTH) {
            return c.json(err(ErrCode.VALIDATION, `Search query must not exceed ${MAX_SEARCH_QUERY_LENGTH} characters`), 400);
        }

        // Escape LIKE wildcards so % and _ are treated as literal characters
        const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

        const pattern = `%${escaped}%`;
        const sessionVersionCookie = c.get('sessionVersionCookie');
        const sessionVersionPromise = c.get('sessionVersionPromise') || getSessionVersion(c.env.DB);
        const foldersPromise = c.env.DB.prepare(
            `SELECT ${FOLDER_PUBLIC_COLUMNS} FROM folders WHERE is_deleted = 0 AND name LIKE ? ESCAPE '\\' ORDER BY sort_order ASC, name ASC LIMIT 50`,
        ).bind(pattern).all();
        const bookmarksPromise = c.env.DB.prepare(
            `SELECT ${BOOKMARK_PUBLIC_COLUMNS} FROM bookmarks WHERE is_deleted = 0 AND (title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') ORDER BY sort_order ASC, created_at DESC LIMIT 50`,
        ).bind(pattern, pattern, pattern).all();
        const [sessionVersion, { results: folders }, { results: bookmarks }] = await Promise.all([
            sessionVersionPromise,
            foldersPromise,
            bookmarksPromise,
        ]);
        if (!sessionVersionCookie || sessionVersionCookie !== sessionVersion) {
            return c.json(err(ErrCode.UNAUTHORIZED, 'Unauthorized'), 401);
        }

        return c.json({ folders, bookmarks });
    });
}
