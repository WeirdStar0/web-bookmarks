import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('bookmarkreorder', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('rejects bookmark reorder when request includes deleted bookmarks', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark-a', url: 'https://example.org/a' }),
        }), env);
        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark-b', url: 'https://example.org/b' }),
        }), env);

        const activeId = db.bookmarks[0].id;
        const deletedId = db.bookmarks[1].id;

        await app.fetch(new Request(`https://example.com/api/bookmarks/${deletedId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        const reorderResponse = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ orderedIds: [activeId, deletedId] }),
        }), env);

        expect(reorderResponse.status).toBe(400);
        expect(await reorderResponse.json()).toMatchObject({
            error: 'REORDER_INVALID',
            message: 'Bookmark reorder contains invalid or deleted items',
        });
    });
});
