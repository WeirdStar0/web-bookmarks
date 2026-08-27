import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importbudget', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('performs import bookmark deduplication with a bounded number of read queries', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        const items: string[] = [];
        for (let i = 0; i < 150; i++) {
            items.push(`<DT><A HREF="https://example.com/import-${i}">Imported ${i}</A>`);
        }
        const body = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n${items.join('\n')}\n</DL><p>\n`;

        const readsBefore = db.readQueryCount;
        const response = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/html',
                Cookie: cookie,
            },
            body,
        }), env);

        expect(response.status).toBe(200);
        const result = await response.json() as { imported: { bookmarks: number } };
        expect(result.imported.bookmarks).toBe(150);
        const readsUsed = db.readQueryCount - readsBefore;
        // Batched deduplication must not issue one query per bookmark.
        expect(readsUsed).toBeLessThanOrEqual(12);
    });
});
