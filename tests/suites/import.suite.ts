import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('import', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('import deduplicates bookmarks and export returns netscape html', async () => {
        const cookie = await login(env);
        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>Programming</H3>
    <DL><p>
        <DT><A HREF="https://example.org">Example</A>
        <DT><A HREF="https://example.org">Example Duplicate</A>
    </DL><p>
</DL><p>`;

        const importResponse = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: importHtml,
        }), env);

        expect(importResponse.status).toBe(200);
        expect(await importResponse.json()).toMatchObject({
            success: true,
            imported: { folders: 1, bookmarks: 1 },
            skipped: { folders: 0, bookmarks: 1 },
        });

        const db = env.DB as unknown as MockD1Database;
        expect(db.folders).toHaveLength(1);
        expect(db.bookmarks).toHaveLength(1);
        expect(db.bookmarks[0].title).toBe('Example');

        const exportResponse = await app.fetch(new Request('https://example.com/api/export', {
            method: 'GET',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(exportResponse.status).toBe(200);
        expect(exportResponse.headers.get('content-type')).toBe('application/x-netscape-bookmark');
        const html = await exportResponse.text();
        expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');
        expect(html).toContain('Programming');
        expect(html).toContain('https://example.org');
    });
});
