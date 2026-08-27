import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('exportorphan', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('exports legacy orphaned and cyclic folder data without loss or unbounded recursion', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.folders.push(
            { id: 9101, name: 'Orphan Folder', parent_id: 9999, sort_order: 0, is_deleted: 0, created_at: now, updated_at: now },
            { id: 9102, name: 'Cycle A', parent_id: 9103, sort_order: 0, is_deleted: 0, created_at: now, updated_at: now },
            { id: 9103, name: 'Cycle B', parent_id: 9102, sort_order: 0, is_deleted: 0, created_at: now, updated_at: now },
        );
        db.bookmarks.push({
            id: 9104,
            title: 'Orphan Bookmark',
            url: 'https://example.com/orphan-bookmark',
            description: null,
            folder_id: 9999,
            sort_order: 0,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        }, {
            id: 9105,
            title: 'Legacy Unsafe URL',
            url: 'javascript:alert(1)',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });

        const response = await app.fetch(new Request('https://example.com/api/export', {
            headers: { Cookie: cookie },
        }), env);
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('Orphan Folder');
        expect(html).toContain('Cycle A');
        expect(html).toContain('Cycle B');
        expect(html).toContain('Orphan Bookmark');
        expect(html).toContain('Legacy Unsafe URL');
        expect(html).toContain('HREF="about:blank"');
        expect(html).not.toContain('HREF="javascript:');
    });
});
