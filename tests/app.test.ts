import { beforeEach, describe, expect, it } from 'vitest';
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import app from '../src/index';
import { resetInitState } from '../src/middleware/init';
import { getConfig, hashPasswordV2, parsePasswordHashV3 } from '../src/utils/common';
import { INIT_SQL } from '../src/db/schema';
import { appAssetSource } from '../src/templates/appAsset';
import { appCssAssetSource } from '../src/templates/appCssAsset';
import { vendorAssetSource } from '../src/templates/vendorAsset';
import { main } from '../src/templates/main';
import { modals } from '../src/templates/modals';
import { en } from '../src/locales/en';
import { settingsSchema } from '../src/utils/schemas';

const TEST_INITIAL_ADMIN_PASSWORD = 'CorrectHorseBatteryStaple1!';

describe('P0 regression coverage', () => {
    it('treats an empty settings control as omitted for single-field updates', () => {
        expect(settingsSchema.safeParse({ username: 'new_admin', password: '' }).success).toBe(true);
        expect(settingsSchema.safeParse({ username: '', password: 'CorrectHorseBatteryStaple2!' }).success).toBe(true);
    });

    it('HTML-encodes locale strings before placing them in Alpine expressions', () => {
        const rendered = main({ ...en, lang: 'en' });
        expect(rendered).toContain('&quot;It&#39;s empty here&quot;');
    });
});

type FolderRow = {
    id: number;
    name: string;
    parent_id: number | null;
    sort_order: number;
    is_deleted: number;
    created_at: string;
    updated_at: string;
};

type BookmarkRow = {
    id: number;
    title: string;
    url: string;
    description: string | null;
    folder_id: number | null;
    sort_order: number;
    is_deleted: number;
    created_at: string;
    updated_at: string;
};

class MockPreparedStatement {
    private bindings: unknown[] = [];

    constructor(
        private readonly db: MockD1Database,
        private readonly sql: string,
    ) {}

    bind(...bindings: unknown[]) {
        this.bindings = bindings;
        return this;
    }

    async first<T>() {
        return this.db.executeFirst<T>(this.sql, this.bindings);
    }

    async all<T>() {
        return this.db.executeAll<T>(this.sql, this.bindings);
    }

    async run() {
        return this.db.executeRun(this.sql, this.bindings);
    }
}

class MockD1Database {
    folders: FolderRow[] = [];
    bookmarks: BookmarkRow[] = [];
    settings = new Map<string, string>();
    migrations: string[] = [];
    clientRequestIds = new Map<string, number>();
    initialized = false;
    settingsProbeCount = 0;
    readQueryCount = 0;
    writeQueryCount = 0;
    snapshotShouldFail = false;
    private inBatch = false;
    private folderId = 1;
    private bookmarkId = 1;

    prepare(sql: string) {
        return new MockPreparedStatement(this, sql);
    }

    async batch(statements: MockPreparedStatement[]) {
        // A production D1 batch travels as a single subrequest; count it as one
        // write regardless of how many statements it contains.
        this.writeQueryCount += 1;
        this.inBatch = true;
        try {
            const results = [];
            for (const statement of statements) {
                results.push(await statement.run());
            }
            return results;
        } finally {
            this.inBatch = false;
        }
    }

    async executeFirst<T>(sql: string, bindings: unknown[]) {
        const normalized = normalizeSql(sql);
        this.readQueryCount += 1;

        if (normalized.startsWith('SELECT 1 FROM settings LIMIT 1')) {
            this.settingsProbeCount += 1;
        }

        if (!this.initialized) {
            throw new Error('no such table: settings (D1 simulated)');
        }

        if (normalized.includes('WITH RECURSIVE ancestors(id, parent_id, depth, path) AS')) {
            let depth = 0;
            let currentId: number | null = Number(bindings[0]);
            const visited = new Set<number>();
            while (currentId !== null && !visited.has(currentId)) {
                visited.add(currentId);
                const folder = this.folders.find((item) => item.id === currentId && item.is_deleted === 0);
                if (!folder) break;
                depth += 1;
                currentId = folder.parent_id;
            }
            return { depth } as T;
        }

        if (normalized.includes('WITH RECURSIVE descendants(id, depth, path) AS')) {
            const rootId = Number(bindings[0]);
            const queue = [{ id: rootId, depth: 1 }];
            const visited = new Set<number>();
            let maxDepth = 0;
            while (queue.length > 0) {
                const current = queue.shift() as { id: number; depth: number };
                if (visited.has(current.id)) continue;
                visited.add(current.id);
                const folder = this.folders.find((item) => item.id === current.id && item.is_deleted === 0);
                if (!folder) continue;
                maxDepth = Math.max(maxDepth, current.depth);
                for (const child of this.folders) {
                    if (child.parent_id === current.id && child.is_deleted === 0) {
                        queue.push({ id: child.id, depth: current.depth + 1 });
                    }
                }
            }
            return { depth: maxDepth } as T;
        }

        if (normalized.startsWith('SELECT 1 FROM settings LIMIT 1')) {
            return this.settings.size > 0 ? ({ 1: 1 } as T) : null;
        }

        if (normalized.startsWith('SELECT value FROM settings WHERE key = ?')) {
            const key = String(bindings[0]);
            const value = this.settings.get(key);
            return value === undefined ? null : ({ value } as T);
        }

        if (normalized.startsWith('SELECT id FROM folders WHERE id = ? AND is_deleted = 0')) {
            const id = Number(bindings[0]);
            const folder = this.folders.find((item) => item.id === id && item.is_deleted === 0) ?? null;
            return folder ? ({ id: folder.id } as T) : null;
        }

        if (normalized.startsWith('SELECT id FROM folders WHERE name = ? AND parent_id IS ? AND is_deleted = 0')) {
            const name = String(bindings[0]);
            const parentId = toNullableNumber(bindings[1]);
            const folder = this.folders.find((item) => item.name === name && item.parent_id === parentId && item.is_deleted === 0) ?? null;
            return folder ? ({ id: folder.id } as T) : null;
        }

        if (normalized.startsWith('SELECT 1 FROM bookmarks WHERE url = ? AND folder_id IS ? AND is_deleted = 0')) {
            const url = String(bindings[0]);
            const folderId = toNullableNumber(bindings[1]);
            if (url.includes('query-fail-bookmark')) {
                throw new Error('Simulated D1 bookmark query failure');
            }
            const bookmark = this.bookmarks.find((item) => item.url === url && item.folder_id === folderId && item.is_deleted === 0) ?? null;
            return bookmark ? ({ 1: 1 } as T) : null;
        }

        if (normalized.startsWith('SELECT COUNT(*) AS count FROM folders WHERE parent_id IS ? AND is_deleted = 0')) {
            const parentId = toNullableNumber(bindings[0]);
            const count = this.folders.filter((item) => item.parent_id === parentId && item.is_deleted === 0).length;
            return { count } as T;
        }

        if (normalized.startsWith('SELECT COUNT(*) AS count FROM bookmarks WHERE folder_id IS ? AND is_deleted = 0')) {
            const folderId = toNullableNumber(bindings[0]);
            const count = this.bookmarks.filter((item) => item.folder_id === folderId && item.is_deleted === 0).length;
            return { count } as T;
        }

        if (normalized.startsWith('SELECT id FROM bookmarks WHERE client_request_id = ?')) {
            const id = this.clientRequestIds.get(String(bindings[0]));
            return id === undefined ? null : ({ id } as T);
        }

        if (normalized.startsWith('SELECT id FROM bookmarks WHERE id = ? AND is_deleted = 1')) {
            const id = Number(bindings[0]);
            const bookmark = this.bookmarks.find((item) => item.id === id && item.is_deleted === 1) ?? null;
            return bookmark ? ({ id: bookmark.id } as T) : null;
        }

        if (normalized.startsWith('SELECT id FROM bookmarks WHERE id = ? AND is_deleted = 0')) {
            const id = Number(bindings[0]);
            const bookmark = this.bookmarks.find((item) => item.id === id && item.is_deleted === 0) ?? null;
            return bookmark ? ({ id: bookmark.id } as T) : null;
        }

        if (normalized.startsWith('SELECT id, folder_id FROM bookmarks WHERE id = ? AND is_deleted = 1')) {
            const id = Number(bindings[0]);
            const bookmark = this.bookmarks.find((item) => item.id === id && item.is_deleted === 1) ?? null;
            return bookmark ? ({ id: bookmark.id, folder_id: bookmark.folder_id } as T) : null;
        }

        if (normalized.startsWith('SELECT id, folder_id, is_deleted FROM bookmarks WHERE id = ?')) {
            const id = Number(bindings[0]);
            const bookmark = this.bookmarks.find((item) => item.id === id) ?? null;
            return bookmark ? ({ id: bookmark.id, folder_id: bookmark.folder_id, is_deleted: bookmark.is_deleted } as T) : null;
        }

        if (normalized.startsWith('SELECT id, parent_id FROM folders WHERE id = ? AND is_deleted = 1')) {
            const id = Number(bindings[0]);
            const folder = this.folders.find((item) => item.id === id && item.is_deleted === 1) ?? null;
            return folder ? ({ id: folder.id, parent_id: folder.parent_id } as T) : null;
        }

        if (normalized.startsWith('SELECT id FROM folders WHERE id = ? AND is_deleted = 0')) {
            const id = Number(bindings[0]);
            const folder = this.folders.find((item) => item.id === id && item.is_deleted === 0) ?? null;
            return folder ? ({ id: folder.id } as T) : null;
        }

        if (normalized.startsWith('SELECT parent_id FROM folders WHERE id = ? AND is_deleted = 0')) {
            const id = Number(bindings[0]);
            const folder = this.folders.find((item) => item.id === id && item.is_deleted === 0) ?? null;
            return folder ? ({ parent_id: folder.parent_id } as T) : null;
        }

        if (normalized.startsWith('SELECT folder_id FROM bookmarks WHERE id = ? AND is_deleted = 0')) {
            const id = Number(bindings[0]);
            const bookmark = this.bookmarks.find((item) => item.id === id && item.is_deleted === 0) ?? null;
            return bookmark ? ({ folder_id: bookmark.folder_id } as T) : null;
        }

        throw new Error(`Unsupported first() SQL: ${normalized}`);
    }

    async executeAll<T>(sql: string, bindings: unknown[]) {
        const normalized = normalizeSql(sql);
        this.readQueryCount += 1;

        if (!this.initialized) {
            throw new Error('no such table: settings (D1 simulated)');
        }

        if (normalized.startsWith('SELECT id, folder_id FROM bookmarks WHERE is_deleted = 0 AND id IN')) {
            const ids = new Set(bindings.map(Number));
            return {
                results: this.bookmarks
                    .filter((item) => item.is_deleted === 0 && ids.has(item.id))
                    .map((item) => ({ id: item.id, folder_id: item.folder_id })) as T[],
            };
        }

        if (normalized.startsWith('SELECT id, parent_id FROM folders WHERE is_deleted = 0 AND id IN')) {
            const ids = new Set(bindings.map(Number));
            return {
                results: this.folders
                    .filter((item) => item.is_deleted === 0 && ids.has(item.id))
                    .map((item) => ({ id: item.id, parent_id: item.parent_id })) as T[],
            };
        }

        if (normalized.startsWith('SELECT url, folder_id FROM bookmarks WHERE is_deleted = 0 AND url IN')) {
            const urls = new Set(bindings.map(String));
            for (const url of urls) {
                if (url.includes('query-fail-bookmark')) {
                    throw new Error('Simulated D1 bookmark query failure');
                }
            }
            return {
                results: this.bookmarks
                    .filter((item) => item.is_deleted === 0 && urls.has(item.url))
                    .map((item) => ({ url: item.url, folder_id: item.folder_id })) as T[],
            };
        }

        if (normalized.startsWith('SELECT key, value FROM settings')) {
            return {
                results: Array.from(this.settings.entries()).map(([key, value]) => ({ key, value })) as T[],
            };
        }

        if (normalized.startsWith('SELECT * FROM folders WHERE is_deleted = 0 ORDER BY sort_order ASC, name ASC')) {
            return {
                results: this.folders
                    .filter((item) => item.is_deleted === 0)
                    .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)) as T[],
            };
        }

        if (normalized.startsWith('SELECT * FROM bookmarks WHERE is_deleted = 0 ORDER BY sort_order ASC, created_at ASC')) {
            return {
                results: this.bookmarks
                    .filter((item) => item.is_deleted === 0)
                    .sort((a, b) => (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at)) as T[],
            };
        }

        if (normalized.startsWith('SELECT * FROM folders WHERE is_deleted = 1 ORDER BY name')) {
            return {
                results: this.folders
                    .filter((item) => item.is_deleted === 1)
                    .sort((a, b) => a.name.localeCompare(b.name)) as T[],
            };
        }

        if (normalized.startsWith('SELECT * FROM bookmarks WHERE is_deleted = 1 ORDER BY created_at DESC')) {
            return {
                results: this.bookmarks
                    .filter((item) => item.is_deleted === 1)
                    .sort((a, b) => b.created_at.localeCompare(a.created_at)) as T[],
            };
        }

        if (normalized.startsWith('SELECT id, name, parent_id, sort_order, is_deleted, created_at, updated_at FROM folders WHERE is_deleted = 0')) {
            return {
                results: this.folders
                    .filter((item) => item.is_deleted === 0)
                    .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)) as T[],
            };
        }

        if (normalized.startsWith('SELECT id, title, url, description, folder_id, sort_order, is_deleted, created_at, updated_at FROM bookmarks WHERE is_deleted = 0')) {
            let results = this.bookmarks.filter((item) => item.is_deleted === 0);
            if (normalized.includes('title LIKE ? ESCAPE')) {
                const likePattern = String(bindings[0]);
                const term = likePattern.slice(1, -1)
                    .replace(/\\%/g, '%')
                    .replace(/\\_/g, '_')
                    .replace(/\\\\/g, '\\');
                results = results.filter((item) => item.title.includes(term) || item.url.includes(term) || (item.description || '').includes(term));
            } else if (normalized.includes('folder_id IS NULL')) {
                results = results.filter((item) => item.folder_id === null);
            } else if (normalized.includes('folder_id = ?')) {
                results = results.filter((item) => item.folder_id === Number(bindings[0]));
            }
            return {
                results: results.sort((a, b) => (a.sort_order - b.sort_order) || a.created_at.localeCompare(b.created_at)).slice(0, 50) as T[],
            };
        }

        if (normalized.startsWith('SELECT folder_id, COUNT(*) AS count FROM bookmarks WHERE is_deleted = 0')) {
            const counts = new Map<number, number>();
            for (const item of this.bookmarks) {
                if (item.is_deleted === 0 && item.folder_id !== null) {
                    counts.set(item.folder_id, (counts.get(item.folder_id) || 0) + 1);
                }
            }
            return {
                results: [...counts.entries()].map(([folder_id, count]) => ({ folder_id, count })) as T[],
            };
        }

        if (normalized.includes('FROM folders WHERE is_deleted = 0 AND name LIKE ? ESCAPE')) {
            const likePattern = String(bindings[0]);
            const term = likePattern.slice(1, -1)
                .replace(/\\%/g, '%')
                .replace(/\\_/g, '_')
                .replace(/\\\\/g, '\\');
            return {
                results: this.folders
                    .filter((item) => item.is_deleted === 0 && item.name.includes(term))
                    .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name))
                    .slice(0, 50) as T[],
            };
        }

        if (normalized.startsWith('SELECT * FROM folders WHERE is_deleted = 0')) {
            if (this.snapshotShouldFail) {
                throw new Error('Simulated D1 folder snapshot failure');
            }
            return {
                results: this.folders.filter((item) => item.is_deleted === 0) as T[],
            };
        }

        if (normalized.includes('LIKE ? ESCAPE') && normalized.includes('title LIKE ? ESCAPE')) {
            // Extract the search term from the LIKE pattern, unescaping \% and \_
            const likePattern = String(bindings[0]);
            const term = likePattern.slice(1, -1) // strip leading/trailing %
                .replace(/\\%/g, '%')
                .replace(/\\_/g, '_')
                .replace(/\\\\/g, '\\');
            return {
                results: this.bookmarks
                    .filter((item) => item.is_deleted === 0
                        && (item.title.includes(term) || item.url.includes(term)))
                    .sort((a, b) => (a.sort_order - b.sort_order) || b.created_at.localeCompare(a.created_at))
                    .slice(0, 50) as T[],
            };
        }

        if (normalized.startsWith('SELECT * FROM bookmarks WHERE is_deleted = 0')) {
            return {
                results: this.bookmarks.filter((item) => item.is_deleted === 0) as T[],
            };
        }

        if (normalized.includes('WITH RECURSIVE descendants(id, path) AS')) {
            const folderId = Number(bindings[0]);
            const targetId = Number(bindings[1]);
            return {
                results: this.collectFolderSubtreeIds(folderId)
                    .filter((id) => id === targetId)
                    .map((id) => ({ id })) as T[],
            };
        }

        if (normalized.includes('WITH RECURSIVE sub(id, depth, path) AS')) {
            const folderId = Number(bindings[0]);
            const deletedState = bindings.length > 1 ? Number(bindings[1]) : undefined;
            return {
                results: this.collectFolderSubtreeIds(folderId, deletedState).map((id) => ({ id })) as T[],
            };
        }

        throw new Error(`Unsupported all() SQL: ${normalized}`);
    }

    async executeRun(sql: string, bindings: unknown[]) {
        const normalized = normalizeSql(sql);
        if (!this.inBatch) {
            this.writeQueryCount += 1;
        }

        if (normalized.startsWith('CREATE TABLE')) {
            this.initialized = true;
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('CREATE')) {
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('INSERT OR IGNORE INTO d1_migrations')) {
            this.migrations.push(
                '001_initial_schema.sql',
                '002_add_indexes.sql',
                '003_upgrade_schema.sql',
                '004_enforce_trash_consistency.sql',
                '005_add_bookmark_sort_index.sql',
                '006_add_bookmark_idempotency.sql',
                '007_prevent_folder_cycles.sql',
                '008_prevent_active_folder_in_deleted_parent.sql',
                '009_cascade_folder_subtree_soft_delete.sql',
                '010_enforce_folder_depth_limit.sql',
                '011_enforce_active_parent_existence.sql',
                '012_add_trash_and_hierarchy_indexes.sql'
            );
            return { success: true, meta: {} };
        }

        if (!this.initialized) {
            throw new Error('no such table: settings (D1 simulated)');
        }

        if (normalized.startsWith('INSERT INTO settings (key, value) VALUES (?, ?)')) {
            this.settings.set(String(bindings[0]), String(bindings[1]));
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')) {
            const key = String(bindings[0]);
            const changes = this.settings.has(key) ? 0 : 1;
            if (changes === 1) {
                this.settings.set(key, String(bindings[1]));
            }
            return { success: true, meta: { changes } };
        }

        if (normalized.startsWith('UPDATE settings SET value = ? WHERE key = ? AND value = ?')) {
            const key = String(bindings[1]);
            const expectedValue = String(bindings[2]);
            if (this.settings.get(key) !== expectedValue) {
                return { success: true, meta: { changes: 0 } };
            }
            this.settings.set(key, String(bindings[0]));
            return { success: true, meta: { changes: 1 } };
        }

        if (normalized.startsWith('UPDATE settings SET value = ? WHERE key = ?')) {
            this.settings.set(String(bindings[1]), String(bindings[0]));
            return { success: true, meta: { changes: 1 } };
        }

        if (normalized.startsWith('INSERT INTO folders (name, parent_id) SELECT ?, NULL WHERE NOT EXISTS')) {
            const folderName = String(bindings[0]);
            if (folderName === 'FAIL_FOLDER') {
                throw new Error('Simulated D1 DB write failure');
            }
            const exists = this.folders.some((item) => item.name === String(bindings[1])
                && item.parent_id === null
                && item.is_deleted === 0);
            if (exists) return { success: true, meta: { changes: 0 } };
            const id = this.folderId++;
            const now = new Date().toISOString();
            this.folders.push({
                id,
                name: folderName,
                parent_id: null,
                sort_order: 0,
                is_deleted: 0,
                created_at: now,
                updated_at: now,
            });
            return { success: true, meta: { last_row_id: id, changes: 1 } };
        }

        if (normalized.startsWith('INSERT INTO folders (name, parent_id) VALUES (?, ?)')
            || normalized.startsWith('INSERT INTO folders (name, parent_id) SELECT ?, ? WHERE NOT EXISTS')) {
            const folderName = String(bindings[0]);
            const parentId = toNullableNumber(bindings[1]);
            if (folderName === 'FAIL_FOLDER') {
                throw new Error('Simulated D1 DB write failure');
            }
            if (normalized.includes('WHERE NOT EXISTS')) {
                const exists = this.folders.some((item) => item.name === String(bindings[2])
                    && item.parent_id === toNullableNumber(bindings[3])
                    && item.is_deleted === 0);
                if (exists) return { success: true, meta: { changes: 0 } };
            }
            const id = this.folderId++;
            const now = new Date().toISOString();
            this.folders.push({
                id,
                name: folderName,
                parent_id: parentId,
                sort_order: 0,
                is_deleted: 0,
                created_at: now,
                updated_at: now,
            });

            if (folderName === 'CONFLICT_PARENT') {
                this.bookmarks.push({
                    id: this.bookmarkId++,
                    title: 'Conflict Bookmark (Concurrent)',
                    url: 'https://example.org/conflict',
                    description: null,
                    folder_id: id,
                    sort_order: 0,
                    is_deleted: 0,
                    created_at: now,
                    updated_at: now,
                });
            }

            return { success: true, meta: { last_row_id: id, changes: 1 } };
        }

        if (normalized.startsWith('INSERT INTO bookmarks (title, url, description, client_request_id, folder_id) VALUES (?, ?, ?, ?, ?)')) {
            const requestId = bindings[3] === null || bindings[3] === undefined ? null : String(bindings[3]);
            if (requestId && this.clientRequestIds.has(requestId)) {
                throw new Error('UNIQUE constraint failed: bookmarks.client_request_id');
            }
            const id = this.bookmarkId++;
            const now = new Date().toISOString();
            this.bookmarks.push({
                id,
                title: String(bindings[0]),
                url: String(bindings[1]),
                description: bindings[2] !== null && bindings[2] !== undefined ? String(bindings[2]) : null,
                folder_id: toNullableNumber(bindings[4]),
                sort_order: 0,
                is_deleted: 0,
                created_at: now,
                updated_at: now,
            });
            if (requestId) this.clientRequestIds.set(requestId, id);
            return { success: true, meta: { last_row_id: id } };
        }

        if (normalized.startsWith('INSERT INTO bookmarks (title, url, description, folder_id) VALUES (?, ?, ?, ?)')) {
            const id = this.bookmarkId++;
            const now = new Date().toISOString();
            this.bookmarks.push({
                id,
                title: String(bindings[0]),
                url: String(bindings[1]),
                description: bindings[2] !== null && bindings[2] !== undefined ? String(bindings[2]) : null,
                folder_id: toNullableNumber(bindings[3]),
                sort_order: 0,
                is_deleted: 0,
                created_at: now,
                updated_at: now,
            });
            return { success: true, meta: { last_row_id: id } };
        }

        if (normalized.startsWith('INSERT INTO bookmarks (title, url, folder_id) SELECT ?, ?, ? WHERE NOT EXISTS')) {
            const title = String(bindings[0]);
            const url = String(bindings[1]);
            const folderId = toNullableNumber(bindings[2]);
            const exists = this.bookmarks.some((item) => item.url === String(bindings[3]) && item.folder_id === toNullableNumber(bindings[4]) && item.is_deleted === 0);

            if (!exists) {
                const id = this.bookmarkId++;
                const now = new Date().toISOString();
                this.bookmarks.push({
                    id,
                    title,
                    url,
                    description: null,
                    folder_id: folderId,
                    sort_order: 0,
                    is_deleted: 0,
                    created_at: now,
                    updated_at: now,
                });
                return { success: true, meta: { last_row_id: id, changes: 1 } };
            }

            return { success: true, meta: { changes: 0 } };
        }

        if (normalized.startsWith('UPDATE folders SET is_deleted =')) {
            const stateIsBound = normalized.includes('SET is_deleted = ?');
            const nextDeletedState = stateIsBound
                ? Number(bindings[0])
                : (normalized.includes('SET is_deleted = 0') ? 0 : 1);
            const folderId = Number(bindings[stateIsBound ? 1 : 0]);
            const requiresActiveState = normalized.includes('AND is_deleted = 0');
            const requiresDeletedState = normalized.includes('AND is_deleted = 1');
            const requiresActiveParent = normalized.includes('EXISTS (SELECT 1 FROM folders AS parent');
            const folder = this.folders.find((item) => item.id === folderId) ?? null;
            const parent = folder?.parent_id === null || folder?.parent_id === undefined
                ? null
                : this.folders.find((item) => item.id === folder.parent_id) ?? null;
            const canChange = Boolean(folder)
                && (!requiresActiveState || folder!.is_deleted === 0)
                && (!requiresDeletedState || folder!.is_deleted === 1)
                && (!requiresActiveParent || parent === null || parent.is_deleted === 0);

            if (canChange && folder) {
                if (nextDeletedState === 1 && folder.is_deleted === 0) {
                    // Mirror the production trigger: deletion follows the tree
                    // as it exists when the root update executes, and also
                    // deletes bookmarks in every affected folder.
                    const subtreeIds = this.collectFolderSubtreeIds(folder.id, 0);
                    const subtreeSet = new Set(subtreeIds);
                    this.folders.forEach((item) => {
                        if (subtreeSet.has(item.id)) item.is_deleted = 1;
                    });
                    this.bookmarks.forEach((item) => {
                        if (item.folder_id !== null && subtreeSet.has(item.folder_id)) item.is_deleted = 1;
                    });
                } else {
                    folder.is_deleted = nextDeletedState;
                }
            }
            return { success: true, meta: { changes: canChange ? 1 : 0 } };
        }

        if (normalized.startsWith('UPDATE folders SET sort_order = ? WHERE id = ?')) {
            const requireActive = normalized.includes('AND is_deleted = 0');
            const requireParentScope = normalized.includes('AND parent_id IS ?');
            const expectedParentId = requireParentScope ? toNullableNumber(bindings[2]) : undefined;
            const folder = this.folders.find((item) => item.id === Number(bindings[1])
                && (!requireActive || item.is_deleted === 0)
                && (!requireParentScope || item.parent_id === expectedParentId));
            if (folder) {
                folder.sort_order = Number(bindings[0]);
            }
            return { success: true, meta: { changes: folder ? 1 : 0 } };
        }

        if (normalized.startsWith('UPDATE folders SET name = ?, parent_id = ? WHERE id = ?')) {
            const requireActive = normalized.includes('AND is_deleted = 0');
            const folder = this.folders.find((item) => item.id === Number(bindings[2]) && (!requireActive || item.is_deleted === 0));
            if (folder) {
                folder.name = String(bindings[0]);
                folder.parent_id = toNullableNumber(bindings[1]);
            }
            return { success: true, meta: { changes: folder ? 1 : 0 } };
        }

        if (normalized.startsWith('UPDATE folders SET name = ? WHERE id = ?')) {
            const requireActive = normalized.includes('AND is_deleted = 0');
            const folder = this.folders.find((item) => item.id === Number(bindings[1]) && (!requireActive || item.is_deleted === 0));
            if (folder) {
                folder.name = String(bindings[0]);
            }
            return { success: true, meta: { changes: folder ? 1 : 0 } };
        }

        if (normalized.startsWith('UPDATE folders SET parent_id = ? WHERE id = ?')) {
            const requireActive = normalized.includes('AND is_deleted = 0');
            const folder = this.folders.find((item) => item.id === Number(bindings[1]) && (!requireActive || item.is_deleted === 0));
            if (folder) {
                folder.parent_id = toNullableNumber(bindings[0]);
            }
            return { success: true, meta: { changes: folder ? 1 : 0 } };
        }

        if (normalized.startsWith('UPDATE bookmarks SET is_deleted =')
            && normalized.includes('WHERE folder_id = ?')) {
            const stateIsBound = normalized.includes('SET is_deleted = ?');
            const isDeleted = stateIsBound
                ? Number(bindings[0])
                : (normalized.includes('SET is_deleted = 0') ? 0 : 1);
            const folderId = Number(bindings[stateIsBound ? 1 : 0]);
            const requiresDeletedState = normalized.includes('AND is_deleted = 1');
            const requiresActiveFolder = normalized.includes('EXISTS (SELECT 1 FROM folders WHERE id = bookmarks.folder_id AND is_deleted = 0)');
            const folderIsActive = this.folders.some((folder) => folder.id === folderId && folder.is_deleted === 0);
            let changes = 0;
            this.bookmarks.forEach((item) => {
                if (item.folder_id === folderId
                    && (!requiresDeletedState || item.is_deleted === 1)
                    && (!requiresActiveFolder || folderIsActive)) {
                    item.is_deleted = isDeleted;
                    changes += 1;
                }
            });
            return { success: true, meta: { changes } };
        }

        if (normalized.startsWith('UPDATE bookmarks SET is_deleted = 1 WHERE id = ?')) {
            const requiresActiveState = normalized.includes('AND is_deleted = 0');
            const bookmark = this.bookmarks.find((item) => item.id === Number(bindings[0])) ?? null;
            const canDelete = Boolean(bookmark) && (!requiresActiveState || bookmark!.is_deleted === 0);
            if (canDelete && bookmark) {
                bookmark.is_deleted = 1;
            }
            return { success: true, meta: { changes: canDelete ? 1 : 0 } };
        }

        if (normalized.startsWith('UPDATE bookmarks SET is_deleted = 0 WHERE id = ?')) {
            const bookmark = this.bookmarks.find((item) => item.id === Number(bindings[0]));
            const requiresTrashed = normalized.includes('AND is_deleted = 1');
            const requiresActiveParent = normalized.includes('EXISTS (SELECT 1 FROM folders WHERE id = bookmarks.folder_id AND is_deleted = 0)');
            const activeParent = bookmark?.folder_id === null
                || bookmark?.folder_id === undefined
                || this.folders.some((folder) => folder.id === bookmark.folder_id && folder.is_deleted === 0);
            const canRestore = Boolean(bookmark)
                && (!requiresTrashed || bookmark!.is_deleted === 1)
                && (!requiresActiveParent || activeParent);
            if (canRestore && bookmark) {
                bookmark.is_deleted = 0;
            }
            return { success: true, meta: { changes: canRestore ? 1 : 0 } };
        }

        if (normalized.startsWith('UPDATE bookmarks SET sort_order = ? WHERE id = ?')) {
            const requireActive = normalized.includes('AND is_deleted = 0');
            const requireFolderScope = normalized.includes('AND folder_id IS ?');
            const expectedFolderId = requireFolderScope ? toNullableNumber(bindings[2]) : undefined;
            const bookmark = this.bookmarks.find((item) => item.id === Number(bindings[1])
                && (!requireActive || item.is_deleted === 0)
                && (!requireFolderScope || item.folder_id === expectedFolderId));
            if (bookmark) {
                bookmark.sort_order = Number(bindings[0]);
            }
            return { success: true, meta: { changes: bookmark ? 1 : 0 } };
        }

        if (normalized.startsWith('UPDATE bookmarks SET')) {
            const id = Number(bindings[bindings.length - 1]);
            const requireActive = normalized.includes('AND is_deleted = 0');
            const bookmark = this.bookmarks.find((item) => item.id === id && (!requireActive || item.is_deleted === 0));
            if (bookmark) {
                const setClause = normalized.slice('UPDATE bookmarks SET '.length, normalized.indexOf(' WHERE id = ?'));
                const clauses = setClause.split(',').map((clause) => clause.trim());
                clauses.forEach((clause, index) => {
                    if (clause === 'title = ?') bookmark.title = String(bindings[index]);
                    if (clause === 'url = ?') bookmark.url = String(bindings[index]);
                    if (clause === 'description = ?') bookmark.description = bindings[index] === null ? null : String(bindings[index]);
                    if (clause === 'folder_id = ?') bookmark.folder_id = toNullableNumber(bindings[index]);
                });
            }
            return { success: true, meta: { changes: bookmark ? 1 : 0 } };
        }

        if (normalized.startsWith('DELETE FROM folders WHERE is_deleted = 1')) {
            this.folders = this.folders.filter((item) => item.is_deleted !== 1);
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('DELETE FROM bookmarks WHERE id = ? AND is_deleted = 1')) {
            const id = Number(bindings[0]);
            const previousLength = this.bookmarks.length;
            this.bookmarks = this.bookmarks.filter((item) => item.id !== id || item.is_deleted !== 1);
            return { success: true, meta: { changes: previousLength - this.bookmarks.length } };
        }

        if (normalized.startsWith('DELETE FROM bookmarks WHERE is_deleted = 1')) {
            this.bookmarks = this.bookmarks.filter((item) => item.is_deleted !== 1);
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('DELETE FROM bookmarks WHERE is_deleted = 0 AND folder_id IN (SELECT id FROM folders WHERE is_deleted = 1)')) {
            const trashedFolderIds = new Set(this.folders.filter((item) => item.is_deleted === 1).map((item) => item.id));
            this.bookmarks = this.bookmarks.filter((item) => item.is_deleted !== 0 || item.folder_id === null || !trashedFolderIds.has(item.folder_id));
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('DELETE FROM bookmarks WHERE is_deleted = 1 AND folder_id IN ( WITH RECURSIVE subtree')) {
            const folderId = Number(bindings[0]);
            const subtreeIds = new Set(this.collectFolderSubtreeIds(folderId));
            const root = this.folders.find((item) => item.id === Number(bindings[1]));
            const isSafeToDelete = root?.is_deleted === 1
                && [...subtreeIds].every((id) => this.folders.find((item) => item.id === id)?.is_deleted === 1);
            const previousLength = this.bookmarks.length;
            if (isSafeToDelete) {
                this.bookmarks = this.bookmarks.filter((item) => !subtreeIds.has(item.folder_id ?? -1) || item.is_deleted !== 1);
            }
            return { success: true, meta: { changes: previousLength - this.bookmarks.length } };
        }

        if (normalized.startsWith('DELETE FROM folders WHERE id IN ( WITH RECURSIVE subtree')) {
            const folderId = Number(bindings[0]);
            const subtreeIds = new Set(this.collectFolderSubtreeIds(folderId));
            const root = this.folders.find((item) => item.id === Number(bindings[1]));
            const isSafeToDelete = root?.is_deleted === 1
                && [...subtreeIds].every((id) => this.folders.find((item) => item.id === id)?.is_deleted === 1);
            const previousLength = this.folders.length;
            if (isSafeToDelete) {
                this.folders = this.folders.filter((item) => !subtreeIds.has(item.id));
            }
            return { success: true, meta: { changes: previousLength - this.folders.length } };
        }

        if (normalized.startsWith('DELETE FROM bookmarks WHERE folder_id = ? AND is_deleted = 1')) {
            const folderId = Number(bindings[0]);
            const previousLength = this.bookmarks.length;
            this.bookmarks = this.bookmarks.filter((item) => item.folder_id !== folderId || item.is_deleted !== 1);
            return { success: true, meta: { changes: previousLength - this.bookmarks.length } };
        }

        if (normalized.startsWith('DELETE FROM bookmarks WHERE folder_id = ?')) {
            const folderId = Number(bindings[0]);
            const previousLength = this.bookmarks.length;
            this.bookmarks = this.bookmarks.filter((item) => item.folder_id !== folderId);
            return { success: true, meta: { changes: previousLength - this.bookmarks.length } };
        }

        if (normalized.startsWith('DELETE FROM folders WHERE id = ? AND is_deleted = 1')) {
            const folderId = Number(bindings[0]);
            const previousLength = this.folders.length;
            this.folders = this.folders.filter((item) => item.id !== folderId || item.is_deleted !== 1);
            return { success: true, meta: { changes: previousLength - this.folders.length } };
        }

        if (normalized.startsWith('DELETE FROM folders WHERE id = ?')) {
            const folderId = Number(bindings[0]);
            const previousLength = this.folders.length;
            this.folders = this.folders.filter((item) => item.id !== folderId);
            return { success: true, meta: { changes: previousLength - this.folders.length } };
        }

        throw new Error(`Unsupported run() SQL: ${normalized}`);
    }

    private collectFolderSubtreeIds(folderId: number, deletedState?: number) {
        const result: number[] = [];
        const visited = new Set<number>();
        const visit = (id: number) => {
            if (visited.has(id)) return;
            visited.add(id);
            const folder = this.folders.find((item) => item.id === id);
            if (!folder) {
                return;
            }
            if (deletedState !== undefined && folder.is_deleted !== deletedState) {
                return;
            }
            result.push(folder.id);
            const children = this.folders.filter((item) => item.parent_id === folder.id);
            for (const child of children) {
                visit(child.id);
            }
        };

        visit(folderId);
        return result;
    }
}

class MockKVNamespace {
    private store = new Map<string, string>();

    async get(key: string, type?: 'json') {
        const value = this.store.get(key) ?? null;
        if (value === null) {
            return null;
        }
        return type === 'json' ? JSON.parse(value) : value;
    }

    async put(key: string, value: string) {
        this.store.set(key, value);
    }
}

class FailingKVNamespace {
    async get() {
        throw new Error('Simulated KV read failure');
    }

    async put() {
        throw new Error('Simulated KV write failure');
    }
}

// Mirrors the real Workers KV constraint that expirationTtl must be at least
// 60 seconds, which the plain in-memory mock does not enforce.
class StrictTtlKVNamespace {
    private store = new Map<string, string>();
    readonly puts: { key: string; value: string; ttl?: number }[] = [];

    async seedRaw(key: string, value: string) {
        this.store.set(key, value);
    }

    async get(key: string, type?: 'json') {
        const value = this.store.get(key) ?? null;
        if (value === null) {
            return null;
        }
        return type === 'json' ? JSON.parse(value) : value;
    }

    async put(key: string, value: string, options?: { expirationTtl?: number }) {
        const ttl = options?.expirationTtl;
        if (ttl !== undefined && ttl < 60) {
            throw new Error('invalid expirationTtl: must be at least 60');
        }
        this.store.set(key, value);
        this.puts.push({ key, value, ttl });
    }
}

function normalizeSql(sql: string) {
    return sql.replace(/\s+/g, ' ').trim();
}

function toNullableNumber(value: unknown) {
    if (value === null || value === undefined) {
        return null;
    }
    return Number(value);
}

function createEnv() {
    return {
        DB: new MockD1Database() as unknown as D1Database,
        RATE_LIMIT_KV: new MockKVNamespace() as unknown as KVNamespace,
        SECRET_KEY: 'test-secret',
        INITIAL_ADMIN_PASSWORD: TEST_INITIAL_ADMIN_PASSWORD,
        ALLOWED_EXTENSION_ORIGINS: 'chrome-extension://allowed-extension-id',
        SESSION_MAX_AGE: '3600',
        RATE_LIMIT_MAX: '100',
        RATE_LIMIT_WINDOW: '60',
        RATE_LIMIT_LOGIN_MAX: '5',
        RATE_LIMIT_LOGIN_WINDOW: '60',
    };
}

function createEnvWithoutExtensionAllowlist() {
    return {
        ...createEnv(),
        ALLOWED_EXTENSION_ORIGINS: '',
    };
}

async function login(env: ReturnType<typeof createEnv>) {
    const response = await app.fetch(new Request('https://example.com/api/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Origin: 'https://example.com',
        },
        body: JSON.stringify({
            username: 'admin',
            password: TEST_INITIAL_ADMIN_PASSWORD,
        }),
    }), env);

    expect(response.status).toBe(200);
        const cookie = response.headers.get('set-cookie');
        expect(cookie).toBeTruthy();
        const db = env.DB as unknown as MockD1Database;
        expect(db.settings.get('password')?.startsWith('v3:')).toBe(true);
        return cookie as string;
    }

describe('web-bookmarks app', () => {
    let env: ReturnType<typeof createEnv>;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('soft delete and restore keep folder subtree and bookmarks consistent', async () => {
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

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'child', parent_id: rootId }),
        }), env);
        const childId = db.folders[1].id;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark', url: 'https://example.org', folder_id: childId }),
        }), env);

        const deleteResponse = await app.fetch(new Request(`https://example.com/api/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);
        expect(deleteResponse.status).toBe(200);
        expect(db.folders.every((item) => item.is_deleted === 1)).toBe(true);
        expect(db.bookmarks.every((item) => item.is_deleted === 1)).toBe(true);

        const restoreResponse = await app.fetch(new Request(`https://example.com/api/restore/folders/${rootId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);
        expect(restoreResponse.status).toBe(200);
        expect(db.folders.every((item) => item.is_deleted === 0)).toBe(true);
        expect(db.bookmarks.every((item) => item.is_deleted === 0)).toBe(true);
    });

    it('soft delete preserves a descendant moved out of the subtree before the root mutation', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        const rootId = 8701;
        const movedChildId = 8702;
        const destinationId = 8703;
        db.folders.push(
            { id: rootId, name: 'root', parent_id: null, sort_order: 0, is_deleted: 0, created_at: now, updated_at: now },
            { id: movedChildId, name: 'moved-child', parent_id: rootId, sort_order: 0, is_deleted: 0, created_at: now, updated_at: now },
            { id: destinationId, name: 'destination', parent_id: null, sort_order: 1, is_deleted: 0, created_at: now, updated_at: now },
        );
        db.bookmarks.push({
            id: 8701,
            title: 'moved bookmark',
            url: 'https://example.com/moved-bookmark',
            description: null,
            folder_id: movedChildId,
            sort_order: 0,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });

        const originalExecuteRun = db.executeRun.bind(db);
        let moved = false;
        db.executeRun = async (sql, bindings) => {
            const normalized = normalizeSql(sql);
            if (!moved
                && normalized.startsWith('UPDATE folders SET is_deleted =')
                && Number(bindings[bindings.length - 1]) === rootId) {
                db.folders.find((folder) => folder.id === movedChildId)!.parent_id = destinationId;
                moved = true;
            }
            return originalExecuteRun(sql, bindings);
        };

        const response = await app.fetch(new Request(`https://example.com/api/folders/${rootId}`, {
            method: 'DELETE',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(response.status).toBe(200);
        expect(db.folders.find((folder) => folder.id === rootId)?.is_deleted).toBe(1);
        expect(db.folders.find((folder) => folder.id === movedChildId)).toMatchObject({
            parent_id: destinationId,
            is_deleted: 0,
        });
        expect(db.bookmarks.find((bookmark) => bookmark.folder_id === movedChildId)?.is_deleted).toBe(0);
    });

    it('does not report folder deletion success when the folder enters trash after the precheck', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        const folderId = 8711;
        db.folders.push({
            id: folderId,
            name: 'racing-folder',
            parent_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });

        const originalExecuteRun = db.executeRun.bind(db);
        let raced = false;
        db.executeRun = async (sql, bindings) => {
            const normalized = normalizeSql(sql);
            if (!raced
                && normalized.startsWith('UPDATE folders SET is_deleted =')
                && Number(bindings[bindings.length - 1]) === folderId) {
                db.folders.find((folder) => folder.id === folderId)!.is_deleted = 1;
                raced = true;
            }
            return originalExecuteRun(sql, bindings);
        };

        const response = await app.fetch(new Request(`https://example.com/api/folders/${folderId}`, {
            method: 'DELETE',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(response.status).toBe(404);
        expect(db.folders.find((folder) => folder.id === folderId)?.is_deleted).toBe(1);
    });

    it('does not report bookmark deletion success when the bookmark enters trash after the precheck', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        const bookmarkId = 8721;
        db.bookmarks.push({
            id: bookmarkId,
            title: 'racing bookmark',
            url: 'https://example.com/racing-bookmark',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });

        const originalExecuteRun = db.executeRun.bind(db);
        let raced = false;
        db.executeRun = async (sql, bindings) => {
            const normalized = normalizeSql(sql);
            if (!raced
                && normalized.startsWith('UPDATE bookmarks SET is_deleted = 1 WHERE id = ?')
                && Number(bindings[0]) === bookmarkId) {
                db.bookmarks.find((bookmark) => bookmark.id === bookmarkId)!.is_deleted = 1;
                raced = true;
            }
            return originalExecuteRun(sql, bindings);
        };

        const response = await app.fetch(new Request(`https://example.com/api/bookmarks/${bookmarkId}`, {
            method: 'DELETE',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(response.status).toBe(404);
        expect(db.bookmarks.find((bookmark) => bookmark.id === bookmarkId)?.is_deleted).toBe(1);
    });

    it('permanent delete removes the whole folder subtree', async () => {
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

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'child', parent_id: rootId }),
        }), env);
        const childId = db.folders[1].id;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark', url: 'https://example.org', folder_id: childId }),
        }), env);

        await app.fetch(new Request(`https://example.com/api/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        const permanentDeleteResponse = await app.fetch(new Request(`https://example.com/api/trash/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(permanentDeleteResponse.status).toBe(200);
        expect(db.folders).toHaveLength(0);
        expect(db.bookmarks).toHaveLength(0);
    });

    it('permanently deletes a legacy cyclic trashed folder graph without recursive exhaustion', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.folders.push(
            { id: 8801, name: 'cycle-a', parent_id: 8802, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
            { id: 8802, name: 'cycle-b', parent_id: 8801, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
        );
        db.bookmarks.push(
            { id: 8801, title: 'cycle-a bookmark', url: 'https://example.com/cycle-a', description: null, folder_id: 8801, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
            { id: 8802, title: 'cycle-b bookmark', url: 'https://example.com/cycle-b', description: null, folder_id: 8802, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
        );

        const response = await app.fetch(new Request('https://example.com/api/trash/folders/8801', {
            method: 'DELETE',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);
        expect(response.status).toBe(200);
        expect(db.folders).toHaveLength(0);
        expect(db.bookmarks).toHaveLength(0);
    });

    it('does not permanently delete a folder subtree restored during the deletion race', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.folders.push(
            { id: 8901, name: 'restored-root', parent_id: null, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
            { id: 8902, name: 'restored-child', parent_id: 8901, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
        );
        db.bookmarks.push({
            id: 8901,
            title: 'restored bookmark',
            url: 'https://example.com/restored-bookmark',
            description: null,
            folder_id: 8902,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        });
        const originalBatch = db.batch.bind(db);
        db.batch = async (statements) => {
            db.folders.forEach((folder) => { folder.is_deleted = 0; });
            db.bookmarks.forEach((bookmark) => { bookmark.is_deleted = 0; });
            return originalBatch(statements);
        };

        const response = await app.fetch(new Request('https://example.com/api/trash/folders/8901', {
            method: 'DELETE',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(response.status).toBe(404);
        expect(db.folders).toHaveLength(2);
        expect(db.bookmarks).toHaveLength(1);
        expect(db.folders.every((folder) => folder.is_deleted === 0)).toBe(true);
        expect(db.bookmarks.every((bookmark) => bookmark.is_deleted === 0)).toBe(true);
    });

    it('rejects permanent delete for folders that are not in trash', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'active-root' }),
        }), env);
        const rootId = db.folders[0].id;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'active-child', parent_id: rootId }),
        }), env);
        const childId = db.folders[1].id;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'active-bookmark', url: 'https://example.org/active', folder_id: childId }),
        }), env);

        const permanentDeleteResponse = await app.fetch(new Request(`https://example.com/api/trash/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(permanentDeleteResponse.status).toBe(404);
        expect(await permanentDeleteResponse.json()).toMatchObject({
            error: 'NOT_FOUND',
            message: 'Folder not found in trash',
        });
        expect(db.folders).toHaveLength(2);
        expect(db.bookmarks).toHaveLength(1);
        expect(db.folders.every((item) => item.is_deleted === 0)).toBe(true);
        expect(db.bookmarks.every((item) => item.is_deleted === 0)).toBe(true);
    });

    it('rejects permanent delete for bookmarks that are not in trash', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'active-bookmark', url: 'https://example.org/active' }),
        }), env);

        const bookmarkId = db.bookmarks[0].id;
        const permanentDeleteResponse = await app.fetch(new Request(`https://example.com/api/trash/bookmarks/${bookmarkId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(permanentDeleteResponse.status).toBe(404);
        expect(await permanentDeleteResponse.json()).toMatchObject({
            error: 'NOT_FOUND',
            message: 'Bookmark not found in trash',
        });
        expect(db.bookmarks).toHaveLength(1);
        expect(db.bookmarks[0].is_deleted).toBe(0);
    });

    it('rejects restoring a trashed bookmark when its parent folder is still in trash', async () => {
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
        const bookmarkId = db.bookmarks[0].id;

        await app.fetch(new Request(`https://example.com/api/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        const restoreResponse = await app.fetch(new Request(`https://example.com/api/restore/bookmarks/${bookmarkId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(restoreResponse.status).toBe(409);
        expect(await restoreResponse.json()).toMatchObject({
            error: 'PARENT_IN_TRASH',
            message: 'Parent folder is still in trash',
        });
        expect(db.bookmarks[0].is_deleted).toBe(1);
    });

    it('restores a root-level trashed bookmark successfully', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'root-bookmark', url: 'https://example.org/root' }),
        }), env);
        const bookmarkId = db.bookmarks[0].id;

        await app.fetch(new Request(`https://example.com/api/bookmarks/${bookmarkId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        const restoreResponse = await app.fetch(new Request(`https://example.com/api/restore/bookmarks/${bookmarkId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(restoreResponse.status).toBe(200);
        expect(db.bookmarks[0].is_deleted).toBe(0);
        expect(db.bookmarks[0].folder_id).toBeNull();
    });

    it('returns not found when restoring a bookmark already restored with its parent folder', async () => {
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
        const bookmarkId = db.bookmarks[0].id;

        await app.fetch(new Request(`https://example.com/api/folders/${rootId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        const restoreFolderResponse = await app.fetch(new Request(`https://example.com/api/restore/folders/${rootId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);
        expect(restoreFolderResponse.status).toBe(200);

        expect(db.bookmarks[0].is_deleted).toBe(0);

        const restoreBookmarkResponse = await app.fetch(new Request(`https://example.com/api/restore/bookmarks/${bookmarkId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(restoreBookmarkResponse.status).toBe(404);
        expect(await restoreBookmarkResponse.json()).toMatchObject({
            error: 'NOT_FOUND',
            message: 'Bookmark not found in trash',
        });
        expect(db.folders[0].is_deleted).toBe(0);
        expect(db.bookmarks[0].is_deleted).toBe(0);
    });

    it('rejects restoring a bookmark that is not in trash', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'active-bookmark', url: 'https://example.org/active' }),
        }), env);
        const bookmarkId = db.bookmarks[0].id;

        const restoreResponse = await app.fetch(new Request(`https://example.com/api/restore/bookmarks/${bookmarkId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(restoreResponse.status).toBe(404);
        expect(await restoreResponse.json()).toMatchObject({
            error: 'NOT_FOUND',
            message: 'Bookmark not found in trash',
        });
        expect(db.bookmarks[0].is_deleted).toBe(0);
    });

    it('rejects restoring a folder that is not in trash', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'active-folder' }),
        }), env);
        const folderId = db.folders[0].id;

        const restoreResponse = await app.fetch(new Request(`https://example.com/api/restore/folders/${folderId}`, {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(restoreResponse.status).toBe(404);
        expect(await restoreResponse.json()).toMatchObject({
            error: 'NOT_FOUND',
            message: 'Folder not found in trash',
        });
        expect(db.folders[0].is_deleted).toBe(0);
    });

    it('restores a trashed folder subtree from parent to child under the database parent-state constraint', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.folders.push(
            { id: 200, name: 'RootTrashFolder', parent_id: null, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
            { id: 201, name: 'ChildTrashFolder', parent_id: 200, sort_order: 0, is_deleted: 1, created_at: now, updated_at: now },
        );

        const restoreResponse = await app.fetch(new Request('https://example.com/api/restore/folders/200', {
            method: 'POST',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(restoreResponse.status).toBe(200);
        expect(db.folders.find((folder) => folder.id === 200)?.is_deleted).toBe(0);
        expect(db.folders.find((folder) => folder.id === 201)?.is_deleted).toBe(0);
    });

    it('rejects restoring a folder if its parent folder is still in trash', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        const now = new Date().toISOString();
        db.folders.push({
            id: 100,
            name: 'ParentTrashFolder',
            parent_id: null,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        });

        db.folders.push({
            id: 101,
            name: 'ChildTrashFolder',
            parent_id: 100,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        });

        const restoreResponse = await app.fetch(new Request('https://example.com/api/restore/folders/101', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(restoreResponse.status).toBe(409);
        expect(await restoreResponse.json()).toMatchObject({
            error: 'PARENT_IN_TRASH',
            message: 'Parent folder is still in trash',
        });

        const child = db.folders.find((f) => f.id === 101);
        expect(child?.is_deleted).toBe(1);
    });

    it('uses Lax session cookies for web logins and None only for trusted extension logins', async () => {
        const webResponse = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
            body: JSON.stringify({ username: 'admin', password: TEST_INITIAL_ADMIN_PASSWORD }),
        }), env);
        expect(webResponse.status).toBe(200);
        expect(webResponse.headers.get('set-cookie')).toContain('SameSite=Lax');

        const extensionResponse = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'chrome-extension://allowed-extension-id',
            },
            body: JSON.stringify({ username: 'admin', password: TEST_INITIAL_ADMIN_PASSWORD }),
        }), env);
        expect(extensionResponse.status).toBe(200);
        expect(extensionResponse.headers.get('set-cookie')).toContain('SameSite=None');
        expect(extensionResponse.headers.get('set-cookie')).toContain('Secure');
    });

    it('only returns CORS headers for configured extension origins', async () => {
        const allowedResponse = await app.fetch(new Request('https://example.com/api/data', {
            method: 'OPTIONS',
            headers: {
                Origin: 'chrome-extension://allowed-extension-id',
                'Access-Control-Request-Method': 'GET',
            },
        }), env);
        expect(allowedResponse.headers.get('access-control-allow-origin')).toBe('chrome-extension://allowed-extension-id');

        const blockedResponse = await app.fetch(new Request('https://example.com/api/data', {
            method: 'OPTIONS',
            headers: {
                Origin: 'chrome-extension://blocked-extension-id',
                'Access-Control-Request-Method': 'GET',
            },
        }), env);
        expect(blockedResponse.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('allows the idempotency header for configured extension bookmark saves', async () => {
        const response = await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'OPTIONS',
            headers: {
                Origin: 'chrome-extension://allowed-extension-id',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'content-type,idempotency-key',
            },
        }), env);

        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-origin')).toBe('chrome-extension://allowed-extension-id');
        expect(response.headers.get('access-control-allow-credentials')).toBe('true');
        expect(response.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('idempotency-key');
    });

    it('rejects extension requests when no allowlist is configured', async () => {
        const noAllowlistEnv = createEnvWithoutExtensionAllowlist();

        const corsResponse = await app.fetch(new Request('https://example.com/api/data', {
            method: 'OPTIONS',
            headers: {
                Origin: 'chrome-extension://existing-extension-id',
                'Access-Control-Request-Method': 'GET',
            },
        }), noAllowlistEnv);
        expect(corsResponse.status).toBe(403);
        expect(corsResponse.headers.get('access-control-allow-origin')).toBeNull();

        const loginResponse = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'chrome-extension://existing-extension-id',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), noAllowlistEnv);
        expect(loginResponse.status).toBe(403);
    });

    it('enforces the allowlist once extension origins are explicitly configured', async () => {
        const blockedPreflightResponse = await app.fetch(new Request('https://example.com/api/data', {
            method: 'OPTIONS',
            headers: {
                Origin: 'chrome-extension://blocked-extension-id',
                'Access-Control-Request-Method': 'GET',
            },
        }), env);

        expect(blockedPreflightResponse.status).toBe(403);
        expect(blockedPreflightResponse.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('rejects credentialed api calls from other workers.dev origins', async () => {
        const cookie = await login(env);

        const response = await app.fetch(new Request('https://bookmarks.example.workers.dev/api/data', {
            method: 'GET',
            headers: {
                Cookie: cookie,
                Origin: 'https://attacker.workers.dev',
            },
        }), env);

        expect(response.status).toBe(403);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        expect(await response.json()).toMatchObject({
            error: 'FORBIDDEN',
            message: 'Origin not allowed',
        });
    });

    it('rejects protected api routes without a valid auth cookie', async () => {
        const response = await app.fetch(new Request('https://example.com/api/data', {
            method: 'GET',
            headers: {
                Origin: 'https://example.com',
            },
        }), env);

        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({
            error: 'UNAUTHORIZED',
            message: 'Unauthorized',
        });
    });

    it('fails closed when administrator settings cannot be read during initialization', async () => {
        const db = env.DB as unknown as MockD1Database;
        const originalPrepare = db.prepare.bind(db);
        db.prepare = ((sql: string) => {
            if (sql.trim() === 'SELECT key, value FROM settings') {
                throw new Error('Simulated administrator settings read failure');
            }
            return originalPrepare(sql);
        }) as typeof db.prepare;
        resetInitState();

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
            body: JSON.stringify({ username: 'admin', password: TEST_INITIAL_ADMIN_PASSWORD }),
        }), env);

        expect(response.status).toBe(500);
    });

    it('requires an initial admin password in production when settings are empty', async () => {
        const productionEnv = {
            ...createEnv(),
            INITIAL_ADMIN_PASSWORD: undefined,
        };
        resetInitState();

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), productionEnv);

        expect(response.status).toBe(500);
        const db = productionEnv.DB as unknown as MockD1Database;
        expect(db.settings.has('username')).toBe(false);
        expect(db.settings.has('password')).toBe(false);
    });

    it('repairs partial admin settings when an initial admin password is configured', async () => {
        const db = env.DB as unknown as MockD1Database;
        db.settings.set('username', 'admin');

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), env);

        expect(response.status).toBe(200);
        expect(db.settings.get('password')).toBeTruthy();
    });

    it('rejects non-http bookmark URLs', async () => {
        const cookie = await login(env);

        const createResponse = await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bad', url: 'javascript:alert(1)' }),
        }), env);

        expect(createResponse.status).toBe(400);

        const dataUrlResponse = await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bad', url: 'data:text/html,hi' }),
        }), env);

        expect(dataUrlResponse.status).toBe(400);
    });

    it('rejects missing parent folders and missing update targets', async () => {
        const cookie = await login(env);

        const folderResponse = await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'child', parent_id: 999 }),
        }), env);
        expect(folderResponse.status).toBe(404);

        const bookmarkResponse = await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark', url: 'https://example.org', folder_id: 999 }),
        }), env);
        expect(bookmarkResponse.status).toBe(404);

        const updateFolderResponse = await app.fetch(new Request('https://example.com/api/folders/999', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'missing' }),
        }), env);
        expect(updateFolderResponse.status).toBe(404);

        const updateBookmarkResponse = await app.fetch(new Request('https://example.com/api/bookmarks/999', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'missing' }),
        }), env);
        expect(updateBookmarkResponse.status).toBe(404);
    });

    it('serves the external app asset for alpine initialization', async () => {
        const response = await app.fetch(new Request('https://example.com/assets/app.js'), env);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/javascript');

        const source = await response.text();
        expect(source).toContain('window.app = function app()');
        expect(source).toContain('window.__WEB_BOOKMARKS_APP_READY__ = true;');
        expect(source).toContain("window.dispatchEvent(new Event('web-bookmarks:app-ready'));");
        expect(source).toContain("window.translations.toast.processing");
        expect(source).toContain('isFolderLoading');
        expect(source).toContain('minimumLoadingMs');
        expect(source).toContain('clearFolderLoading()');
        expect(source).toContain('this._folderLoadingTimer = setTimeout');
        expect(source).toContain('this._dataLoadVersion++');
        expect(source).toContain('void this.loadData();');
        expect(source).toContain('handleUnauthorized()');
        expect(source).toContain('if (response.status === 401)');
    });

    it('serves the external css asset for app styling', async () => {
        const response = await app.fetch(new Request('https://example.com/assets/app.css'), env);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/css');

        const source = await response.text();
        expect(source).toContain('.dark');
        expect(source).toContain('.bg-blue-600');
    });

    it('serves the external vendor asset for alpine runtime', async () => {
        const response = await app.fetch(new Request('https://example.com/assets/vendor.js'), env);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/javascript');

        const source = await response.text();
        expect(source).toContain('window.Alpine');
        expect(source).toContain('web-bookmarks:app-ready');
        expect(source).toContain('window.__ALPINE_STARTED__');
        expect(source).toContain('window.__WEB_BOOKMARKS_APP_READY__');
        expect(source).toContain('Alpine.start()');
    });

    it('root html references the generated app asset instead of inline app logic', async () => {
        const response = await app.fetch(new Request('https://example.com/'), env);

        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain('<script type="module" src="/assets/app.js"></script>');
        expect(html).toContain('<link rel="stylesheet" href="/assets/app.css">');
        expect(html).toContain('<script type="module" src="/assets/vendor.js"></script>');
        expect(html).not.toContain('cdn.tailwindcss.com');
        expect(html).not.toContain('cdn.jsdelivr.net/npm/alpinejs');
        expect(html).not.toContain('cdn.jsdelivr.net/npm/@alpinejs/collapse');
        expect(html).not.toContain('function app() {');
        expect(html).not.toContain('placeholder="admin"');
        expect(html).not.toContain('placeholder="••••••"');
        expect((html.match(/loading-overlay/g) ?? []).length).toBe(1);
        expect(html).not.toContain('animate-spin');
        expect(html).not.toContain('bg-black bg-opacity-50 z-[60]');
    });

    it('generated app asset is syntactically valid and fully expanded', () => {
        expect(appAssetSource).not.toContain('__APP_FRAGMENTS_PLACEHOLDER__');
        expect(() => new Function(appAssetSource)).not.toThrow();
        expect(appAssetSource).toContain('isFolderLoading');
        expect(appAssetSource).toContain('clearFolderLoading()');
        expect(appAssetSource).toContain('this._dataLoadVersion++');
    });

    it('renders unified folder navigation loading feedback', () => {
        const rendered = main({ ...en, lang: 'en' });
        expect(rendered).toContain('Folder Navigation Loading Overlay');
        expect(rendered).toContain('loading-spinner');
        expect(rendered).toContain('x-transition:enter="loading-transition"');
        expect(rendered).not.toContain('animate-pulse');
    });

    it('uses one consistent UI transition for modals and selectors', () => {
        const rendered = modals({ ...en, lang: 'en' });
        expect(rendered).toContain('x-transition:enter="ui-transition"');
        expect(rendered).not.toContain('x-transition.opacity');
        expect(rendered).not.toContain('x-transition>');
    });

    it('generated css asset is fully expanded', () => {
        expect(appCssAssetSource.length).toBeGreaterThan(0);
        expect(appCssAssetSource).not.toContain('@tailwind');
        expect(appCssAssetSource).toContain('.loading-spinner');
        expect(appCssAssetSource).toContain('@keyframes loading-spinner-rotate');
        expect(appCssAssetSource).toContain('animation-iteration-count:infinite');
        expect(appCssAssetSource).toContain('animation-play-state:running');
    });

    it('generated vendor asset is fully expanded', () => {
        expect(vendorAssetSource.length).toBeGreaterThan(0);
        expect(vendorAssetSource).not.toContain("from 'alpinejs'");
        expect(vendorAssetSource).not.toContain("from '@alpinejs/collapse'");
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

    it('allows data clients to omit the bookmark collection', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const timestamp = new Date().toISOString();
        db.folders.push({
            id: 9001,
            name: 'Lightweight data folder',
            parent_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: timestamp,
            updated_at: timestamp,
        });
        db.bookmarks.push({
            id: 9001,
            title: 'Bookmark omitted from lightweight response',
            url: 'https://example.com/lightweight',
            description: null,
            folder_id: 9001,
            sort_order: 0,
            is_deleted: 0,
            created_at: timestamp,
            updated_at: timestamp,
        });

        const response = await app.fetch(new Request('https://example.com/api/data?includeBookmarks=false', {
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);
        expect(response.status).toBe(200);
        const data = await response.json() as { folders: FolderRow[]; bookmarks: BookmarkRow[] };
        expect(data.folders).toHaveLength(1);
        expect(data.bookmarks).toEqual([]);
    });

    it('loads only the selected folder bookmarks while preserving whole-library counts', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const timestamp = new Date().toISOString();
        db.folders.push(
            { id: 9101, name: 'Selected folder', parent_id: null, sort_order: 0, is_deleted: 0, created_at: timestamp, updated_at: timestamp },
            { id: 9102, name: 'Other folder', parent_id: null, sort_order: 1, is_deleted: 0, created_at: timestamp, updated_at: timestamp },
        );
        db.bookmarks.push(
            { id: 9101, title: 'Selected', url: 'https://example.com/selected', description: null, folder_id: 9101, sort_order: 0, is_deleted: 0, created_at: timestamp, updated_at: timestamp },
            { id: 9102, title: 'Other', url: 'https://example.com/other', description: null, folder_id: 9102, sort_order: 0, is_deleted: 0, created_at: timestamp, updated_at: timestamp },
        );

        const response = await app.fetch(new Request('https://example.com/api/data?folderId=9101', {
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);
        expect(response.status).toBe(200);
        const data = await response.json() as { bookmarks: BookmarkRow[]; bookmarkCounts: Record<string, number> };
        expect(data.bookmarks.map((bookmark) => bookmark.id)).toEqual([9101]);
        expect(data.bookmarkCounts).toMatchObject({ '9101': 1, '9102': 1 });
        expect(data.bookmarks[0]).not.toHaveProperty('client_request_id');
    });

    it('rejects folder creation and moves that would exceed the maximum depth', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const createFolder = async (name: string, parentId: number | null) => {
            const response = await app.fetch(new Request('https://example.com/api/folders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Cookie: cookie,
                    Origin: 'https://example.com',
                },
                body: JSON.stringify({ name, parent_id: parentId }),
            }), env);
            expect(response.status).toBe(200);
            return db.folders[db.folders.length - 1]?.id as number;
        };

        let parentId: number | null = null;
        for (let depth = 1; depth <= 12; depth += 1) {
            parentId = await createFolder(`depth-${depth}`, parentId);
        }

        const tooDeepResponse = await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'depth-13', parent_id: parentId }),
        }), env);
        expect(tooDeepResponse.status).toBe(400);
        expect(await tooDeepResponse.json()).toMatchObject({ error: 'FOLDER_DEPTH_LIMIT' });

        const moveRootId = await createFolder('move-root', null);
        await createFolder('move-child', moveRootId);
        const moveResponse = await app.fetch(new Request(`https://example.com/api/folders/${moveRootId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ parent_id: db.folders.find((folder) => folder.name === 'depth-11')?.id }),
        }), env);
        expect(moveResponse.status).toBe(400);
        expect(await moveResponse.json()).toMatchObject({ error: 'FOLDER_DEPTH_LIMIT' });
    });

    it('rate limiting returns 429 after configured threshold', async () => {
        env.RATE_LIMIT_MAX = '2';
        const cookie = await login(env);

        const request = () => app.fetch(new Request('https://example.com/api/data', {
            method: 'GET',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
                'cf-connecting-ip': '203.0.113.10',
            },
        }), env);

        expect((await request()).status).toBe(200);
        expect((await request()).status).toBe(200);

        const limitedResponse = await request();
        expect(limitedResponse.status).toBe(429);
        expect(await limitedResponse.json()).toMatchObject({
            error: 'RATE_LIMITED',
            message: '服务器繁忙，请稍后再试',
        });
    });

    it('rejects folder reorder across different parent folders', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'root-a' }),
        }), env);
        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'root-b' }),
        }), env);

        const rootAId = db.folders[0].id;
        const rootBId = db.folders[1].id;

        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'child-a', parent_id: rootAId }),
        }), env);
        await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'child-b', parent_id: rootBId }),
        }), env);
        const childAId = db.folders[2].id;
        const childBId = db.folders[3].id;

        const reorderResponse = await app.fetch(new Request('https://example.com/api/folders/reorder', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ orderedIds: [childAId, childBId] }),
        }), env);

        expect(reorderResponse.status).toBe(400);
        expect(await reorderResponse.json()).toMatchObject({
            error: 'REORDER_CROSS_SCOPE',
            message: 'Folder reorder items must belong to the same parent',
        });
    });

    it('does not reorder a folder moved during folder reorder processing', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.folders.push(
            { id: 7901, name: 'First reorder race folder', parent_id: null, sort_order: 7, is_deleted: 0, created_at: now, updated_at: now },
            { id: 7902, name: 'Second reorder race folder', parent_id: null, sort_order: 8, is_deleted: 0, created_at: now, updated_at: now },
        );
        const originalPrepare = db.prepare.bind(db);
        let moved = false;
        db.prepare = ((sql: string) => {
            const statement = originalPrepare(sql);
            if (!moved && sql.includes('UPDATE folders SET sort_order = ? WHERE id = ? AND parent_id IS ? AND is_deleted = 0')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    moved = true;
                    db.folders.find((folder) => folder.id === 7902)!.parent_id = 99;
                    return originalRun();
                };
            }
            return statement;
        }) as typeof db.prepare;

        const response = await app.fetch(new Request('https://example.com/api/folders/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ orderedIds: [7901, 7902] }),
        }), env);
        expect(response.status).toBe(409);
        expect(db.folders.find((folder) => folder.id === 7902)).toMatchObject({ parent_id: 99, sort_order: 8 });
    });

    it('rejects bookmark reorder when request includes deleted bookmarks', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark-a', url: 'https://example.org/a' }),
        }), env);
        await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ title: 'bookmark-b', url: 'https://example.org/b' }),
        }), env);

        const activeId = db.bookmarks[0].id;
        const deletedId = db.bookmarks[1].id;

        await app.fetch(new Request(`https://example.com/api/bookmarks/${deletedId}`, {
            method: 'DELETE',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        const reorderResponse = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ orderedIds: [activeId, deletedId] }),
        }), env);

        expect(reorderResponse.status).toBe(400);
        expect(await reorderResponse.json()).toMatchObject({
            error: 'REORDER_INVALID',
            message: 'Bookmark reorder contains invalid or deleted items',
        });
    });

    it('does not expose database failures from bookmark reorder', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        db.bookmarks.push({
            id: 8001,
            title: 'Reorder test',
            url: 'https://example.com/reorder-test',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });
        db.batch = async () => {
            throw new Error('Simulated D1 schema detail');
        };

        const response = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ orderedIds: [8001] }),
        }), env);

        expect(response.status).toBe(500);
        expect(await response.json()).toEqual({
            error: 'SERVER_ERROR',
            message: 'Bookmark reorder failed',
        });
    });

    it('requires bookmark reorder requests to provide each active item exactly once', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        db.bookmarks.push(
            {
                id: 8101,
                title: 'First ordered bookmark',
                url: 'https://example.com/first-ordered',
                description: null,
                folder_id: null,
                sort_order: 10,
                is_deleted: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
            {
                id: 8102,
                title: 'Second ordered bookmark',
                url: 'https://example.com/second-ordered',
                description: null,
                folder_id: null,
                sort_order: 11,
                is_deleted: 0,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            },
        );

        const partialResponse = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ orderedIds: [8101] }),
        }), env);
        expect(partialResponse.status).toBe(400);
        expect(await partialResponse.json()).toMatchObject({ error: 'REORDER_INVALID' });
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8101)?.sort_order).toBe(10);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8102)?.sort_order).toBe(11);

        const duplicateResponse = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ orderedIds: [8101, 8101] }),
        }), env);
        expect(duplicateResponse.status).toBe(400);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8101)?.sort_order).toBe(10);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8102)?.sort_order).toBe(11);
    });

    it('bounds bookmark reorder payloads and does not reorder an item moved during processing', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.bookmarks.push(
            { id: 8201, title: 'First race bookmark', url: 'https://example.com/reorder-race-1', description: null, folder_id: null, sort_order: 7, is_deleted: 0, created_at: now, updated_at: now },
            { id: 8202, title: 'Second race bookmark', url: 'https://example.com/reorder-race-2', description: null, folder_id: null, sort_order: 8, is_deleted: 0, created_at: now, updated_at: now },
        );

        const oversizedResponse = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ orderedIds: Array.from({ length: 2001 }, (_, index) => index + 1) }),
        }), env);
        expect(oversizedResponse.status).toBe(400);
        expect(await oversizedResponse.json()).toMatchObject({ error: 'VALIDATION_ERROR' });

        const originalPrepare = db.prepare.bind(db);
        let moved = false;
        db.prepare = ((sql: string) => {
            const statement = originalPrepare(sql);
            if (!moved && sql.includes('UPDATE bookmarks SET sort_order = ? WHERE id = ? AND folder_id IS ? AND is_deleted = 0')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    moved = true;
                    db.bookmarks.find((bookmark) => bookmark.id === 8202)!.folder_id = 99;
                    return originalRun();
                };
            }
            return statement;
        }) as typeof db.prepare;

        const raceResponse = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ orderedIds: [8201, 8202] }),
        }), env);
        expect(raceResponse.status).toBe(409);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8202)).toMatchObject({ folder_id: 99, sort_order: 8 });
    });

    it('replaces the legacy default password with the configured initial password', async () => {
        const db = env.DB as unknown as MockD1Database;
        db.settings.set('username', 'admin');
        db.settings.set('password', '5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5');

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), env);

        expect(response.status).toBe(200);
        expect(db.settings.get('password')).not.toBe('5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5');
    });

    it('does not overwrite a concurrent credential change during legacy password upgrade', async () => {
        const db = env.DB as unknown as MockD1Database;
        const legacyPassword = 'legacy-password-2026';
        const legacySalt = '0123456789abcdef0123456789abcdef';
        const legacyHash = await hashPasswordV2(legacyPassword, legacySalt);
        const concurrentPasswordValue = 'concurrent-password-replacement';
        db.settings.set('username', 'admin');
        db.settings.set('password', `v2:${legacyHash.salt}:${legacyHash.hash}`);
        const originalPrepare = db.prepare.bind(db);
        db.prepare = ((sql: string) => {
            const statement = originalPrepare(sql);
            if (sql.includes('UPDATE settings SET value = ? WHERE key = ? AND value = ?')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    db.settings.set('password', concurrentPasswordValue);
                    return originalRun();
                };
            }
            return statement;
        }) as typeof db.prepare;

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
            body: JSON.stringify({ username: 'admin', password: legacyPassword }),
        }), env);

        expect(response.status).toBe(401);
        expect(db.settings.get('password')).toBe(concurrentPasswordValue);
        expect(response.headers.get('set-cookie')).toBeNull();
    });

    it('fails closed in production when a legacy default password has no configured replacement', async () => {
        const noInitialPasswordEnv = {
            ...createEnv(),
            INITIAL_ADMIN_PASSWORD: undefined,
        };
        const db = noInitialPasswordEnv.DB as unknown as MockD1Database;
        const legacyHash = '5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5';
        db.settings.set('username', 'admin');
        db.settings.set('password', legacyHash);
        resetInitState();

        const response = await app.fetch(new Request('https://example.com/'), noInitialPasswordEnv);
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ error: 'Internal Server Error' });
        expect(db.settings.get('password')).toBe(legacyHash);
    });

    it('invalidates existing sessions after administrator credentials change', async () => {
        const originalCookie = await login(env);
        const replacementPassword = 'rotated-session-password-2026';

        const updateResponse = await app.fetch(new Request('https://example.com/api/settings', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: originalCookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ password: replacementPassword }),
        }), env);
        expect(updateResponse.status).toBe(200);

        const staleSessionResponse = await app.fetch(new Request('https://example.com/api/data', {
            headers: { Cookie: originalCookie, Origin: 'https://example.com' },
        }), env);
        expect(staleSessionResponse.status).toBe(401);

        const freshLoginResponse = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
            body: JSON.stringify({ username: 'admin', password: replacementPassword }),
        }), env);
        expect(freshLoginResponse.status).toBe(200);
        const freshCookie = freshLoginResponse.headers.get('set-cookie');
        expect(freshCookie).toBeTruthy();

        const freshSessionResponse = await app.fetch(new Request('https://example.com/api/data', {
            headers: { Cookie: freshCookie as string, Origin: 'https://example.com' },
        }), env);
        expect(freshSessionResponse.status).toBe(200);
    });

    it('keeps credentials and session version unchanged when settings batch fails', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const originalUsername = db.settings.get('username');
        const originalPassword = db.settings.get('password');
        const originalSessionVersion = db.settings.get('session_version');
        db.batch = async () => {
            throw new Error('Simulated atomic settings batch failure');
        };

        const response = await app.fetch(new Request('https://example.com/api/settings', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ username: 'new-admin', password: 'new-password-after-batch-failure' }),
        }), env);
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ error: 'Internal Server Error' });
        expect(db.settings.get('username')).toBe(originalUsername);
        expect(db.settings.get('password')).toBe(originalPassword);
        expect(db.settings.get('session_version')).toBe(originalSessionVersion);

        const existingSessionResponse = await app.fetch(new Request('https://example.com/api/data', {
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);
        expect(existingSessionResponse.status).toBe(200);
    });

    it('invalidates copied sessions after logout', async () => {
        const copiedCookie = await login(env);
        const logoutResponse = await app.fetch(new Request('https://example.com/api/logout', {
            method: 'POST',
            headers: { Cookie: copiedCookie, Origin: 'https://example.com' },
        }), env);
        expect(logoutResponse.status).toBe(200);

        const staleCopyResponse = await app.fetch(new Request('https://example.com/api/data', {
            headers: { Cookie: copiedCookie, Origin: 'https://example.com' },
        }), env);
        expect(staleCopyResponse.status).toBe(401);
    });

    it('does not permanently delete or report restoring bookmarks whose trash state changes concurrently', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.bookmarks.push({
            id: 8801,
            title: 'permanent-delete-race',
            url: 'https://example.com/permanent-delete-race',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        }, {
            id: 8802,
            title: 'restore-race',
            url: 'https://example.com/restore-race',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        });
        const originalPrepare = db.prepare.bind(db);
        db.prepare = ((sql: string) => {
            const statement = originalPrepare(sql);
            if (sql.includes('DELETE FROM bookmarks WHERE id = ? AND is_deleted = 1')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    db.bookmarks.find((bookmark) => bookmark.id === 8801)!.is_deleted = 0;
                    return originalRun();
                };
            }
            if (sql.includes('UPDATE bookmarks\n        SET is_deleted = 0')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    db.bookmarks.find((bookmark) => bookmark.id === 8802)!.is_deleted = 0;
                    return originalRun();
                };
            }
            return statement;
        }) as typeof db.prepare;

        const deleteResponse = await app.fetch(new Request('https://example.com/api/trash/bookmarks/8801', {
            method: 'DELETE', headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);
        expect(deleteResponse.status).toBe(404);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8801)).toMatchObject({ is_deleted: 0 });

        const restoreResponse = await app.fetch(new Request('https://example.com/api/restore/bookmarks/8802', {
            method: 'POST', headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);
        expect(restoreResponse.status).toBe(404);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8802)).toMatchObject({ is_deleted: 0 });
    });

    it('does not update folders or bookmarks that enter the trash after precondition checks', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const now = new Date().toISOString();
        db.folders.push({ id: 8701, name: 'race-folder', parent_id: null, sort_order: 0, is_deleted: 0, created_at: now, updated_at: now });
        db.bookmarks.push({
            id: 8701,
            title: 'race-bookmark',
            url: 'https://example.com/race-bookmark',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });
        const originalPrepare = db.prepare.bind(db);
        db.prepare = ((sql: string) => {
            const statement = originalPrepare(sql);
            if (sql.includes('UPDATE folders SET name = ? WHERE id = ? AND is_deleted = 0')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    db.folders.find((folder) => folder.id === 8701)!.is_deleted = 1;
                    return originalRun();
                };
            }
            if (sql.includes('UPDATE bookmarks SET title = ? WHERE id = ? AND is_deleted = 0')) {
                const originalRun = statement.run.bind(statement);
                statement.run = async () => {
                    db.bookmarks.find((bookmark) => bookmark.id === 8701)!.is_deleted = 1;
                    return originalRun();
                };
            }
            return statement;
        }) as typeof db.prepare;

        const folderResponse = await app.fetch(new Request('https://example.com/api/folders/8701', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ name: 'updated-folder' }),
        }), env);
        expect(folderResponse.status).toBe(404);
        expect(db.folders.find((folder) => folder.id === 8701)).toMatchObject({ name: 'race-folder', is_deleted: 1 });

        const bookmarkResponse = await app.fetch(new Request('https://example.com/api/bookmarks/8701', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://example.com' },
            body: JSON.stringify({ title: 'updated-bookmark' }),
        }), env);
        expect(bookmarkResponse.status).toBe(404);
        expect(db.bookmarks.find((bookmark) => bookmark.id === 8701)).toMatchObject({ title: 'race-bookmark', is_deleted: 1 });
    });

    it('search handles SQL wildcard characters as literal text', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        db.bookmarks.push({
            id: 1,
            title: 'test%_pattern',
            url: 'https://example.org/wildcard',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });
        db.bookmarks.push({
            id: 2,
            title: 'normal bookmark',
            url: 'https://example.org/normal',
            description: null,
            folder_id: null,
            sort_order: 1,
            is_deleted: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });

        // Search for literal '%' — should match only the bookmark containing '%'
        const response = await app.fetch(new Request('https://example.com/api/search?q=' + encodeURIComponent('%'), {
            method: 'GET',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(response.status).toBe(200);
        const data = await response.json() as { bookmarks: BookmarkRow[] };
        expect(data.bookmarks).toHaveLength(1);
        expect(data.bookmarks[0].title).toBe('test%_pattern');

        // Search for literal '_' — should match only the bookmark containing '_'
        const response2 = await app.fetch(new Request('https://example.com/api/search?q=' + encodeURIComponent('_'), {
            method: 'GET',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
        }), env);

        expect(response2.status).toBe(200);
        const data2 = await response2.json() as { bookmarks: BookmarkRow[] };
        expect(data2.bookmarks).toHaveLength(1);
        expect(data2.bookmarks[0].title).toBe('test%_pattern');
    });

    it('rejects overlong search queries before executing a database scan', async () => {
        const cookie = await login(env);
        const response = await app.fetch(new Request(`https://example.com/api/search?q=${'a'.repeat(201)}`, {
            method: 'GET',
            headers: { Cookie: cookie, Origin: 'https://example.com' },
        }), env);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
            error: 'VALIDATION_ERROR',
            message: 'Search query must not exceed 200 characters',
        });
    });

    it('returns a safe validation error for malformed JSON request bodies', async () => {
        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
                'Accept-Language': 'en',
            },
            body: '{"username":',
        }), env);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'VALIDATION_ERROR',
            message: 'Invalid JSON request body',
        });
    });

    it('enforces strict rate limiting on login endpoint', async () => {
        env.RATE_LIMIT_LOGIN_MAX = '2';
        env.RATE_LIMIT_LOGIN_WINDOW = '60';

        const makeLoginRequest = () => app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
                'cf-connecting-ip': '203.0.113.50',
            },
            body: JSON.stringify({ username: 'admin', password: 'wrong-password' }),
        }), env);

        expect((await makeLoginRequest()).status).toBe(401);
        expect((await makeLoginRequest()).status).toBe(401);

        const limitedResponse = await makeLoginRequest();
        expect(limitedResponse.status).toBe(429);
        expect(await limitedResponse.json()).toMatchObject({
            error: 'RATE_LIMITED',
        });
    });

    it('enforces size and complexity limits on import endpoint', async () => {
        const cookie = await login(env);

        const sizeResponse = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
                'Content-Length': (3 * 1024 * 1024).toString(),
            },
            body: 'a'.repeat(100),
        }), env);
        expect(sizeResponse.status).toBe(413);

        let deepHtml = '<!DOCTYPE NETSCAPE-Bookmark-file-1>';
        for(let i=0; i<10; i++) {
            deepHtml += `<DL><p><DT><H3>Folder ${i}</H3>`;
        }
        deepHtml += '<DT><A HREF="https://nested.com">Nested</A>';
        for(let i=0; i<10; i++) {
            deepHtml += '</DL><p>';
        }

        const depthResponse = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: deepHtml,
        }), env);
        expect(depthResponse.status).toBe(200);
        const data = await depthResponse.json() as any;
        expect(data.success).toBe(true);
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

    it('returns CSP header with style-src unsafe-inline and without script-src unsafe-inline', async () => {
        const response = await app.fetch(new Request('https://example.com/'), env);
        expect(response.status).toBe(200);
        const csp = response.headers.get('content-security-policy');
        expect(csp).toBeTruthy();
        expect(csp).toContain("style-src 'self' 'unsafe-inline'");
        expect(csp).toContain("script-src 'self' 'unsafe-eval'");
        expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    });

    it('enforces folder limits on import endpoint and prevents DB pollution', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialFoldersCount = db.folders.length;

        // 生成 201 个不同的文件夹
        let overLimitHtml = '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>';
        for (let i = 0; i < 201; i++) {
            overLimitHtml += `<DT><H3>Folder ${i}</H3><DL><p></DL><p>`;
        }
        overLimitHtml += '</DL><p>';

        const response = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: overLimitHtml,
        }), env);

        expect(response.status).toBe(400);
        const data = await response.json() as any;
        expect(data).toMatchObject({
            error: 'LIMIT_EXCEEDED',
        });
        
        // 验证数据库没有任何写入
        expect(db.folders.length).toBe(initialFoldersCount);
    });

    it('dry-run and real import return identical deduplication statistics for nested virtual structures', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialFolders = db.folders.length;
        const initialBookmarks = db.bookmarks.length;

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>Parent</H3>
    <DL><p>
        <DT><H3>SubFolder</H3>
        <DL><p></DL><p>
        <DT><H3>SubFolder</H3>
        <DL><p></DL><p>
        <DT><A HREF="https://example.org/a">Bookmark A</A>
        <DT><A HREF="https://example.org/b">Bookmark B</A>
        <DT><A HREF="https://example.org/a">Bookmark A Dup</A>
    </DL><p>
</DL><p>`;

        // 1. Dry run
        const dryRunResponse = await app.fetch(new Request('https://example.com/api/import?dryRun=true', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: importHtml,
        }), env);

        expect(dryRunResponse.status).toBe(200);
        const dryResult = await dryRunResponse.json() as any;
        expect(dryResult).toMatchObject({
            success: true,
            dryRun: true,
            imported: { folders: 2, bookmarks: 2 },
            skipped: { folders: 1, bookmarks: 1 }
        });
        expect(db.folders.length).toBe(initialFolders);
        expect(db.bookmarks.length).toBe(initialBookmarks);

        // 2. Real import
        const realResponse = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: importHtml,
        }), env);

        expect(realResponse.status).toBe(200);
        const realResult = await realResponse.json() as any;
        expect(realResult).toMatchObject({
            success: true,
            imported: { folders: 2, bookmarks: 2 },
            skipped: { folders: 1, bookmarks: 1 }
        });
        expect(db.folders.length).toBe(initialFolders + 2);
        expect(db.bookmarks.length).toBe(initialBookmarks + 2);
    });

    it('rejects large import payloads even if Content-Length header is missing', async () => {
        const cookie = await login(env);
        const largeBody = 'a'.repeat(2 * 1024 * 1024 + 1);

        const response = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
                // 故意不传 Content-Length
            },
            body: largeBody,
        }), env);

        expect(response.status).toBe(413);
        const data = await response.json() as any;
        expect(data).toMatchObject({
            error: 'PAYLOAD_TOO_LARGE',
        });
    });

    it('rejects excessive malformed import tag candidates before rich parsing', async () => {
        const cookie = await login(env);
        const malformedBody = '<H3>'.repeat(5001);
        const response = await app.fetch(new Request('https://example.com/api/import?dryRun=true', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: malformedBody,
        }), env);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: 'COMPLEXITY_LIMIT_EXCEEDED' });
    });

    it('returns 413 when cancelling an oversized import stream fails', async () => {
        const cookie = await login(env);
        let cancelCalled = false;
        const oversizedStream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('a'.repeat(2 * 1024 * 1024 + 1)));
            },
            cancel() {
                cancelCalled = true;
                return Promise.reject(new Error('Simulated stream cancel failure'));
            },
        });
        const request = new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: oversizedStream,
            // Required by the Node-compatible Request implementation for a
            // streaming POST body; ignored by the Workers runtime.
            duplex: 'half',
        } as RequestInit & { duplex: string });

        const response = await app.fetch(request, env);
        expect(response.status).toBe(413);
        expect(cancelCalled).toBe(true);
        expect(await response.json()).toMatchObject({ error: 'PAYLOAD_TOO_LARGE' });
    });

    it('renders translations safely in dataset using URL encoding', async () => {
        const response = await app.fetch(new Request('https://example.com/'), env);
        expect(response.status).toBe(200);
        const htmlText = await response.text();
        const match = htmlText.match(/data-translations="([^"]+)"/);
        expect(match).toBeTruthy();
        const encoded = match![1];
        expect(() => JSON.parse(decodeURIComponent(encoded))).not.toThrow();
        const parsed = JSON.parse(decodeURIComponent(encoded));
        expect(parsed).toHaveProperty('lang');
    });

    it('cascades folder creation failures to subfolders and bookmarks and updates counts', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialFolders = db.folders.length;
        const initialBookmarks = db.bookmarks.length;

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>FAIL_FOLDER</H3>
    <DL><p>
        <DT><H3>SubFolder</H3>
        <DL><p></DL><p>
        <DT><A HREF="https://example.org/child">Child Bookmark</A>
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
            imported: { folders: 0, bookmarks: 0 },
        });
        
        expect(result.failures).toHaveLength(3);
        expect(result.failures[0]).toMatchObject({ type: 'folder', name: 'FAIL_FOLDER' });
        expect(result.failures[1]).toMatchObject({ type: 'folder', name: 'SubFolder', error: '父文件夹创建失败，级联跳过' });
        expect(result.failures[2]).toMatchObject({ type: 'bookmark', name: 'Child Bookmark', error: '父文件夹创建失败，级联跳过' });

        expect(db.folders.length).toBe(initialFolders);
        expect(db.bookmarks.length).toBe(initialBookmarks);
    });

    it('correctly reverts bookmark import count when skipped during physical database insertion', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>CONFLICT_PARENT</H3>
    <DL><p>
        <DT><A HREF="https://example.org/conflict">Conflict Bookmark</A>
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
            imported: { folders: 1, bookmarks: 0 },
            skipped: { folders: 0, bookmarks: 1 },
        });

        const conflictParentId = db.folders.find(f => f.name === 'CONFLICT_PARENT')?.id;
        expect(conflictParentId).toBeDefined();
        const bookmarksInParent = db.bookmarks.filter(b => b.folder_id === conflictParentId);
        expect(bookmarksInParent).toHaveLength(1);
    });

    it('enforces depth limit on import endpoint and rejects with 400', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialFolders = db.folders.length;

        // 构建 13 层深度文件夹
        let deepHtml = '<!DOCTYPE NETSCAPE-Bookmark-file-1>';
        for (let i = 0; i < 13; i++) {
            deepHtml += `<DL><p><DT><H3>Level ${i}</H3>`;
        }
        deepHtml += '<DT><A HREF="https://nested.com">Nested</A>';
        for (let i = 0; i < 13; i++) {
            deepHtml += '</DL><p>';
        }

        const response = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: deepHtml,
        }), env);

        expect(response.status).toBe(400);
        const result = await response.json() as any;
        expect(result).toMatchObject({
            error: 'DEPTH_LIMIT_EXCEEDED',
            message: '导入文件层级过深，最大允许嵌套 12 层',
        });
        expect(db.folders.length).toBe(initialFolders);
    });

    it('fails closed when the import folder snapshot cannot be loaded', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialFolders = db.folders.length;
        db.snapshotShouldFail = true;

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>SnapshotFailFolder</H3>
</DL><p>`;

        const response = await app.fetch(new Request('https://example.com/api/import', {
            method: 'POST',
            headers: {
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: importHtml,
        }), env);

        // 无法安全去重时整体失败，绝不产生重复数据。
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ error: 'SERVER_ERROR' });
        expect(db.folders.length).toBe(initialFolders);
    });

    it('skips bookmark import when database deduplication query fails', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialBookmarks = db.bookmarks.length;

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><A HREF="https://example.org/query-fail-bookmark">Query Fail Bookmark</A>
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
            imported: { folders: 0, bookmarks: 0 },
            skipped: { folders: 0, bookmarks: 0 },
        });

        expect(result.failures).toHaveLength(1);
        expect(result.failures[0]).toMatchObject({
            type: 'bookmark',
            name: 'Query Fail Bookmark',
            error: '数据库检索失败',
        });

        expect(db.bookmarks.length).toBe(initialBookmarks);
    });

    it('does not skip import deduplication for items in the trash bin (is_deleted = 1)', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        const now = new Date().toISOString();
        db.folders.push({
            id: 100,
            name: 'TrashedFolder',
            parent_id: null,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        });

        db.bookmarks.push({
            id: 200,
            title: 'TrashedBookmark',
            url: 'https://example.org/trashed-url',
            description: null,
            folder_id: null,
            sort_order: 0,
            is_deleted: 1,
            created_at: now,
            updated_at: now,
        });

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>TrashedFolder</H3>
    <DL><p>
        <DT><A HREF="https://example.org/trashed-url">New Active Bookmark</A>
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

        const activeFolder = db.folders.find((f) => f.name === 'TrashedFolder' && f.is_deleted === 0);
        const activeBookmark = db.bookmarks.find((b) => b.url === 'https://example.org/trashed-url' && b.is_deleted === 0);

        expect(activeFolder).toBeTruthy();
        expect(activeBookmark).toBeTruthy();
        expect(activeBookmark?.folder_id).toBe(activeFolder?.id);
    });

    it('automatically applies D1 migration stamps on first-visit auto-initialization', async () => {
        const db = env.DB as unknown as MockD1Database;
        expect(db.migrations).toHaveLength(0);

        const response = await app.fetch(new Request('https://example.com/'), env);
        expect(response.status).toBe(200);

        expect(db.migrations).toHaveLength(12);
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

    it('ensures INIT_SQL trigger definitions are syntactically complete and not empty', () => {
        for (const sql of INIT_SQL) {
            const normalized = sql.replace(/\s+/g, ' ').trim();
            const upper = normalized.toUpperCase();
            
            if (upper.includes('CREATE TRIGGER')) {
                expect(upper).toContain(' BEGIN ');
                expect(upper.endsWith(' END')).toBe(true);
                
                const hasAction = upper.includes('RAISE(') || upper.includes('UPDATE ');
                expect(hasAction).toBe(true);
            }
        }
    });

    it('serializes concurrent first-request database initialization', async () => {
        resetInitState();
        const db = env.DB as unknown as MockD1Database;
        const originalExecuteFirst = db.executeFirst.bind(db);
        let releaseInitialProbe: (() => void) | undefined;
        let initialProbeStarted = false;
        db.executeFirst = async (sql: string, bindings: unknown[]) => {
            if (!initialProbeStarted && normalizeSql(sql).startsWith('SELECT 1 FROM settings LIMIT 1') && !db.initialized) {
                initialProbeStarted = true;
                await new Promise<void>((resolve) => {
                    releaseInitialProbe = resolve;
                });
            }
            return originalExecuteFirst(sql, bindings);
        };

        const firstRequest = app.fetch(new Request('https://example.com/'), env);
        for (let attempt = 0; attempt < 10 && !initialProbeStarted; attempt += 1) {
            await Promise.resolve();
        }
        expect(initialProbeStarted).toBe(true);

        const secondRequest = app.fetch(new Request('https://example.com/'), env);
        await Promise.resolve();
        expect(db.settingsProbeCount).toBe(0);
        releaseInitialProbe?.();

        const [firstResponse, secondResponse] = await Promise.all([firstRequest, secondRequest]);
        expect(firstResponse.status).toBe(200);
        expect(secondResponse.status).toBe(200);
        expect(db.settingsProbeCount).toBe(1);
    });

    it('throws an error when auto-initialization fails during app boot', async () => {
        resetInitState();
        const badEnv = createEnv();
        (badEnv.DB as any).executeRun = async () => {
            throw new Error('Simulated D1 initialization failure');
        };

        const response = await app.fetch(new Request('https://example.com/'), badEnv);
        expect(response.status).toBe(500);

        const body = await response.json() as any;
        expect(body).toMatchObject({
            error: 'Internal Server Error',
        });
    });

    it('fails closed when a session secret cannot be persisted or recovered from D1', async () => {
        resetInitState();
        const secretlessEnv = {
            ...createEnv(),
            SECRET_KEY: '',
        };
        const db = secretlessEnv.DB as unknown as MockD1Database;
        const originalExecuteRun = db.executeRun.bind(db);
        db.executeRun = async (sql: string, bindings: unknown[]) => {
            if (normalizeSql(sql).startsWith('INSERT INTO settings (key, value) VALUES (?, ?)')
                && bindings[0] === 'secret_key') {
                throw new Error('Simulated secret-key write failure');
            }
            return originalExecuteRun(sql, bindings);
        };

        const response = await app.fetch(new Request('https://example.com/'), secretlessEnv);
        expect(response.status).toBe(500);
        expect(db.settings.has('secret_key')).toBe(false);
    });

    it('app client code calls loadTrash on checkAuth when currentView is trash', async () => {
        const originalWindow = (global as any).window;
        const originalDocument = (global as any).document;
        const originalFetch = (global as any).fetch;

        const mockWindow = {
            translations: {
                toast: { processing: 'Processing...' }
            },
            localStorage: {
                getItem: (key: string) => (key === 'currentView' ? 'trash' : null),
                setItem: () => {}
            },
            dispatchEvent: () => {}
        };

        const mockDocument = {
            body: {
                dataset: {
                    translations: encodeURIComponent(JSON.stringify(mockWindow.translations))
                }
            },
            documentElement: {
                classList: {
                    add: () => {},
                    remove: () => {}
                }
            }
        };

        let dataFetched = false;
        let trashFetched = false;

        const mockFetch = async (url: string) => {
            if (url === '/api/data') {
                dataFetched = true;
                return {
                    status: 200,
                    ok: true,
                    json: async () => ({ folders: [], bookmarks: [] })
                };
            }
            if (url === '/api/trash') {
                trashFetched = true;
                return {
                    status: 200,
                    ok: true,
                    json: async () => ({ folders: [], bookmarks: [] })
                };
            }
            return { status: 404 };
        };

        (global as any).window = mockWindow;
        (global as any).document = mockDocument;
        (global as any).fetch = mockFetch;
        (global as any).localStorage = mockWindow.localStorage;

        try {
            const initFn = new Function(appAssetSource + '; return window.app();');
            const clientApp = initFn();
            
            clientApp.currentView = 'trash';
            await clientApp.checkAuth();

            expect(dataFetched).toBe(true);
            expect(trashFetched).toBe(true);
        } finally {
            (global as any).window = originalWindow;
            (global as any).document = originalDocument;
            (global as any).fetch = originalFetch;
            delete (global as any).localStorage;
        }
    });

    it('keeps an existing web client session and trash data on transient or malformed responses', async () => {
        const originalWindow = (global as any).window;
        const originalDocument = (global as any).document;
        const originalFetch = (global as any).fetch;
        const mockWindow = {
            translations: { toast: { processing: 'Processing...' } },
            localStorage: { getItem: () => null, setItem: () => {} },
            dispatchEvent: () => {},
        };
        const mockDocument = {
            body: { dataset: { translations: encodeURIComponent(JSON.stringify(mockWindow.translations)) } },
            documentElement: { classList: { add: () => {}, remove: () => {} } },
        };
        let responseMode: 'success' | 'gateway' | 'invalid-trash' = 'success';
        const mockFetch = async (url: string) => {
            if (url === '/api/data') {
                if (responseMode === 'gateway') {
                    return { status: 502, ok: false, text: async () => 'Bad Gateway' };
                }
                return { status: 200, ok: true, json: async () => ({ folders: [], bookmarks: [] }) };
            }
            if (url === '/api/trash') {
                if (responseMode === 'invalid-trash') {
                    return { status: 200, ok: true, json: async () => ({ error: 'proxy response' }) };
                }
                return { status: 200, ok: true, json: async () => ({ folders: [], bookmarks: [] }) };
            }
            return { status: 404, ok: false, text: async () => '' };
        };

        (global as any).window = mockWindow;
        (global as any).document = mockDocument;
        (global as any).fetch = mockFetch;
        (global as any).localStorage = mockWindow.localStorage;
        try {
            const initFn = new Function(appAssetSource + '; return window.app();');
            const clientApp = initFn();
            await clientApp.checkAuth();
            expect(clientApp.loggedIn).toBe(true);

            responseMode = 'gateway';
            await clientApp.checkAuth();
            expect(clientApp.loggedIn).toBe(true);

            clientApp.trashFolders = [{ id: 1 }];
            clientApp.trashBookmarks = [{ id: 2 }];
            responseMode = 'invalid-trash';
            await expect(clientApp.loadTrash()).rejects.toThrow('Invalid trash response');
            expect(clientApp.trashFolders).toEqual([{ id: 1 }]);
            expect(clientApp.trashBookmarks).toEqual([{ id: 2 }]);
        } finally {
            (global as any).window = originalWindow;
            (global as any).document = originalDocument;
            (global as any).fetch = originalFetch;
            delete (global as any).localStorage;
        }
    });

    it('ignores stale client data responses and stale 401 errors after a newer load succeeds', async () => {
        const originalWindow = (global as any).window;
        const originalDocument = (global as any).document;
        const originalFetch = (global as any).fetch;
        const mockWindow = {
            translations: { toast: { processing: 'Processing...' } },
            localStorage: { getItem: () => null, setItem: () => {} },
            dispatchEvent: () => {},
        };
        const mockDocument = {
            body: { dataset: { translations: encodeURIComponent(JSON.stringify(mockWindow.translations)) } },
            documentElement: { classList: { add: () => {}, remove: () => {} } },
        };
        const pendingResponses: Array<(response: any) => void> = [];
        (global as any).window = mockWindow;
        (global as any).document = mockDocument;
        (global as any).localStorage = mockWindow.localStorage;
        (global as any).fetch = () => new Promise((resolve) => pendingResponses.push(resolve));
        try {
            const initFn = new Function(appAssetSource + '; return window.app();');
            const clientApp = initFn();
            clientApp.loggedIn = true;
            const staleLoad = clientApp.loadData();
            const freshLoad = clientApp.loadData();
            expect(pendingResponses).toHaveLength(2);

            pendingResponses[1]({
                status: 200,
                ok: true,
                json: async () => ({ folders: [{ id: 2, parent_id: null }], bookmarks: [] }),
            });
            await freshLoad;
            expect(clientApp.folders).toEqual([{ id: 2, parent_id: null }]);

            pendingResponses[0]({ status: 401, ok: false, text: async () => '' });
            await expect(staleLoad).resolves.toBe(false);
            expect(clientApp.loggedIn).toBe(true);
            expect(clientApp.folders).toEqual([{ id: 2, parent_id: null }]);
        } finally {
            (global as any).window = originalWindow;
            (global as any).document = originalDocument;
            (global as any).fetch = originalFetch;
            delete (global as any).localStorage;
        }
    });

    it('does not let a stale checkAuth 401 override a newer successful auth check', async () => {
        const originalWindow = (global as any).window;
        const originalDocument = (global as any).document;
        const originalFetch = (global as any).fetch;
        const mockWindow = {
            translations: { toast: { processing: 'Processing...' } },
            localStorage: { getItem: () => null, setItem: () => {} },
            dispatchEvent: () => {},
        };
        const mockDocument = {
            body: { dataset: { translations: encodeURIComponent(JSON.stringify(mockWindow.translations)) } },
            documentElement: { classList: { add: () => {}, remove: () => {} } },
        };
        const pendingResponses: Array<(response: any) => void> = [];
        (global as any).window = mockWindow;
        (global as any).document = mockDocument;
        (global as any).localStorage = mockWindow.localStorage;
        (global as any).fetch = () => new Promise((resolve) => pendingResponses.push(resolve));
        try {
            const initFn = new Function(appAssetSource + '; return window.app();');
            const clientApp = initFn();
            clientApp.loggedIn = true;
            const staleCheck = clientApp.checkAuth();
            const freshCheck = clientApp.checkAuth();
            expect(pendingResponses).toHaveLength(2);

            pendingResponses[1]({
                status: 200,
                ok: true,
                json: async () => ({ folders: [{ id: 3, parent_id: null }], bookmarks: [] }),
            });
            await freshCheck;
            expect(clientApp.loggedIn).toBe(true);

            pendingResponses[0]({ status: 401, ok: false, text: async () => '' });
            await staleCheck;
            expect(clientApp.loggedIn).toBe(true);
            expect(clientApp.folders).toEqual([{ id: 3, parent_id: null }]);
        } finally {
            (global as any).window = originalWindow;
            (global as any).document = originalDocument;
            (global as any).fetch = originalFetch;
            delete (global as any).localStorage;
        }
    });

    it('clears local state while reporting unconfirmed logout and failed confirmation callbacks', async () => {
        const originalWindow = (global as any).window;
        const originalDocument = (global as any).document;
        const originalFetch = (global as any).fetch;
        const mockWindow = {
            translations: { toast: { processing: 'Processing...', operationFailed: 'Operation failed' } },
            localStorage: { getItem: () => null, setItem: () => {} },
            dispatchEvent: () => {},
        };
        const mockDocument = {
            body: { dataset: { translations: encodeURIComponent(JSON.stringify(mockWindow.translations)) } },
            documentElement: { classList: { add: () => {}, remove: () => {} } },
        };
        (global as any).window = mockWindow;
        (global as any).document = mockDocument;
        (global as any).fetch = async () => ({ status: 503, ok: false, text: async () => 'Service unavailable' });
        (global as any).localStorage = mockWindow.localStorage;
        try {
            const initFn = new Function(appAssetSource + '; return window.app();');
            const clientApp = initFn();
            clientApp.loggedIn = true;
            clientApp.folders = [{ id: 1 }];
            clientApp.bookmarks = [{ id: 2 }];
            await clientApp.logout();
            expect(clientApp.loggedIn).toBe(false);
            expect(clientApp.folders).toEqual([]);
            expect(clientApp.bookmarks).toEqual([]);
            expect(clientApp.toast).toMatchObject({ show: true, type: 'error' });
            expect(clientApp.toast.message).toContain('Service unavailable');

            clientApp.confirmAction('Delete item', async () => { throw new Error('Delete request failed'); });
            await clientApp.executeConfirm();
            expect(clientApp.showConfirmModal).toBe(false);
            expect(clientApp.confirmCallback).toBeNull();
            expect(clientApp.toast.message).toContain('Delete request failed');
        } finally {
            (global as any).window = originalWindow;
            (global as any).document = originalDocument;
            (global as any).fetch = originalFetch;
            delete (global as any).localStorage;
        }
    });

    it('immediately clears the web client session after credentials are updated', async () => {
        const originalWindow = (global as any).window;
        const originalDocument = (global as any).document;
        const mockWindow = {
            translations: {
                toast: {
                    processing: 'Processing...',
                    settingsUpdated: 'Settings updated',
                    updateFailed: 'Update failed',
                },
            },
            localStorage: { getItem: () => null, setItem: () => {} },
            dispatchEvent: () => {},
        };
        const mockDocument = {
            body: { dataset: { translations: encodeURIComponent(JSON.stringify(mockWindow.translations)) } },
            documentElement: { classList: { add: () => {}, remove: () => {} } },
        };
        (global as any).window = mockWindow;
        (global as any).document = mockDocument;
        (global as any).localStorage = mockWindow.localStorage;

        try {
            const initFn = new Function(appAssetSource + '; return window.app();');
            const clientApp = initFn();
            clientApp.loggedIn = true;
            clientApp.settingsForm = { username: 'rotated-admin', password: 'rotated-password' };
            clientApp.withLoading = async (fn: () => Promise<void>) => fn();
            clientApp.submitJson = async () => ({ ok: true });

            await clientApp.updateSettings();

            expect(clientApp.loggedIn).toBe(false);
            expect(clientApp.settingsForm).toEqual({ username: '', password: '' });
            expect(clientApp.loginForm).toEqual({ username: 'rotated-admin', password: '' });
        } finally {
            (global as any).window = originalWindow;
            (global as any).document = originalDocument;
            delete (global as any).localStorage;
        }
    });

    it('memoizes folder counts and safely terminates legacy cyclic folder references', () => {
        const originalWindow = (global as any).window;
        const originalDocument = (global as any).document;
        const mockWindow = {
            translations: { toast: { processing: 'Processing...' } },
            localStorage: { getItem: () => null, setItem: () => {} },
            dispatchEvent: () => {},
        };
        const mockDocument = {
            body: { dataset: { translations: encodeURIComponent(JSON.stringify(mockWindow.translations)) } },
            documentElement: { classList: { add: () => {}, remove: () => {} } },
        };
        (global as any).window = mockWindow;
        (global as any).document = mockDocument;
        (global as any).localStorage = mockWindow.localStorage;

        try {
            const initFn = new Function(appAssetSource + '; return window.app();');
            const clientApp = initFn();
            clientApp.folders = [
                { id: 1, parent_id: null },
                { id: 2, parent_id: 1 },
                { id: 3, parent_id: 2 },
            ];
            clientApp.bookmarks = [
                { id: 1, folder_id: 1, is_deleted: 0 },
                { id: 2, folder_id: 2, is_deleted: 0 },
                { id: 3, folder_id: 3, is_deleted: 0 },
            ];
            clientApp.calculateFolderCounts();
            expect(clientApp.folderCounts).toMatchObject({ 1: 3, 2: 2, 3: 1 });

            clientApp.folders = [
                { id: 10, parent_id: 11 },
                { id: 11, parent_id: 10 },
            ];
            clientApp.bookmarks = [
                { id: 10, folder_id: 10, is_deleted: 0 },
                { id: 11, folder_id: 11, is_deleted: 0 },
            ];
            expect(() => clientApp.calculateFolderCounts()).not.toThrow();
        } finally {
            (global as any).window = originalWindow;
            (global as any).document = originalDocument;
            delete (global as any).localStorage;
        }
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

    it('exports folders and bookmarks strictly sorted by sort_order', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;

        // 制造乱序的 sort_order，并写入 mock db
        const now = new Date().toISOString();
        db.folders.push({
            id: 10,
            name: 'Second Folder',
            parent_id: null,
            sort_order: 2,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });
        db.folders.push({
            id: 11,
            name: 'First Folder',
            parent_id: null,
            sort_order: 1,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });

        db.bookmarks.push({
            id: 20,
            title: 'Second Bookmark',
            url: 'https://b.com',
            description: null,
            folder_id: null,
            sort_order: 2,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });
        db.bookmarks.push({
            id: 21,
            title: 'First Bookmark',
            url: 'https://a.com',
            description: null,
            folder_id: null,
            sort_order: 1,
            is_deleted: 0,
            created_at: now,
            updated_at: now,
        });

        const response = await app.fetch(new Request('https://example.com/api/export', {
            headers: {
                Cookie: cookie,
            },
        }), env);

        expect(response.status).toBe(200);
        const html = await response.text();

        // 验证 HTML 中，First Folder/First Bookmark 先于 Second Folder/Second Bookmark 出现
        const firstFolderIndex = html.indexOf('First Folder');
        const secondFolderIndex = html.indexOf('Second Folder');
        const firstBookmarkIndex = html.indexOf('First Bookmark');
        const secondBookmarkIndex = html.indexOf('Second Bookmark');

        expect(firstFolderIndex).toBeGreaterThan(0);
        expect(secondFolderIndex).toBeGreaterThan(0);
        expect(firstFolderIndex).toBeLessThan(secondFolderIndex);

        expect(firstBookmarkIndex).toBeGreaterThan(0);
        expect(secondBookmarkIndex).toBeGreaterThan(0);
        expect(firstBookmarkIndex).toBeLessThan(secondBookmarkIndex);
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

    it('gracefully handles missing password in settings, resets defaultAdminChecked, and allows re-initialization', async () => {
        // 首先确保初始登录过了，即 Worker 内 defaultAdminChecked = true
        const cookie = await login(env);
        expect(cookie).toBeTruthy();

        const db = env.DB as unknown as MockD1Database;
        // 模拟外部删除密码以求重置
        db.settings.delete('password');

        // 使用错误的密码登录，应该被拒绝返回 401
        const wrongResponse = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: 'wrongpassword',
            }),
        }), env);
        expect(wrongResponse.status).toBe(401);

        // 验证数据库里密码确实仍未生成
        expect(db.settings.get('password')).toBeUndefined();

        // 使用管理员初始密码发起登录请求，预期应当直接登录成功 (200)
        const loginResponse = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), env);

        expect(loginResponse.status).toBe(200);
        const newCookie = loginResponse.headers.get('set-cookie');
        expect(newCookie).toBeTruthy();

        // 验证此时密码已经重新被成功写入数据库中
        expect(db.settings.get('password')).toBeTruthy();
        expect(db.settings.get('password')?.startsWith('v3:')).toBe(true);
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

    it('rejects malformed idempotency keys before processing a bookmark create', async () => {
        const cookie = await login(env);
        const response = await app.fetch(new Request('https://example.com/api/bookmarks', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
                Cookie: cookie,
                'Idempotency-Key': 'short',
            },
            body: JSON.stringify({
                title: 'Invalid key',
                url: 'https://example.com/invalid-key',
                folder_id: null,
            }),
        }), env);

        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: 'IDEMPOTENCY_KEY_INVALID' });
    });

    it('uses bounded secure defaults for malformed session and rate-limit configuration', () => {
        const config = getConfig({
            ...env,
            SESSION_MAX_AGE: 'not-a-number',
            RATE_LIMIT_MAX: '-1',
            RATE_LIMIT_WINDOW: '0',
            RATE_LIMIT_LOGIN_MAX: '101',
            RATE_LIMIT_LOGIN_WINDOW: '999999',
        });

        expect(config).toMatchObject({
            sessionMaxAge: 604800,
            rateLimitMax: 100,
            rateLimitWindow: 60,
            rateLimitLoginMax: 5,
            rateLimitLoginWindow: 60,
        });
    });

    it('fails closed for login when rate limiting storage is unavailable', async () => {
        const noRateLimitEnv = {
            ...createEnv(),
            RATE_LIMIT_KV: undefined,
        };
        resetInitState();

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), noRateLimitEnv);

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
            error: 'RATE_LIMIT_UNAVAILABLE',
        });
    });

    it('fails closed for login when rate limiting storage throws at runtime', async () => {
        const failingRateLimitEnv = {
            ...createEnv(),
            RATE_LIMIT_KV: new FailingKVNamespace() as unknown as KVNamespace,
        };
        resetInitState();

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), failingRateLimitEnv);

        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({
            error: 'RATE_LIMIT_UNAVAILABLE',
        });
    });

    it('keeps login rate limiting working when the remaining KV window is shorter than the minimum TTL', async () => {
        const strictKv = new StrictTtlKVNamespace();
        const ttlEnv = {
            ...createEnv(),
            RATE_LIMIT_KV: strictKv as unknown as KVNamespace,
        };
        resetInitState();

        // Simulate an in-flight window whose remaining lifetime is below the
        // 60-second minimum TTL enforced by real Workers KV.
        await strictKv.seedRaw('ratelimit:login:unknown', JSON.stringify({
            count: 1,
            resetTime: Date.now() + 30_000,
        }));

        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), ttlEnv);

        expect(response.status).toBe(200);
        expect(strictKv.puts.length).toBeGreaterThan(0);
        for (const put of strictKv.puts) {
            expect(put.ttl === undefined || put.ttl >= 60).toBe(true);
        }
    });

    it('clamps rate limit windows to the KV minimum TTL', () => {
        const config = getConfig({
            RATE_LIMIT_WINDOW: '30',
            RATE_LIMIT_LOGIN_WINDOW: '10',
        } as Parameters<typeof getConfig>[0]);
        expect(config.rateLimitWindow).toBe(60);
        expect(config.rateLimitLoginWindow).toBe(60);
    });

    it('validates bookmark reorder with a bounded number of read queries', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const ids: number[] = [];
        const now = new Date().toISOString();
        for (let i = 0; i < 95; i++) {
            const id = 1000 + i;
            ids.push(id);
            db.bookmarks.push({
                id,
                title: `Bookmark ${i}`,
                url: `https://example.com/reorder-${i}`,
                description: null,
                folder_id: null,
                sort_order: i,
                is_deleted: 0,
                created_at: now,
                updated_at: now,
            });
        }

        const readsBefore = db.readQueryCount;
        const response = await app.fetch(new Request('https://example.com/api/bookmarks/reorder', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
            },
            body: JSON.stringify({ orderedIds: [...ids].reverse() }),
        }), env);

        expect(response.status).toBe(200);
        const readsUsed = db.readQueryCount - readsBefore;
        // Set-based validation must stay constant regardless of item count.
        expect(readsUsed).toBeLessThanOrEqual(8);
    });

    it('validates folder reorder with a bounded number of read queries', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const ids: number[] = [];
        const now = new Date().toISOString();
        for (let i = 0; i < 95; i++) {
            const id = 2000 + i;
            ids.push(id);
            db.folders.push({
                id,
                name: `Folder ${i}`,
                parent_id: null,
                sort_order: i,
                is_deleted: 0,
                created_at: now,
                updated_at: now,
            });
        }

        const readsBefore = db.readQueryCount;
        const response = await app.fetch(new Request('https://example.com/api/folders/reorder', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
            },
            body: JSON.stringify({ orderedIds: [...ids].reverse() }),
        }), env);

        expect(response.status).toBe(200);
        const readsUsed = db.readQueryCount - readsBefore;
        expect(readsUsed).toBeLessThanOrEqual(8);
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

    it('derives new password hashes within the free-plan CPU budget', async () => {
        await login(env);
        const db = env.DB as unknown as MockD1Database;
        const stored = db.settings.get('password') ?? '';
        const parsed = parsePasswordHashV3(stored);
        expect(parsed).not.toBeNull();
        // Production workerd rejects PBKDF2 iteration counts above 100k
        // (cloudflare/workerd#1346), and the Workers Free plan enforces a
        // 10 ms CPU budget that even 100k iterations would exceed.
        expect(parsed!.iterations).toBe(25_000);
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
