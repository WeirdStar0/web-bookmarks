import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { appAssetSource } from '../../src/templates/appAsset';
import { appCssAssetSource } from '../../src/templates/appCssAsset';
import { vendorAssetSource } from '../../src/templates/vendorAsset';
import { main } from '../../src/templates/main';
import { modals } from '../../src/templates/modals';
import { en } from '../../src/locales/en';

describe('frontend', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
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

    it('renders folder names in the sidebar through the bound escape helper', () => {
        const g = globalThis as Record<string, any>;
        const store: Record<string, string> = {};
        g.document = {
            body: { dataset: {} },
            documentElement: { classList: { add() {}, remove() {} } },
        };
        g.window = {
            translations: {},
            dispatchEvent: () => {},
            addEventListener: () => {},
        };
        g.localStorage = {
            getItem: (k: string) => store[k] ?? null,
            setItem: (k: string, v: string) => { store[k] = String(v); },
        };
        g.Event = class Event { type: string; constructor(t: string) { this.type = t; } };

        new Function(appAssetSource)();
        const state = g.window.app() as Record<string, any>;
        state.folders = [
            { id: 1, name: 'Work & Notes', parent_id: null, sort_order: 0 },
        ];
        state.expandedFolders = {};
        state.folderCounts = {};
        state.currentFolderId = null;
        state._sidebarCache = null;
        state._sidebarDirty = true;

        const html = state.sidebarHtml as string;
        expect(html).toContain('Work &amp; Notes');
        expect(html).not.toContain('undefined');
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

    it('folder selector writes to the field supplied by the caller', () => {
        // The picker is shared by the folder and bookmark modals. The target
        // field must come from the caller so a bookmark selection does not
        // silently update newFolderParentId instead of newBookmarkFolderId.
        const g = globalThis as Record<string, any>;
        const store: Record<string, string> = {};
        g.document = {
            body: { dataset: {} },
            documentElement: { classList: { add() {}, remove() {} } },
        };
        g.window = {
            translations: {},
            dispatchEvent: () => {},
            addEventListener: () => {},
        };
        g.localStorage = {
            getItem: (k: string) => store[k] ?? null,
            setItem: (k: string, v: string) => { store[k] = String(v); },
        };
        g.Event = class Event { type: string; constructor(t: string) { this.type = t; } };

        new Function(appAssetSource)();
        const state = g.window.app() as Record<string, any>;

        state.folders = [
            { id: 1, name: 'Root Folder', parent_id: null, sort_order: 0 },
            { id: 2, name: 'Child', parent_id: 1, sort_order: 0 },
        ];
        state.selectorQuery = '';
        state.newFolderParentId = null;
        state.newBookmarkFolderId = null;
        state.showBookmarkModal = false;
        state.editingId = null;

        const folderHtml = state.folderSelectorTemplate('newFolderParentId', null) as string;
        expect(folderHtml).toContain("selectFolderOption($event, 'newFolderParentId')");
        expect(folderHtml).not.toContain('newBookmarkFolderId');

        const bookmarkHtml = state.folderSelectorTemplate('newBookmarkFolderId', null) as string;
        expect(bookmarkHtml).toContain("selectFolderOption($event, 'newBookmarkFolderId')");
        expect(bookmarkHtml).not.toContain('newFolderParentId');
    });

    it('folder selector never embeds folder names into Alpine expressions', () => {
        const g = globalThis as Record<string, any>;
        const store: Record<string, string> = {};
        g.document = {
            body: { dataset: {} },
            documentElement: { classList: { add() {}, remove() {} } },
        };
        g.window = {
            translations: {},
            dispatchEvent: () => {},
            addEventListener: () => {},
        };
        g.localStorage = {
            getItem: (k: string) => store[k] ?? null,
            setItem: (k: string, v: string) => { store[k] = String(v); },
        };
        g.Event = class Event { type: string; constructor(t: string) { this.type = t; } };

        new Function(appAssetSource)();
        const state = g.window.app() as Record<string, any>;

        // A name that would break out of a quoted Alpine expression.
        state.folders = [
            { id: 1, name: "'+alert(1)+'", parent_id: null, sort_order: 0 },
        ];
        state.selectorQuery = '';
        state.newFolderParentId = null;
        state.newBookmarkFolderId = null;
        state.editingId = null;

        const html = state.folderSelectorTemplate('newFolderParentId', null) as string;
        // The name must be HTML-escaped inside a plain text span, never placed
        // into x-text/x-html as executable Alpine syntax. The literal
        // "alert(1)" may appear in the escaped text node — that is harmless —
        // but no unescaped quote may break out of an Alpine expression, and
        // the raw name must not become an x-text directive.
        expect(html).toContain('<span>&#039;+alert(1)+&#039;</span>');
        expect(html).not.toContain('x-text="');
        expect(html).not.toMatch(/@click="[^"]*alert\(/);
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
});
