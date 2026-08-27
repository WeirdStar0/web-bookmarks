import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('reorder2', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('requires bookmark reorder requests to provide each active item exactly once', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        db.bookmarks.push(
            {
                id: 8101,
                title: 'First ordered bookmark',
                url: 'https://example.com/first-ordered',
                description: null,
                folder_id: null,
                sort_order: 10,
                is_deleted: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
            {
                id: 8102,
                title: 'Second ordered bookmark',
                url: 'https://example.com/second-ordered',
                description: null,
                folder_id: null,
                sort_order: 11,
                is_deleted: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
        );

        const partialResponse = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ orderedIds: [8101] }),
        }), env);
        expect(partialResponse.status).toBe(400);
        expect(await partialResponse.json()).toMatchObject({ error: 'REORDER_INVALID' });
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8101)?.sort_order).toBe(10);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8102)?.sort_order).toBe(11);

        const duplicateResponse = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ orderedIds: [8101, 8101] }),
        }), env);
        expect(duplicateResponse.status).toBe(400);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8101)?.sort_order).toBe(10);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8102)?.sort_order).toBe(11);
    });
});
