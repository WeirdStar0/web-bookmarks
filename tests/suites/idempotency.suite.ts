import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('idempotency', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('deduplicates retried bookmark creates with the same idempotency key', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const requestId = 'bookmark-request-0001';
        const createRequest = () => new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
                Cookie: cookie,
                'Idempotency-Key': requestId,
            },
            body: JSON.stringify({
                title: 'Idempotent bookmark',
                url: 'https://example.com/idempotent',
                folder_id: null,
            }),
        });

        const first = await app.fetch(createRequest(), env);
        expect(first.status).toBe(200);
        expect(await first.json()).toMatchObject({ success: true, bookmarkId: 1, deduplicated: false });

        const retry = await app.fetch(createRequest(), env);
        expect(retry.status).toBe(200);
        expect(await retry.json()).toMatchObject({ success: true, bookmarkId: 1, deduplicated: true });
        expect(db.bookmarks).toHaveLength(1);
    });
});
