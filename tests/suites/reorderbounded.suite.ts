import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('reorderbounded', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('does not expose database failures from bookmark reorder', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        db.bookmarks.push({
            id: 8001,
            title: 'Reorder test',
            url: 'https://example.com/reorder-test',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });
        db.batch = async () => {
            throw new Error('Simulated D1 schema detail');
        };

        const response = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ orderedIds: [8001] }),
        }), env);

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
            error: 'SERVER_ERROR',
            message: 'Bookmark reorder failed',
        });
    });
});
