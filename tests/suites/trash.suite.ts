import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('trash', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('empty trash permanently removes soft deleted folders and bookmarks', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'root' }),
        }), env);
        const rootId = db.folders[0].id;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark', url: 'https://example.org', folder_id: rootId }),
        }), env);

        await app.fetch(new Request(`https://example.com/api/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        const emptyResponse = await app.fetch(new Request('https://example.com/api/trash/empty', {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(emptyResponse.status).toBe(200);
        expect(db.folders).toHaveLength(0);
        expect(db.bookmarks).toHaveLength(0);
    });

    it('empty trash removes active bookmarks that still point to trashed folders', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'root' }),
        }), env);
        const rootId = db.folders[0].id;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark', url: 'https://example.org', folder_id: rootId }),
        }), env);

        await app.fetch(new Request(`https://example.com/api/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        db.bookmarks[0].is_deleted = 0;

        const emptyResponse = await app.fetch(new Request('https://example.com/api/trash/empty', {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(emptyResponse.status).toBe(200);
        expect(db.folders).toHaveLength(0);
        expect(db.bookmarks).toHaveLength(0);
    });
});
