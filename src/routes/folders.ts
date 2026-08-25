import * as s from '../utils/schemas';
import { softDeleteFolderSubtree } from '../services/trash';
import { err, ErrCode } from '../utils/common';
import type { ApiApp } from './types';

const MAX_FOLDER_DEPTH = 12;

// D1 caps bound parameters per statement; keep IN-list chunks safely below it.
const REORDER_QUERY_CHUNK = 90;

type DepthRow = { depth: number | null };
type CountRow = { count: number };

function isActiveFolderSiblingConflict(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('idx_folders_active_sibling_name')
        || /unique constraint failed: .*folders/i.test(message);
}

async function getFolderDepth(db: D1Database, folderId: number): Promise<number> {
    const row = await db.prepare(`
        WITH RECURSIVE ancestors(id, parent_id, depth, path) AS (
            SELECT id, parent_id, 1, printf('/%d/', id)
            FROM folders WHERE id = ? AND is_deleted = 0
            UNION ALL
            SELECT f.id, f.parent_id, ancestors.depth + 1,
                   ancestors.path || printf('%d/', f.id)
            FROM folders f JOIN ancestors ON f.id = ancestors.parent_id
            WHERE f.is_deleted = 0
              AND instr(ancestors.path, printf('/%d/', f.id)) = 0
        )
        SELECT MAX(depth) AS depth FROM ancestors
    `).bind(folderId).first<DepthRow>();
    return row?.depth || 0;
}

async function getFolderSubtreeHeight(db: D1Database, folderId: number): Promise<number> {
    const row = await db.prepare(`
        WITH RECURSIVE descendants(id, depth, path) AS (
            SELECT id, 1, printf('/%d/', id)
            FROM folders WHERE id = ? AND is_deleted = 0
            UNION ALL
            SELECT f.id, descendants.depth + 1,
                   descendants.path || printf('%d/', f.id)
            FROM folders f JOIN descendants ON f.parent_id = descendants.id
            WHERE f.is_deleted = 0
              AND instr(descendants.path, printf('/%d/', f.id)) = 0
        )
        SELECT MAX(depth) AS depth FROM descendants
    `).bind(folderId).first<DepthRow>();
    return row?.depth || 0;
}

async function exceedsFolderDepthLimit(db: D1Database, folderId: number | null, parentId: number | null): Promise<boolean> {
    if (parentId === null) return false;

    const parentDepth = await getFolderDepth(db, parentId);
    const subtreeHeight = folderId === null ? 1 : await getFolderSubtreeHeight(db, folderId);
    return parentDepth + subtreeHeight > MAX_FOLDER_DEPTH;
}

export function registerFolderRoutes(app: ApiApp) {
    app.post('/folders', async (c) => {
        const body = await c.req.json();
        const result = s.folderSchema.safeParse(body);

        if (!result.success) {
            return c.json(err(ErrCode.VALIDATION, result.error.issues[0].message), 400);
        }
        const { name, parent_id } = result.data;

        if (parent_id !== null && parent_id !== undefined) {
            const parent = await c.env.DB.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0')
                .bind(parent_id)
                .first<{ id: number }>();
            if (!parent) {
                return c.json(err(ErrCode.NOT_FOUND, 'Parent folder not found'), 404);
            }
            if (await exceedsFolderDepthLimit(c.env.DB, null, parent_id)) {
                return c.json(err(ErrCode.FOLDER_DEPTH_LIMIT, `Folder depth cannot exceed ${MAX_FOLDER_DEPTH}`), 400);
            }
        }

        try {
            await c.env.DB.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)').bind(name, parent_id || null).run();
        } catch (error) {
            if (isActiveFolderSiblingConflict(error)) {
                return c.json(err(ErrCode.FOLDER_EXISTS, 'A folder with this name already exists here'), 409);
            }
            throw error;
        }
        return c.json({ success: true });
    });

    app.put('/folders/reorder', async (c) => {
        const result = s.reorderSchema.safeParse(await c.req.json());
        if (!result.success) {
            return c.json(err(ErrCode.VALIDATION, result.error.issues[0].message), 400);
        }
        const { orderedIds } = result.data;

        // Anchor the scope on the first id, then verify membership and
        // cross-scope with chunked IN queries so validation cost stays
        // constant per chunk instead of one query per id.
        const anchor = await c.env.DB.prepare('SELECT parent_id FROM folders WHERE id = ? AND is_deleted = 0')
            .bind(orderedIds[0])
            .first<{ parent_id: number | null }>();
        if (!anchor) {
            return c.json(err(ErrCode.REORDER_INVALID, 'Folder reorder contains invalid or deleted items'), 400);
        }
        const expectedParentId = anchor.parent_id;

        const foundIds = new Set<number>();
        for (let i = 0; i < orderedIds.length; i += REORDER_QUERY_CHUNK) {
            const chunk = orderedIds.slice(i, i + REORDER_QUERY_CHUNK);
            const placeholders = chunk.map(() => '?').join(', ');
            const { results } = await c.env.DB.prepare(
                `SELECT id, parent_id FROM folders WHERE is_deleted = 0 AND id IN (${placeholders})`
            ).bind(...chunk).all<{ id: number; parent_id: number | null }>();
            for (const row of results) {
                if (row.parent_id !== expectedParentId) {
                    return c.json(err(ErrCode.REORDER_CROSS_SCOPE, 'Folder reorder items must belong to the same parent'), 400);
                }
                foundIds.add(row.id);
            }
        }
        // orderedIds are deduplicated by the schema, so any missing id is
        // an unknown or deleted folder.
        if (foundIds.size !== orderedIds.length) {
            return c.json(err(ErrCode.REORDER_INVALID, 'Folder reorder contains invalid or deleted items'), 400);
        }

        const scopeCount = await c.env.DB.prepare(
            'SELECT COUNT(*) AS count FROM folders WHERE parent_id IS ? AND is_deleted = 0'
        ).bind(expectedParentId ?? null).first<CountRow>();
        if (Number(scopeCount?.count ?? 0) !== orderedIds.length) {
            return c.json(err(ErrCode.REORDER_INVALID, 'Folder reorder must include every active item under the parent'), 400);
        }

        const batch = orderedIds.map((id: number, index: number) => {
            return c.env.DB.prepare(
                'UPDATE folders SET sort_order = ? WHERE id = ? AND parent_id IS ? AND is_deleted = 0'
            ).bind(index, id, expectedParentId ?? null);
        });
        const results = await c.env.DB.batch(batch);
        if (results.some((mutation) => Number(mutation.meta.changes ?? 0) !== 1)) {
            return c.json(err(ErrCode.REORDER_INVALID, 'Folder reorder changed while processing'), 409);
        }
        return c.json({ success: true });
    });

    app.put('/folders/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json(err(ErrCode.INVALID_ID, 'Invalid ID'), 400);
        const id = idRes.data;

        const existing = await c.env.DB.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0')
            .bind(id)
            .first<{ id: number }>();
        if (!existing) return c.json(err(ErrCode.NOT_FOUND, 'Folder not found'), 404);

        const bodyRes = s.folderSchema.partial().safeParse(await c.req.json());
        if (!bodyRes.success) return c.json(err(ErrCode.VALIDATION, bodyRes.error.issues[0].message), 400);
        const { name, parent_id } = bodyRes.data;

        if (parent_id === id) {
            return c.json(err(ErrCode.SELF_REFERENCE, 'Cannot move folder into itself'), 400);
        }

        if (parent_id) {
            const parent = await c.env.DB.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0')
                .bind(parent_id)
                .first<{ id: number }>();
            if (!parent) {
                return c.json(err(ErrCode.NOT_FOUND, 'Parent folder not found'), 404);
            }

            const { results } = await c.env.DB.prepare(`
                WITH RECURSIVE descendants(id, path) AS (
                    SELECT id, printf('/%d/', id) FROM folders WHERE parent_id = ?
                    UNION ALL
                    SELECT f.id, d.path || printf('%d/', f.id)
                    FROM folders f JOIN descendants d ON f.parent_id = d.id
                    WHERE instr(d.path, printf('/%d/', f.id)) = 0
                )
                SELECT id FROM descendants WHERE id = ?
            `).bind(id, parent_id).all();
            if (results.length > 0) {
                return c.json(err(ErrCode.CIRCULAR_REF, 'Cannot move folder into one of its subfolders'), 400);
            }
            if (await exceedsFolderDepthLimit(c.env.DB, id, parent_id)) {
                return c.json(err(ErrCode.FOLDER_DEPTH_LIMIT, `Folder depth cannot exceed ${MAX_FOLDER_DEPTH}`), 400);
            }
        }

        let mutation: D1Result | null = null;
        try {
            if (name !== undefined && parent_id !== undefined) {
                mutation = await c.env.DB.prepare('UPDATE folders SET name = ?, parent_id = ? WHERE id = ? AND is_deleted = 0').bind(name, parent_id, id).run();
            } else if (name !== undefined) {
                mutation = await c.env.DB.prepare('UPDATE folders SET name = ? WHERE id = ? AND is_deleted = 0').bind(name, id).run();
            } else if (parent_id !== undefined) {
                mutation = await c.env.DB.prepare('UPDATE folders SET parent_id = ? WHERE id = ? AND is_deleted = 0').bind(parent_id, id).run();
            }
        } catch (error) {
            if (isActiveFolderSiblingConflict(error)) {
                return c.json(err(ErrCode.FOLDER_EXISTS, 'A folder with this name already exists here'), 409);
            }
            throw error;
        }
        if (mutation && Number(mutation.meta.changes ?? 0) === 0) {
            return c.json(err(ErrCode.NOT_FOUND, 'Folder not found'), 404);
        }
        return c.json({ success: true });
    });

    app.delete('/folders/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json(err(ErrCode.INVALID_ID, 'Invalid ID'), 400);
        const existing = await c.env.DB.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0').bind(idRes.data).first();
        if (!existing) return c.json(err(ErrCode.NOT_FOUND, 'Folder not found'), 404);
        const deleted = await softDeleteFolderSubtree(c.env.DB, idRes.data);
        if (!deleted) return c.json(err(ErrCode.NOT_FOUND, 'Folder not found'), 404);
        return c.json({ success: true });
    });
}
