import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { BookmarkRow } from '../helpers'

describe('search', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('search handles SQL wildcard characters as literal text', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        db.bookmarks.push({
            id: 1,
            title: 'test%_pattern',
            url: 'https://example.org/wildcard',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });
        db.bookmarks.push({
            id: 2,
            title: 'normal bookmark',
            url: 'https://example.org/normal',
            description: null,
            folder_id: null,
            sort_order: 1,
            is_deleted: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });

        // Search for literal '%' — should match only the bookmark containing '%'
        const response = await app.fetch(new Request('https://example.com/api/search?q=' + encodeURIComponent('%'), {
            method: 'GET',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(response.status).toBe(200);
        const data = await response.json() as { bookmarks: BookmarkRow[] };
        expect(data.bookmarks).toHaveLength(1);
        expect(data.bookmarks[0].title).toBe('test%_pattern');

        // Search for literal '_' — should match only the bookmark containing '_'
        const response2 = await app.fetch(new Request('https://example.com/api/search?q=' + encodeURIComponent('_'), {
            method: 'GET',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(response2.status).toBe(200);
        const data2 = await response2.json() as { bookmarks: BookmarkRow[] };
        expect(data2.bookmarks).toHaveLength(1);
        expect(data2.bookmarks[0].title).toBe('test%_pattern');
    });

    it('rejects overlong search queries before executing a database scan', async () => {
        const cookie = await login(env);
        const response = await app.fetch(new Request(`https://example.com/api/search?q=${'a'.repeat(201)}`, {
            method: 'GET',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            error: 'VALIDATION_ERROR',
            message: 'Search query must not exceed 200 characters',
        });
    });

    it('returns 401 for an empty query when the session has been revoked', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const currentVersion = db.settings.get('session_version');
        db.settings.set('session_version', `${currentVersion}-revoked`);

        const response = await app.fetch(new Request('https://example.com/api/search?q=', {
            method: 'GET',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({ error: 'UNAUTHORIZED' });
    });

    it('serves an empty result for a valid session with an empty query', async () => {
        const cookie = await login(env);
        const response = await app.fetch(new Request('https://example.com/api/search?q=', {
            method: 'GET',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ bookmarks: [] });
    });
});
