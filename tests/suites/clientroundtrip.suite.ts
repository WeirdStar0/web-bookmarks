import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('clientroundtrip', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('preserves literal HTML entities on import-export round-trip without decoding them into characters', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        // 导入包含转义后的字面量实体 `&amp;#128512;` (它代表的字面文本是 `&#128512;`)
        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>Folder &amp;#128512;</H3>
    <DL><p>
        <DT><A HREF="https://example.org/">Bookmark &amp;quot;test&amp;quot;</A>
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

        // 验证写入数据库中的字段值是未被还原成表情或双引号的字面文本
        const folder = db.folders.find((f) => f.is_deleted === 0);
        const bookmark = db.bookmarks.find((b) => b.is_deleted === 0);

        expect(folder?.name).toBe('Folder &#128512;');
        expect(bookmark?.title).toBe('Bookmark &quot;test&quot;');

        // 请求导出
        const exportResponse = await app.fetch(new Request('https://example.com/api/export', {
            headers: {
                Cookie: cookie,
            },
        }), env);

        expect(exportResponse.status).toBe(200);
        const exportHtml = await exportResponse.text();

        // 验证导出的 HTML 将 `&` 进行了转义，从而还原为最初的导入结构
        expect(exportHtml).toContain('<H3>Folder &amp;#128512;</H3>');
        expect(exportHtml).toContain('<A HREF="https://example.org/">Bookmark &amp;quot;test&amp;quot;</A>');
    });
});
