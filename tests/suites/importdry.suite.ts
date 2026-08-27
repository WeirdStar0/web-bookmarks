import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importdry', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('handles dry-run query param correctly in import endpoint', async () => {
        const cookie = await login(env);
        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>DryRun Folder</H3>
    <DL><p>
        <DT><A HREF="https://dryrun.org">DryRun Bookmark</A>
    </DL><p>
</DL><p>`;

        const response = await app.fetch(new Request('https://example.com/api/import?dryRun=true', {
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
            dryRun: true,
            imported: { folders: 1, bookmarks: 1 },
            skipped: { folders: 0, bookmarks: 0 }
        });

        const db = env.DB as unknown as MockD1Database;
        const folders = db.folders.filter(f => f.name === 'DryRun Folder');
        const bookmarks = db.bookmarks.filter(b => b.title === 'DryRun Bookmark');
        expect(folders).toHaveLength(0);
        expect(bookmarks).toHaveLength(0);
    });
});
