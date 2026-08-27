import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('reorder3', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('bounds bookmark reorder payloads and does not reorder an item moved during processing', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.bookmarks.push(
            { id: 8201, title: 'First race bookmark', url: 'https://example.com/reorder-race-1', description: null, folder_id: null, sort_order: 7, is_deleted: 0, created_at: now, updated_at: now },
            { id: 8202, title: 'Second race bookmark', url: 'https://example.com/reorder-race-2', description: null, folder_id: null, sort_order: 8, is_deleted: 0, created_at: now, updated_at: now },
        );

        const oversizedResponse = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ orderedIds: Array.from({ length: 2001 }, (_, index) => index + 1) }),
        }), env);
        expect(oversizedResponse.status).toBe(400);
        expect(await oversizedResponse.json()).toMatchObject({ error: 'VALIDATION_ERROR' });

        const originalPrepare = db.prepare.bind(db);
        let moved = false;
        db.prepare = ((sql: string) => {
            const statement = originalPrepare(sql);
            if (!moved && sql.includes('UPDATE bookmarks SET sort_order = ? WHERE id = ? AND folder_id IS ? AND is_deleted = 0')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    moved = true;
                    db.bookmarks.find((bookmark) => bookmark.id === 8202)!.folder_id = 99;
                    return originalRun();
                };
            }
            return statement;
        }) as typeof db.prepare;

        const raceResponse = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ orderedIds: [8201, 8202] }),
        }), env);
        expect(raceResponse.status).toBe(409);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8202)).toMatchObject({ folder_id: 99, sort_order: 8 });
    });
});
