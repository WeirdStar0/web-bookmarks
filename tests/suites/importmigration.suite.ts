import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importmigration', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('automatically applies D1 migration stamps on first-visit auto-initialization', async () => {
        const db = env.DB as unknown as MockD1Database;
        expect(db.migrations).toHaveLength(0);

        const response = await app.fetch(new Request('https://example.com/'), env);
        expect(response.status).toBe(200);

        expect(db.migrations).toHaveLength(13);
        expect(db.migrations).toContain('001_initial_schema.sql');
        expect(db.migrations).toContain('002_add_indexes.sql');
        expect(db.migrations).toContain('003_upgrade_schema.sql');
        expect(db.migrations).toContain('004_enforce_trash_consistency.sql');
        expect(db.migrations).toContain('005_add_bookmark_sort_index.sql');
        expect(db.migrations).toContain('006_add_bookmark_idempotency.sql');
        expect(db.migrations).toContain('007_prevent_folder_cycles.sql');
        expect(db.migrations).toContain('008_prevent_active_folder_in_deleted_parent.sql');
        expect(db.migrations).toContain('009_cascade_folder_subtree_soft_delete.sql');
        expect(db.migrations).toContain('010_enforce_folder_depth_limit.sql');
        expect(db.migrations).toContain('011_enforce_active_parent_existence.sql');
        expect(db.migrations).toContain('012_add_trash_and_hierarchy_indexes.sql');
        expect(db.migrations).toContain('013_unique_active_folder_sibling_name.sql');
    });
});
