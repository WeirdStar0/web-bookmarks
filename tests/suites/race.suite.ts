import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('race', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('does not permanently delete or report restoring bookmarks whose trash state changes concurrently', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.bookmarks.push({
            id: 8801,
            title: 'permanent-delete-race',
            url: 'https://example.com/permanent-delete-race',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        }, {
            id: 8802,
            title: 'restore-race',
            url: 'https://example.com/restore-race',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        });
        const originalPrepare = db.prepare.bind(db);
        db.prepare = ((sql: string) => {
            const statement = originalPrepare(sql);
            if (sql.includes('DELETE FROM bookmarks WHERE id = ? AND is_deleted = 1')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    db.bookmarks.find((bookmark) => bookmark.id === 8801)!.is_deleted = 0;
                    return originalRun();
                };
            }
            if (sql.includes('UPDATE bookmarks\n        SET is_deleted = 0')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    db.bookmarks.find((bookmark) => bookmark.id === 8802)!.is_deleted = 0;
                    return originalRun();
                };
            }
            return statement;
        }) as typeof db.prepare;

        const deleteResponse = await app.fetch(new Request('https://example.com/api/trash/bookmarks/8801', {
            method: 'DELETE', headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);
        expect(deleteResponse.status).toBe(404);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8801)).toMatchObject({ is_deleted: 0 });

        const restoreResponse = await app.fetch(new Request('https://example.com/api/restore/bookmarks/8802', {
            method: 'POST', headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);
        expect(restoreResponse.status).toBe(404);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8802)).toMatchObject({ is_deleted: 0 });
    });
});
