import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('folderroundtrip', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('imports a folder hierarchy with a bounded number of database round-trips', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        const groups: string[] = [];
        for (let i = 0; i < 30; i++) {
            groups.push(
                `<DT><H3>P${i}</H3>\n<DL><p>\n`
                + `<DT><A HREF="https://example.com/p${i}">bp${i}</A>\n`
                + `<DT><H3>C${i}</H3>\n<DL><p>\n<DT><A HREF="https://example.com/c${i}">bc${i}</A>\n</DL><p>\n</DL><p>`
            );
        }
        const body = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p>\n${groups.join('\n')}\n</DL><p>\n`;

        const readsBefore = db.readQueryCount;
        const writesBefore = db.writeQueryCount;
        const response = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                'Content-Type': 'text/html',
                Cookie: cookie,
            },
            body,
        }), env);

        expect(response.status).toBe(200);
        const result = await response.json() as { imported: { folders: number; bookmarks: number } };
        expect(result.imported.folders).toBe(60);
        expect(result.imported.bookmarks).toBe(60);

        // One snapshot read replaces the historical per-folder lookups.
        expect(db.readQueryCount - readsBefore).toBeLessThanOrEqual(8);
        // Folder creation travels as batched statements; a batch is one
        // subrequest in production.
        expect(db.writeQueryCount - writesBefore).toBeLessThanOrEqual(8);
    });
});
