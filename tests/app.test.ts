import { beforeEach, describe, expect, it } from 'vitest';
import type { D1Database, KVNamespace } from '@cloudflare/workers-types';
import app from '../src/index';
import { resetInitState } from '../src/middleware/init';
import { appAssetSource } from '../src/templates/appAsset';
import { appCssAssetSource } from '../src/templates/appCssAsset';
import { vendorAssetSource } from '../src/templates/vendorAsset';

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
    initialized = false;
    private folderId = 1;
    private bookmarkId = 1;

    prepare(sql: string) {
        return new MockPreparedStatement(this, sql);
    }

    async batch(statements: MockPreparedStatement[]) {
        const results = [];
        for (const statement of statements) {
            results.push(await statement.run());
        }
        return results;
    }

    async executeFirst<T>(sql: string, bindings: unknown[]) {
        const normalized = normalizeSql(sql);

        if (!this.initialized) {
            throw new Error('no such table: settings (D1 simulated)');
        }

        if (normalized.startsWith('SELECT 1 FROM settings LIMIT 1')) {
            return this.settings.size > 0 ? ({ 1: 1 } as T) : null;
        }

        if (normalized.startsWith('SELECT value FROM settings WHERE key = ?')) {
            const key = String(bindings[0]);
            const value = this.settings.get(key);
            return value === undefined ? null : ({ value } as T);
        }

        if (normalized.startsWith('SELECT id FROM folders WHERE name = ? AND parent_id IS ? AND is_deleted = 0')) {
            const name = String(bindings[0]);
            const parentId = toNullableNumber(bindings[1]);
            if (name === 'QUERY_FAIL_FOLDER') {
                throw new Error('Simulated D1 folder query failure');
            }
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

        if (!this.initialized) {
            throw new Error('no such table: settings (D1 simulated)');
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

        if (normalized.startsWith('SELECT * FROM folders WHERE is_deleted = 0')) {
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

        if (normalized.includes('WITH RECURSIVE sub(id) AS')) {
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

        if (normalized.startsWith('CREATE TABLE')) {
            this.initialized = true;
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('CREATE')) {
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('INSERT OR IGNORE INTO d1_migrations')) {
            this.migrations.push(
                '002_add_indexes.sql',
                '003_upgrade_schema.sql',
                '004_enforce_trash_consistency.sql',
                '005_add_bookmark_sort_index.sql'
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
            if (!this.settings.has(key)) {
                this.settings.set(key, String(bindings[1]));
            }
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('UPDATE settings SET value = ? WHERE key = ?')) {
            this.settings.set(String(bindings[1]), String(bindings[0]));
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('INSERT INTO folders (name, parent_id) VALUES (?, ?)')) {
            const folderName = String(bindings[0]);
            if (folderName === 'FAIL_FOLDER') {
                throw new Error('Simulated D1 DB write failure');
            }
            const id = this.folderId++;
            const now = new Date().toISOString();
            this.folders.push({
                id,
                name: folderName,
                parent_id: toNullableNumber(bindings[1]),
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

        if (normalized.startsWith('UPDATE folders SET is_deleted = ? WHERE id = ?')) {
            const folder = this.folders.find((item) => item.id === Number(bindings[1]));
            if (folder) {
                folder.is_deleted = Number(bindings[0]);
            }
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('UPDATE folders SET sort_order = ? WHERE id = ?')) {
            const folder = this.folders.find((item) => item.id === Number(bindings[1]));
            if (folder) {
                folder.sort_order = Number(bindings[0]);
            }
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('UPDATE folders SET name = ?, parent_id = ? WHERE id = ?')) {
            const folder = this.folders.find((item) => item.id === Number(bindings[2]));
            if (folder) {
                folder.name = String(bindings[0]);
                folder.parent_id = toNullableNumber(bindings[1]);
            }
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('UPDATE folders SET name = ? WHERE id = ?')) {
            const folder = this.folders.find((item) => item.id === Number(bindings[1]));
            if (folder) {
                folder.name = String(bindings[0]);
            }
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('UPDATE folders SET parent_id = ? WHERE id = ?')) {
            const folder = this.folders.find((item) => item.id === Number(bindings[1]));
            if (folder) {
                folder.parent_id = toNullableNumber(bindings[0]);
            }
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('UPDATE bookmarks SET is_deleted = ? WHERE folder_id = ?')) {
            const isDeleted = Number(bindings[0]);
            const folderId = Number(bindings[1]);
            this.bookmarks.forEach((item) => {
                if (item.folder_id === folderId) {
                    item.is_deleted = isDeleted;
                }
            });
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('UPDATE bookmarks SET is_deleted = 1 WHERE id = ?')) {
            const bookmark = this.bookmarks.find((item) => item.id === Number(bindings[0]));
            if (bookmark) {
                bookmark.is_deleted = 1;
            }
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('UPDATE bookmarks SET is_deleted = 0 WHERE id = ?')) {
            const bookmark = this.bookmarks.find((item) => item.id === Number(bindings[0]));
            if (bookmark) {
                bookmark.is_deleted = 0;
            }
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('UPDATE bookmarks SET sort_order = ? WHERE id = ?')) {
            const bookmark = this.bookmarks.find((item) => item.id === Number(bindings[1]));
            if (bookmark) {
                bookmark.sort_order = Number(bindings[0]);
            }
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('UPDATE bookmarks SET')) {
            const id = Number(bindings[bindings.length - 1]);
            const bookmark = this.bookmarks.find((item) => item.id === id);
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
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('DELETE FROM folders WHERE is_deleted = 1')) {
            this.folders = this.folders.filter((item) => item.is_deleted !== 1);
            return { success: true, meta: {} };
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

        if (normalized.startsWith('DELETE FROM bookmarks WHERE folder_id = ?')) {
            const folderId = Number(bindings[0]);
            this.bookmarks = this.bookmarks.filter((item) => item.folder_id !== folderId);
            return { success: true, meta: {} };
        }

        if (normalized.startsWith('DELETE FROM folders WHERE id = ?')) {
            const folderId = Number(bindings[0]);
            this.folders = this.folders.filter((item) => item.id !== folderId);
            return { success: true, meta: {} };
        }

        throw new Error(`Unsupported run() SQL: ${normalized}`);
    }

    private collectFolderSubtreeIds(folderId: number, deletedState?: number) {
        const result: number[] = [];
        const visit = (id: number) => {
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
        INITIAL_ADMIN_PASSWORD: '123456',
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
            password: '123456',
        }),
    }), env);

    expect(response.status).toBe(200);
        const cookie = response.headers.get('set-cookie');
        expect(cookie).toBeTruthy();
        const db = env.DB as unknown as MockD1Database;
        expect(db.settings.get('password')?.startsWith('v2:')).toBe(true);
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
                password: '123456',
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
                password: '123456',
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
                password: '123456',
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
    });

    it('generated app asset is syntactically valid and fully expanded', () => {
        expect(appAssetSource).not.toContain('__APP_FRAGMENTS_PLACEHOLDER__');
        expect(() => new Function(appAssetSource)).not.toThrow();
    });

    it('generated css asset is fully expanded', () => {
        expect(appCssAssetSource.length).toBeGreaterThan(0);
        expect(appCssAssetSource).not.toContain('@tailwind');
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

    it('migrates the legacy default password on init so current default credentials work', async () => {
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
                password: '123456',
            }),
        }), env);

        expect(response.status).toBe(200);
        expect(db.settings.get('password')).not.toBe('5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5');
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

    it('skips folder import and nested items when database deduplication query fails', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const initialFolders = db.folders.length;

        const importHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>QUERY_FAIL_FOLDER</H3>
    <DL><p>
        <DT><H3>SubFolder</H3>
        <DL><p></DL><p>
        <DT><A HREF="https://example.org/sub">Sub Bookmark</A>
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
            skipped: { folders: 0, bookmarks: 0 },
        });

        expect(result.failures).toHaveLength(3);
        expect(result.failures[0]).toMatchObject({
            type: 'folder',
            name: 'QUERY_FAIL_FOLDER',
            error: 'Simulated D1 folder query failure',
        });
        expect(result.failures[1]).toMatchObject({
            type: 'folder',
            name: 'SubFolder',
            error: '父文件夹创建失败，级联跳过',
        });
        expect(result.failures[2]).toMatchObject({
            type: 'bookmark',
            name: 'Sub Bookmark',
            error: '父文件夹创建失败，级联跳过',
        });

        // 验证没有任何数据写入数据库
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
            error: 'Simulated D1 bookmark query failure',
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

        expect(db.migrations).toHaveLength(4);
        expect(db.migrations).toContain('002_add_indexes.sql');
        expect(db.migrations).toContain('003_upgrade_schema.sql');
        expect(db.migrations).toContain('004_enforce_trash_consistency.sql');
        expect(db.migrations).toContain('005_add_bookmark_sort_index.sql');
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
