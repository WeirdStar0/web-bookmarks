import * as s from '../utils/schemas';
import { err, ErrCode } from '../utils/common';
import type { ApiApp } from './types';

type BookmarkIdRow = { id: number };
type CountRow = { count: number };

// D1 caps bound parameters per statement; keep IN-list chunks safely below it.
const REORDER_QUERY_CHUNK = 90;

function isValidIdempotencyKey(value: string): boolean {
    return /^[a-zA-Z0-9_-]{16,128}$/.test(value);
}

export function registerBookmarkRoutes(app: ApiApp) {
    app.post('/bookmarks', async (c) => {
        const clientRequestId = c.req.header('Idempotency-Key');
        if (clientRequestId && !isValidIdempotencyKey(clientRequestId)) {
            return c.json(err(ErrCode.IDEMPOTENCY_KEY_INVALID, 'Invalid Idempotency-Key header'), 400);
        }

        // Return the original write result before validating a retried payload.
        // This preserves idempotency even if the folder was later moved or deleted.
        if (clientRequestId) {
            const existing = await c.env.DB.prepare(
                'SELECT id FROM bookmarks WHERE client_request_id = ?'
            ).bind(clientRequestId).first<BookmarkIdRow>();
            if (existing) {
                return c.json({ success: true, bookmarkId: existing.id, deduplicated: true });
            }
        }

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

        try {
            const insert = await c.env.DB.prepare(
                'INSERT INTO bookmarks (title, url, description, client_request_id, folder_id) VALUES (?, ?, ?, ?, ?)'
            ).bind(title, url, description ?? null, clientRequestId ?? null, folder_id ?? null).run();
            return c.json({ success: true, bookmarkId: Number(insert.meta.last_row_id), deduplicated: false });
        } catch (error) {
            // The unique partial index also protects concurrent retries that
            // passed the lookup before either request inserted its row.
            if (clientRequestId) {
                const existing = await c.env.DB.prepare(
                    'SELECT id FROM bookmarks WHERE client_request_id = ?'
                ).bind(clientRequestId).first<BookmarkIdRow>();
                if (existing) {
                    return c.json({ success: true, bookmarkId: existing.id, deduplicated: true });
                }
            }
            throw error;
        }
    });

    app.put('/bookmarks/reorder', async (c) => {
        try {
            const result = s.reorderSchema.safeParse(await c.req.json());
            if (!result.success) return c.json(err(ErrCode.VALIDATION, result.error.issues[0].message), 400);
            const { orderedIds } = result.data;

            // Anchor the scope on the first id, then verify membership and
            // cross-scope with chunked IN queries. This keeps validation cost
            // constant per chunk instead of issuing one query per id, which
            // would exceed the Workers subrequest budget for large folders.
            const anchor = await c.env.DB.prepare('SELECT folder_id FROM bookmarks WHERE id = ? AND is_deleted = 0')
                .bind(orderedIds[0])
                .first<{ folder_id: number | null }>();
            if (!anchor) {
                return c.json(err(ErrCode.REORDER_INVALID, 'Bookmark reorder contains invalid or deleted items'), 400);
            }
            const expectedFolderId = anchor.folder_id;

            const foundIds = new Set<number>();
            for (let i = 0; i < orderedIds.length; i += REORDER_QUERY_CHUNK) {
                const chunk = orderedIds.slice(i, i + REORDER_QUERY_CHUNK);
                const placeholders = chunk.map(() => '?').join(', ');
                const { results } = await c.env.DB.prepare(
                    `SELECT id, folder_id FROM bookmarks WHERE is_deleted = 0 AND id IN (${placeholders})`
                ).bind(...chunk).all<{ id: number; folder_id: number | null }>();
                for (const row of results) {
                    if (row.folder_id !== expectedFolderId) {
                        return c.json(err(ErrCode.REORDER_CROSS_SCOPE, 'Bookmark reorder items must belong to the same folder'), 400);
                    }
                    foundIds.add(row.id);
                }
            }
            // orderedIds are deduplicated by the schema, so any missing id is
            // an unknown or deleted bookmark.
            if (foundIds.size !== orderedIds.length) {
                return c.json(err(ErrCode.REORDER_INVALID, 'Bookmark reorder contains invalid or deleted items'), 400);
            }

            const scopeCount = await c.env.DB.prepare(
                'SELECT COUNT(*) AS count FROM bookmarks WHERE folder_id IS ? AND is_deleted = 0'
            ).bind(expectedFolderId ?? null).first<CountRow>();
            if (Number(scopeCount?.count ?? 0) !== orderedIds.length) {
                return c.json(err(ErrCode.REORDER_INVALID, 'Bookmark reorder must include every active item in the folder'), 400);
            }

            const batch = orderedIds.map((id: number, index: number) => {
                return c.env.DB.prepare(
                    'UPDATE bookmarks SET sort_order = ? WHERE id = ? AND folder_id IS ? AND is_deleted = 0'
                ).bind(index, id, expectedFolderId ?? null);
            });
            const results = await c.env.DB.batch(batch);
            if (results.some((mutation) => Number(mutation.meta.changes ?? 0) !== 1)) {
                return c.json(err(ErrCode.REORDER_INVALID, 'Bookmark reorder changed while processing'), 409);
            }
            return c.json({ success: true });
        } catch (error) {
            console.error('Bookmark reorder failed:', error);
            return c.json(err(ErrCode.SERVER_ERROR, 'Bookmark reorder failed'), 500);
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
            const mutation = await c.env.DB.prepare(`UPDATE bookmarks SET ${setClauses.join(', ')} WHERE id = ? AND is_deleted = 0`).bind(...bindings).run();
            if (Number(mutation.meta.changes ?? 0) === 0) {
                return c.json(err(ErrCode.NOT_FOUND, 'Bookmark not found'), 404);
            }
        }
        return c.json({ success: true });
    });

    app.delete('/bookmarks/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json(err(ErrCode.INVALID_ID, 'Invalid ID'), 400);
        const existing = await c.env.DB.prepare('SELECT id FROM bookmarks WHERE id = ? AND is_deleted = 0').bind(idRes.data).first();
        if (!existing) return c.json(err(ErrCode.NOT_FOUND, 'Bookmark not found'), 404);
        const deleted = await c.env.DB.prepare(
            'UPDATE bookmarks SET is_deleted = 1 WHERE id = ? AND is_deleted = 0'
        ).bind(idRes.data).run();
        if (Number(deleted.meta.changes ?? 0) === 0) {
            return c.json(err(ErrCode.NOT_FOUND, 'Bookmark not found'), 404);
        }
        return c.json({ success: true });
    });
}
