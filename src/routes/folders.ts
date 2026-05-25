import * as s from '../utils/schemas';
import { softDeleteFolderSubtree } from '../services/trash';
import { err, ErrCode } from '../utils/common';
import type { ApiApp } from './types';

export function registerFolderRoutes(app: ApiApp) {
    app.post('/folders', async (c) => {
        const body = await c.req.json();
        const result = s.folderSchema.safeParse(body);

        if (!result.success) {
            return c.json(err(ErrCode.VALIDATION, result.error.issues[0].message), 400);
        }
        const { name, parent_id } = result.data;

        await c.env.DB.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)').bind(name, parent_id || null).run();
        return c.json({ success: true });
    });

    app.put('/folders/reorder', async (c) => {
        const result = s.reorderSchema.safeParse(await c.req.json());
        if (!result.success) {
            return c.json(err(ErrCode.VALIDATION, result.error.issues[0].message), 400);
        }
        const { orderedIds } = result.data;

        let expectedParentId: number | null | undefined;
        for (const id of orderedIds) {
            const folder = await c.env.DB.prepare('SELECT parent_id FROM folders WHERE id = ? AND is_deleted = 0')
                .bind(id)
                .first<{ parent_id: number | null }>();
            if (!folder) {
                return c.json(err(ErrCode.REORDER_INVALID, 'Folder reorder contains invalid or deleted items'), 400);
            }
            if (expectedParentId === undefined) {
                expectedParentId = folder.parent_id;
            } else if (folder.parent_id !== expectedParentId) {
                return c.json(err(ErrCode.REORDER_CROSS_SCOPE, 'Folder reorder items must belong to the same parent'), 400);
            }
        }

        const batch = orderedIds.map((id: number, index: number) => {
            return c.env.DB.prepare('UPDATE folders SET sort_order = ? WHERE id = ?').bind(index, id);
        });
        await c.env.DB.batch(batch);
        return c.json({ success: true });
    });

    app.put('/folders/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json(err(ErrCode.INVALID_ID, 'Invalid ID'), 400);
        const id = idRes.data;

        const bodyRes = s.folderSchema.partial().safeParse(await c.req.json());
        if (!bodyRes.success) return c.json(err(ErrCode.VALIDATION, bodyRes.error.issues[0].message), 400);
        const { name, parent_id } = bodyRes.data;

        if (parent_id === id) {
            return c.json(err(ErrCode.SELF_REFERENCE, 'Cannot move folder into itself'), 400);
        }

        if (parent_id) {
            const { results } = await c.env.DB.prepare(`
                WITH RECURSIVE descendants(id) AS (
                    SELECT id FROM folders WHERE parent_id = ?
                    UNION ALL
                    SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
                )
                SELECT id FROM descendants WHERE id = ?
            `).bind(id, parent_id).all();
            if (results.length > 0) {
                return c.json(err(ErrCode.CIRCULAR_REF, 'Cannot move folder into one of its subfolders'), 400);
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

    app.delete('/folders/:id', async (c) => {
        const idRes = s.idSchema.safeParse(c.req.param('id'));
        if (!idRes.success) return c.json(err(ErrCode.INVALID_ID, 'Invalid ID'), 400);
        const existing = await c.env.DB.prepare('SELECT id FROM folders WHERE id = ? AND is_deleted = 0').bind(idRes.data).first();
        if (!existing) return c.json(err(ErrCode.NOT_FOUND, 'Folder not found'), 404);
        await softDeleteFolderSubtree(c.env.DB, idRes.data);
        return c.json({ success: true });
    });
}
