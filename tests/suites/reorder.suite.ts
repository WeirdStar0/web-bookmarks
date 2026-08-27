import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('reorder', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('rejects folder reorder across different parent folders', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'root-a' }),
        }), env);
        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'root-b' }),
        }), env);

        const rootAId = db.folders[0].id;
        const rootBId = db.folders[1].id;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'child-a', parent_id: rootAId }),
        }), env);
        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'child-b', parent_id: rootBId }),
        }), env);
        const childAId = db.folders[2].id;
        const childBId = db.folders[3].id;

        const reorderResponse = await app.fetch(new Request('https://example.com/api/folders/reorder', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ orderedIds: [childAId, childBId] }),
        }), env);

        expect(reorderResponse.status).toBe(400);
        expect(await reorderResponse.json()).toMatchObject({
            error: 'REORDER_CROSS_SCOPE',
            message: 'Folder reorder items must belong to the same parent',
        });
    });

    it('does not reorder a folder moved during folder reorder processing', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.folders.push(
            { id: 7901, name: 'First reorder race folder', parent_id: null, sort_order: 7, is_deleted: 0, created_at: now, updated_at: now },
            { id: 7902, name: 'Second reorder race folder', parent_id: null, sort_order: 8, is_deleted: 0, created_at: now, updated_at: now },
        );
        const originalPrepare = db.prepare.bind(db);
        let moved = false;
        db.prepare = ((sql: string) => {
            const statement = originalPrepare(sql);
            if (!moved && sql.includes('UPDATE folders SET sort_order = ? WHERE id = ? AND parent_id IS ? AND is_deleted = 0')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    moved = true;
                    db.folders.find((folder) => folder.id === 7902)!.parent_id = 99;
                    return originalRun();
                };
            }
            return statement;
        }) as typeof db.prepare;

        const response = await app.fetch(new Request('https://example.com/api/folders/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ orderedIds: [7901, 7902] }),
        }), env);
        expect(response.status).toBe(409);
        expect(db.folders.find((folder) => folder.id === 7902)).toMatchObject({ parent_id: 99, sort_order: 8 });
    });
});
