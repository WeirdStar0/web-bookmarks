import { Hono } from 'hono';
import { setSignedCookie, deleteCookie } from 'hono/cookie';
import type { D1Database } from '@cloudflare/workers-types';
import { Bindings, Variables } from '../types';
import { getConfig, getSettings, hashPassword, hashPasswordV2, invalidateSettingsCache } from '../utils/common';
import * as s from '../utils/schemas';

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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

    return results.map(row => row.id);
}

async function markFolderSubtreeDeleted(db: D1Database, folderId: number, isDeleted: 0 | 1) {
    const allIds = await getFolderSubtreeIds(db, folderId, isDeleted === 1 ? 0 : 1);

    if (allIds.length === 0) {
        return;
    }

    const batch = allIds.flatMap((id) => ([
        db.prepare('UPDATE folders SET is_deleted = ? WHERE id = ?').bind(isDeleted, id),
        db.prepare('UPDATE bookmarks SET is_deleted = ? WHERE folder_id = ?').bind(isDeleted, id),
    ]));

    await db.batch(batch);
}

async function permanentlyDeleteFolderSubtree(db: D1Database, folderId: number) {
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

// API: Login
app.post('/login', async (c) => {
    const config = getConfig(c.env);
    const body = await c.req.json();
    const result = s.loginSchema.safeParse(body);

    if (!result.success) {
        return c.json({ error: result.error.issues[0].message }, 400);
    }
    const { username, password } = result.data;

    const settings = await getSettings(c.env.DB);
    const dbUser = settings.username;
    const dbPass = settings.password;

    if (username === dbUser) {
        // 1. Check V2 (PBKDF2) - Format: v2:salt:hash
        if (dbPass.startsWith('v2:')) {
            const parts = dbPass.split(':');
            if (parts.length === 3) {
                const salt = parts[1];
                const storedHash = parts[2];
                const result = await hashPasswordV2(password, salt);
                if (result.hash === storedHash) {
                    const secret = c.get('sessionSecret');
                    const url = new URL(c.req.url);
                    const isSecure = url.protocol === 'https:';
                    await setSignedCookie(c, 'auth', 'true', secret, {
                        path: '/',
                        httpOnly: true,
                        secure: isSecure,
                        sameSite: isSecure ? 'None' : 'Lax',
                        maxAge: config.sessionMaxAge
                    });
                    return c.json({ success: true });
                }
            }
        } else {
            // 2. Check V1 (SHA-256) & Migrate
            const inputHash = await hashPassword(password);
            if (inputHash === dbPass) {
                // Migrate to V2
                const v2 = await hashPasswordV2(password);
                const newDbValue = `v2:${v2.salt}:${v2.hash}`;
                await c.env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(newDbValue, 'password').run();
                invalidateSettingsCache();

                const secret = c.get('sessionSecret');
                const url = new URL(c.req.url);
                const isSecure = url.protocol === 'https:';
                await setSignedCookie(c, 'auth', 'true', secret, {
                    path: '/',
                    httpOnly: true,
                    secure: isSecure,
                    sameSite: isSecure ? 'None' : 'Lax',
                    maxAge: config.sessionMaxAge
                });
                return c.json({ success: true, migrated: true });
            }
        }
    }
    return c.json({ error: 'Invalid credentials' }, 401);
});

// API: Logout
app.post('/logout', async (c) => {
    deleteCookie(c, 'auth');
    return c.json({ success: true });
});

// API: Update Settings
app.put('/settings', async (c) => {
    const body = await c.req.json();
    const result = s.settingsSchema.safeParse(body);

    if (!result.success) {
        return c.json({ error: result.error.issues[0].message }, 400);
    }
    const { username, password } = result.data;

    if (username) {
        await c.env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(username, 'username').run();
    }

    if (password) {
        const v2 = await hashPasswordV2(password);
        const newDbValue = `v2:${v2.salt}:${v2.hash}`;
        await c.env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(newDbValue, 'password').run();
    }

    invalidateSettingsCache();
    return c.json({ success: true });
});

// API: Get all data (Protected)
app.get('/data', async (c) => {
    const { results: folders } = await c.env.DB.prepare('SELECT * FROM folders WHERE is_deleted = 0 ORDER BY sort_order ASC, name ASC').all();
    const { results: bookmarks } = await c.env.DB.prepare('SELECT * FROM bookmarks WHERE is_deleted = 0 ORDER BY sort_order ASC, created_at ASC').all();
    return c.json({ folders, bookmarks });
});

// API: Search Bookmarks (Server-Side)
app.get('/search', async (c) => {
    const query = c.req.query('q');
    if (!query || query.trim().length === 0) {
        return c.json({ bookmarks: [] });
    }

    const { results: bookmarks } = await c.env.DB.prepare(
        'SELECT * FROM bookmarks WHERE is_deleted = 0 AND (title LIKE ? OR url LIKE ?) ORDER BY sort_order ASC, created_at DESC LIMIT 50'
    ).bind(`%${query}%`, `%${query}%`).all();

    return c.json({ bookmarks });
});

// API: Create Folder
app.post('/folders', async (c) => {
    const body = await c.req.json();
    const result = s.folderSchema.safeParse(body);

    if (!result.success) {
        return c.json({ error: result.error.issues[0].message }, 400);
    }
    const { name, parent_id } = result.data;

    await c.env.DB.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)').bind(name, parent_id || null).run();
    return c.json({ success: true });
});

// API: Reorder Folders
app.put('/folders/reorder', async (c) => {
    const result = s.reorderSchema.safeParse(await c.req.json());
    if (!result.success) {
        return c.json({ error: result.error.issues[0].message }, 400);
    }
    const { orderedIds } = result.data;
    const batch = orderedIds.map((id: number, index: number) => {
        return c.env.DB.prepare('UPDATE folders SET sort_order = ? WHERE id = ?').bind(index, id);
    });
    await c.env.DB.batch(batch);
    return c.json({ success: true });
});

// API: Update Folder
app.put('/folders/:id', async (c) => {
    const idRes = s.idSchema.safeParse(c.req.param('id'));
    if (!idRes.success) return c.json({ error: 'Invalid ID' }, 400);
    const id = idRes.data;

    const bodyRes = s.folderSchema.partial().safeParse(await c.req.json());
    if (!bodyRes.success) return c.json({ error: bodyRes.error.issues[0].message }, 400);
    const { name, parent_id } = bodyRes.data;

    if (parent_id === id) {
        return c.json({ error: 'Cannot move folder into itself' }, 400);
    }
    
    if (parent_id) {
        // Prevent cyclic reference: check if parent_id is a descendant of id
        const { results } = await c.env.DB.prepare(`
            WITH RECURSIVE descendants(id) AS (
                SELECT id FROM folders WHERE parent_id = ?
                UNION ALL
                SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
            )
            SELECT id FROM descendants WHERE id = ?
        `).bind(id, parent_id).all();
        if (results.length > 0) {
            return c.json({ error: 'Cannot move folder into one of its subfolders' }, 400);
        }
    }

    if (name !== undefined && parent_id !== undefined) {
        await c.env.DB.prepare('UPDATE folders SET name = ?, parent_id = ? WHERE id = ?').bind(name, parent_id, id).run();
    } else if (name !== undefined) {
        await c.env.DB.prepare('UPDATE folders SET name = ? WHERE id = ?').bind(name, id).run();
    } else if (parent_id !== undefined) {
        await c.env.DB.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').bind(parent_id, id).run();
    }
    return c.json({ success: true });
});

async function softDeleteFolder(db: D1Database, folderId: number) {
    await markFolderSubtreeDeleted(db, folderId, 1);
}


// API: Delete Folder
app.delete('/folders/:id', async (c) => {
    const idRes = s.idSchema.safeParse(c.req.param('id'));
    if (!idRes.success) return c.json({ error: 'Invalid ID' }, 400);
    await softDeleteFolder(c.env.DB, idRes.data);
    return c.json({ success: true });
});

// API: Create Bookmark
app.post('/bookmarks', async (c) => {
    const body = await c.req.json();
    const result = s.bookmarkSchema.safeParse(body);
    if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
    const { title, url, folder_id } = result.data;

    await c.env.DB.prepare('INSERT INTO bookmarks (title, url, folder_id) VALUES (?, ?, ?)').bind(title, url, folder_id || null).run();
    return c.json({ success: true });
});

// API: Reorder Bookmarks
app.put('/bookmarks/reorder', async (c) => {
    try {
        const result = s.reorderSchema.safeParse(await c.req.json());
        if (!result.success) return c.json({ error: result.error.issues[0].message }, 400);
        const { orderedIds } = result.data;

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

// API: Update Bookmark
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

// API: Delete Bookmark
app.delete('/bookmarks/:id', async (c) => {
    const idRes = s.idSchema.safeParse(c.req.param('id'));
    if (!idRes.success) return c.json({ error: 'Invalid ID' }, 400);
    await c.env.DB.prepare('UPDATE bookmarks SET is_deleted = 1 WHERE id = ?').bind(idRes.data).run();
    return c.json({ success: true });
});

function generateNetscapeHTML(folders: FolderRow[], bookmarks: BookmarkRow[], parentId: number | null = null, indent: string = ''): string {
    const escapeHtml = (s: string | number | null | undefined) => {
        if (!s) return '';
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    };
    let html = '';
    const f = folders.filter(f => f.parent_id === parentId);
    const b = bookmarks.filter(b => b.folder_id === parentId);
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

// API: Get Trash
app.get('/trash', async (c) => {
    const { results: folders } = await c.env.DB.prepare('SELECT * FROM folders WHERE is_deleted = 1 ORDER BY name').all();
    const { results: bookmarks } = await c.env.DB.prepare('SELECT * FROM bookmarks WHERE is_deleted = 1 ORDER BY created_at DESC').all();
    return c.json({ folders, bookmarks });
});

// API: Restore/PermanentDelete (Simplified for brevity as exact same logic)
app.post('/restore/folders/:id', async (c) => {
    const idRes = s.idSchema.safeParse(c.req.param('id'));
    if (!idRes.success) return c.json({ error: 'Invalid ID' }, 400);
    await markFolderSubtreeDeleted(c.env.DB, idRes.data, 0);
    return c.json({ success: true });
});
app.post('/restore/bookmarks/:id', async (c) => {
    const idRes = s.idSchema.safeParse(c.req.param('id'));
    if (!idRes.success) return c.json({ error: 'Invalid ID' }, 400);
    await c.env.DB.prepare('UPDATE bookmarks SET is_deleted = 0 WHERE id = ?').bind(idRes.data).run();
    return c.json({ success: true });
});
app.delete('/trash/folders/:id', async (c) => {
    const idRes = s.idSchema.safeParse(c.req.param('id'));
    if (!idRes.success) return c.json({ error: 'Invalid ID' }, 400);
    const deleted = await permanentlyDeleteFolderSubtree(c.env.DB, idRes.data);
    if (!deleted) {
        return c.json({ error: 'Folder not found in trash' }, 404);
    }
    return c.json({ success: true });
});
app.delete('/trash/bookmarks/:id', async (c) => {
    const idRes = s.idSchema.safeParse(c.req.param('id'));
    if (!idRes.success) return c.json({ error: 'Invalid ID' }, 400);
    const trashedBookmark = await c.env.DB.prepare('SELECT id FROM bookmarks WHERE id = ? AND is_deleted = 1')
        .bind(idRes.data)
        .first<{ id: number }>();
    if (!trashedBookmark) {
        return c.json({ error: 'Bookmark not found in trash' }, 404);
    }
    await c.env.DB.prepare('DELETE FROM bookmarks WHERE id = ?').bind(idRes.data).run();
    return c.json({ success: true });
});
app.delete('/trash/empty', async (c) => {
    await c.env.DB.batch([c.env.DB.prepare('DELETE FROM folders WHERE is_deleted = 1'), c.env.DB.prepare('DELETE FROM bookmarks WHERE is_deleted = 1')]);
    return c.json({ success: true });
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

// API: Import
app.post('/import', async (c) => {
    const body = await c.req.text();
    const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim();
    
    // Group 1: DL/ /DL tags, Group 2: H3 content, Group 3: A HREF, Group 4: A content
    const tokens = body.matchAll(/(<(?:DL|\/DL).*?>)|<H3.*?>(.*?)<\/H3>|<A.*?HREF\s*=\s*["']?([^"'\s>]+)["']?.*?>(.*?)<\/A>/gis);
    
    const stack: (number | null)[] = [null];
    let lastFolderId: number | null = null;
    const bookmarkBatch: ImportBookmark[] = [];
    const BATCH_SIZE = 50;

    const flushBookmarks = async () => {
        if (bookmarkBatch.length === 0) return;
        const stmts = bookmarkBatch.map((bookmark) => {
            return c.env.DB.prepare('INSERT INTO bookmarks (title, url, folder_id) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM bookmarks WHERE url = ? AND folder_id IS ?)')
                .bind(bookmark.title, bookmark.url, bookmark.folderId, bookmark.url, bookmark.folderId);
        });
        await c.env.DB.batch(stmts);
        bookmarkBatch.length = 0;
    };

    for (const match of tokens) {
        if (match[1]) { // <DL> or </DL>
            const tag = match[1].toUpperCase();
            if (tag.includes('/DL')) {
                if (stack.length > 1) stack.pop();
            } else {
                stack.push(lastFolderId);
            }
        } else if (match[2] !== undefined) { // <H3>content</H3>
            await flushBookmarks();
            const folderName = stripTags(match[2]);
            if (!folderName) continue;
            
            const parentId = stack[stack.length - 1];
            const existing = await c.env.DB.prepare('SELECT id FROM folders WHERE name = ? AND parent_id IS ?')
                .bind(folderName, parentId)
                .first<{ id: number }>();
            if (existing) {
                lastFolderId = existing.id;
            } else {
                const { meta } = await c.env.DB.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)').bind(folderName, parentId).run();
                lastFolderId = meta.last_row_id as number;
            }
        } else if (match[3]) { // <A HREF="url">content</A>
            const url = match[3];
            const title = stripTags(match[4] || url) || url;
            const parentId = stack[stack.length - 1];
            bookmarkBatch.push({ title, url, folderId: parentId });
            if (bookmarkBatch.length >= BATCH_SIZE) await flushBookmarks();
        }
    }
    await flushBookmarks();
    return c.json({ success: true });
});

export default app;
