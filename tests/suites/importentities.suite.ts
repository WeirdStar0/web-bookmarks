import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importentities', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('decodes HTML entities in folder names, bookmark titles and urls on import', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>A &amp; B &#128512; Folder</H3>
    <DL><p>
        <DT><A HREF="https://example.org/search?q=test&amp;category=news">Query &amp; Search &#x1F600; &#1114112;</A>
    </DL><p>
</DL><p>`;

        const response = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: importHtml,
        }), env);

        expect(response.status).toBe(200);
        const result = await response.json() as any;

        expect(result).toMatchObject({
            success: true,
            imported: { folders: 1, bookmarks: 1 },
            skipped: { folders: 0, bookmarks: 0 },
        });

        const folder = db.folders.find((f) => f.name === 'A & B 😀 Folder' && f.is_deleted === 0);
        const bookmark = db.bookmarks.find((b) => b.title === 'Query & Search 😀 &#1114112;' && b.is_deleted === 0);

        expect(folder).toBeTruthy();
        expect(bookmark).toBeTruthy();
        expect(bookmark?.url).toBe('https://example.org/search?q=test&category=news');
    });
});
