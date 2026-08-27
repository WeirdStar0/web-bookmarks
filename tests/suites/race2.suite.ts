import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('race2', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('does not update folders or bookmarks that enter the trash after precondition checks', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.folders.push({ id: 8701, name: 'race-folder', parent_id: null, sort_order: 0, is_deleted: 0, created_at: now, updated_at: now });
        db.bookmarks.push({
            id: 8701,
            title: 'race-bookmark',
            url: 'https://example.com/race-bookmark',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });
        const originalPrepare = db.prepare.bind(db);
        db.prepare = ((sql: string) => {
            const statement = originalPrepare(sql);
            if (sql.includes('UPDATE folders SET name = ? WHERE id = ? AND is_deleted = 0')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    db.folders.find((folder) => folder.id === 8701)!.is_deleted = 1;
                    return originalRun();
                };
            }
            if (sql.includes('UPDATE bookmarks SET title = ? WHERE id = ? AND is_deleted = 0')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    db.bookmarks.find((bookmark) => bookmark.id === 8701)!.is_deleted = 1;
                    return originalRun();
                };
            }
            return statement;
        }) as typeof db.prepare;

        const folderResponse = await app.fetch(new Request('https://example.com/api/folders/8701', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ name: 'updated-folder' }),
        }), env);
        expect(folderResponse.status).toBe(404);
        expect(db.folders.find((folder) => folder.id === 8701)).toMatchObject({ name: 'race-folder', is_deleted: 1 });

        const bookmarkResponse = await app.fetch(new Request('https://example.com/api/bookmarks/8701', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ title: 'updated-bookmark' }),
        }), env);
        expect(bookmarkResponse.status).toBe(404);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8701)).toMatchObject({ title: 'race-bookmark', is_deleted: 1 });
    });
});
