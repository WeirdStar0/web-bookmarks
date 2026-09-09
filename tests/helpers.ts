import { expect } from 'vitest';
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import app from '../src/index';
import { TEST_INITIAL_ADMIN_PASSWORD } from './constants';

export { TEST_INITIAL_ADMIN_PASSWORD };

export type FolderRow = {
    id: number;
    name: string;
    parent_id: number | null;
    sort_order: number;
    is_deleted: number;
    created_at: string;
    updated_at: string;
};

export type BookmarkRow = {
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

export function normalizeSql(sql: string) {
    return sql.replace(/\s+/g, ' ').trim();
}

export function toNullableNumber(value: unknown) {
    if (value === null || value === undefined) {
        return null;
    }
    return Number(value);
}


export class MockPreparedStatement {
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

export class MockD1Database {
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
                '012_add_trash_and_hierarchy_indexes.sql',
                '013_unique_active_folder_sibling_name.sql'
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

export class MockKVNamespace {
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

export class FailingKVNamespace {
    async get() {
        throw new Error('Simulated KV read failure');
    }

    async put() {
        throw new Error('Simulated KV write failure');
    }
}

// Mirrors the real Workers KV constraint that expirationTtl must be at least
// 60 seconds, which the plain in-memory mock does not enforce.
export class StrictTtlKVNamespace {
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

export function createEnv() {
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

export function createEnvWithoutExtensionAllowlist() {
    return {
        ...createEnv(),
        ALLOWED_EXTENSION_ORIGINS: '',
    };
}

export type TestEnv = ReturnType<typeof createEnv>;

export async function login(env: TestEnv) {
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
    expect(/^v[34]:/.test(db.settings.get('password') ?? '')).toBe(true);
    return cookie as string;
}
