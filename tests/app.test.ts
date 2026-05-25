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

type SettingsRow = {
    key: string;
    value: string;
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

        if (normalized.startsWith('SELECT 1 FROM settings LIMIT 1')) {
            return this.settings.size > 0 ? ({ 1: 1 } as T) : null;
        }

        if (normalized.startsWith('SELECT value FROM settings WHERE key = ?')) {
            const key = String(bindings[0]);
            const value = this.settings.get(key);
            return value === undefined ? null : ({ value } as T);
        }

        if (normalized.startsWith('SELECT id FROM folders WHERE name = ? AND parent_id IS ?')) {
            const name = String(bindings[0]);
            const parentId = toNullableNumber(bindings[1]);
            const folder = this.folders.find((item) => item.name === name && item.parent_id === parentId) ?? null;
            return folder ? ({ id: folder.id } as T) : null;
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

        if (normalized.startsWith('CREATE TABLE') || normalized.startsWith('CREATE INDEX')) {
            return { success: true, meta: {} };
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
            const id = this.folderId++;
            const now = new Date().toISOString();
            this.folders.push({
                id,
                name: String(bindings[0]),
                parent_id: toNullableNumber(bindings[1]),
                sort_order: 0,
                is_deleted: 0,
                created_at: now,
                updated_at: now,
            });
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
            const exists = this.bookmarks.some((item) => item.url === String(bindings[3]) && item.folder_id === toNullableNumber(bindings[4]));

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
        ALLOWED_EXTENSION_ORIGINS: 'chrome-extension://allowed-extension-id',
        SESSION_MAX_AGE: '3600',
        RATE_LIMIT_MAX: '100',
        RATE_LIMIT_WINDOW: '60',
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

    it('keeps extension requests working by default when no allowlist is configured', async () => {
        const defaultCompatibleEnv = createEnvWithoutExtensionAllowlist();

        const corsResponse = await app.fetch(new Request('https://example.com/api/data', {
            method: 'OPTIONS',
            headers: {
                Origin: 'chrome-extension://existing-extension-id',
                'Access-Control-Request-Method': 'GET',
            },
        }), defaultCompatibleEnv);
        expect(corsResponse.headers.get('access-control-allow-origin')).toBe('chrome-extension://existing-extension-id');

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
        }), defaultCompatibleEnv);
        expect(loginResponse.status).toBe(200);
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
});
