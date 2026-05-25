import type { ApiApp } from './types';

type FolderRow = {
    id: number;
    name: string;
    parent_id: number | null;
};

type BookmarkRow = {
    id: number;
    title: string;
    url: string;
    folder_id: number | null;
};

type ImportBookmark = {
    title: string;
    url: string;
    folderId: number | null;
};

function generateNetscapeHTML(folders: FolderRow[], bookmarks: BookmarkRow[], parentId: number | null = null, indent: string = ''): string {
    const escapeHtml = (s: string | number | null | undefined) => {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    let html = '';
    const f = folders.filter((folder) => folder.parent_id === parentId);
    const b = bookmarks.filter((bookmark) => bookmark.folder_id === parentId);
    if (f.length > 0 || b.length > 0) {
        html += `\n${indent}<DL><p>\n`;
        for (const folder of f) {
            html += `${indent}    <DT><H3>${escapeHtml(folder.name)}</H3>\n`;
            html += generateNetscapeHTML(folders, bookmarks, folder.id, indent + '    ');
            html += `${indent}    </DT>\n`;
        }
        for (const bookmark of b) {
            html += `${indent}    <DT><A HREF="${escapeHtml(bookmark.url)}">${escapeHtml(bookmark.title)}</A>\n`;
        }
        html += `${indent}</DL><p>\n`;
    }
    return html;
}

export function registerImportExportRoutes(app: ApiApp) {
    app.get('/data', async (c) => {
        const { results: folders } = await c.env.DB.prepare('SELECT * FROM folders WHERE is_deleted = 0 ORDER BY sort_order ASC, name ASC').all();
        const { results: bookmarks } = await c.env.DB.prepare('SELECT * FROM bookmarks WHERE is_deleted = 0 ORDER BY sort_order ASC, created_at ASC').all();
        return c.json({ folders, bookmarks });
    });

    app.get('/search', async (c) => {
        const query = c.req.query('q');
        if (!query || query.trim().length === 0) {
            return c.json({ bookmarks: [] });
        }

        // Escape LIKE wildcards so % and _ are treated as literal characters
        const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

        const { results: bookmarks } = await c.env.DB.prepare(
            "SELECT * FROM bookmarks WHERE is_deleted = 0 AND (title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\') ORDER BY sort_order ASC, created_at DESC LIMIT 50",
        ).bind(`%${escaped}%`, `%${escaped}%`).all();

        return c.json({ bookmarks });
    });

    app.get('/export', async (c) => {
        const { results: folders } = await c.env.DB.prepare('SELECT * FROM folders WHERE is_deleted = 0').all<FolderRow>();
        const { results: bookmarks } = await c.env.DB.prepare('SELECT * FROM bookmarks WHERE is_deleted = 0').all<BookmarkRow>();
        let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
`;
        html += generateNetscapeHTML(folders, bookmarks);
        c.header('Content-Type', 'application/x-netscape-bookmark');
        c.header('Content-Disposition', 'attachment; filename="bookmarks.html"');
        return c.body(html);
    });

    app.post('/import', async (c) => {
        const body = await c.req.text();
        const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim();

        const tokens = body.matchAll(/(<(?:DL|\/DL).*?>)|<H3.*?>(.*?)<\/H3>|<A.*?HREF\s*=\s*["']?([^"'\s>]+)["']?.*?>(.*?)<\/A>/gis);

        const stack: (number | null)[] = [null];
        let lastFolderId: number | null = null;
        const bookmarkBatch: ImportBookmark[] = [];
        const BATCH_SIZE = 50;
        let importedFolders = 0;
        let skippedFolders = 0;
        let importedBookmarks = 0;
        let skippedBookmarks = 0;

        const flushBookmarks = async () => {
            if (bookmarkBatch.length === 0) return;
            const stmts = bookmarkBatch.map((bookmark) => {
                return c.env.DB.prepare('INSERT INTO bookmarks (title, url, folder_id) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM bookmarks WHERE url = ? AND folder_id IS ?)')
                    .bind(bookmark.title, bookmark.url, bookmark.folderId, bookmark.url, bookmark.folderId);
            });
            const results = await c.env.DB.batch(stmts);
            for (const r of results) {
                if ((r.meta as { changes?: number }).changes) {
                    importedBookmarks++;
                } else {
                    skippedBookmarks++;
                }
            }
            bookmarkBatch.length = 0;
        };

        for (const match of tokens) {
            if (match[1]) {
                const tag = match[1].toUpperCase();
                if (tag.includes('/DL')) {
                    if (stack.length > 1) stack.pop();
                } else {
                    stack.push(lastFolderId);
                }
            } else if (match[2] !== undefined) {
                await flushBookmarks();
                const folderName = stripTags(match[2]);
                if (!folderName) continue;

                const parentId = stack[stack.length - 1];
                const existing = await c.env.DB.prepare('SELECT id FROM folders WHERE name = ? AND parent_id IS ?')
                    .bind(folderName, parentId)
                    .first<{ id: number }>();
                if (existing) {
                    lastFolderId = existing.id;
                    skippedFolders++;
                } else {
                    const { meta } = await c.env.DB.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)').bind(folderName, parentId).run();
                    lastFolderId = meta.last_row_id as number;
                    importedFolders++;
                }
            } else if (match[3]) {
                const url = match[3];
                const title = stripTags(match[4] || url) || url;
                const parentId = stack[stack.length - 1];
                bookmarkBatch.push({ title, url, folderId: parentId });
                if (bookmarkBatch.length >= BATCH_SIZE) await flushBookmarks();
            }
        }
        await flushBookmarks();
        return c.json({
            success: true,
            imported: { folders: importedFolders, bookmarks: importedBookmarks },
            skipped: { folders: skippedFolders, bookmarks: skippedBookmarks },
        });
    });
}
