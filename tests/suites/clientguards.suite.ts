import { describe, it, expect } from 'vitest';
import { appAssetSource } from '../../src/templates/appAsset';
import { main } from '../../src/templates/main';
import { en } from '../../src/locales/en';

/**
 * Client-side guards that are easy to regress because they protect against
 * data shapes the API no longer produces. The write path rejects bad URLs and
 * migration 007 blocks new folder cycles, so neither case can be reached
 * through the UI on a healthy database -- which is exactly why they need
 * explicit tests instead of relying on manual verification.
 */

function createAppState(): Record<string, any> {
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
    return g.window.app() as Record<string, any>;
}

function folderOptions(state: Record<string, any>, editingId: number | null): Map<number, Record<string, any>> {
    const options = new Map<number, Record<string, any>>();
    for (const option of state.buildSelectorOptions(editingId) as Array<Record<string, any>>) {
        options.set(Number(option.id), option);
    }
    return options;
}

describe('client guards', () => {
    it('allows only http(s) bookmark URLs into an href', () => {
        const state = createAppState();

        const allowed = [
            'https://example.com',
            'http://example.com',
            'https://example.com/path?q=1#frag',
            'HTTP://EXAMPLE.COM/Upper',
            'HtTpS://example.com/Mixed',
        ];
        for (const url of allowed) {
            expect(state.safeBookmarkUrl(url), url).toBe(url);
        }

        const blocked = [
            'javascript:alert(1)',
            'JavaScript:alert(1)',
            'JaVaScRiPt:alert(1)',
            ' javascript:alert(1)',
            'javascript\t:alert(1)',
            'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
            'vbscript:msgbox(1)',
            'file:///etc/passwd',
            'mailto:someone@example.com',
            'chrome-extension://abcdefg/popup.html',
            '//example.com/protocol-relative',
            'example.com/no-scheme',
            'not a url',
            '',
            null,
            undefined,
        ];
        for (const url of blocked) {
            expect(state.safeBookmarkUrl(url), String(url)).toBe('#');
        }
    });

    it('renders bookmark hrefs through the protocol allowlist', () => {
        const rendered = main({ ...en, lang: 'en' });
        expect(rendered).toContain('safeBookmarkUrl(bookmark.url)');
        // The raw stored value must no longer reach an href unfiltered.
        expect(rendered).not.toContain("? bookmark.url : '#'");
    });

    it('terminates breadcrumbs on a folder cycle instead of spinning forever', () => {
        const state = createAppState();
        state.folders = [
            { id: 1, name: 'Cycle A', parent_id: 2, sort_order: 0 },
            { id: 2, name: 'Cycle B', parent_id: 1, sort_order: 0 },
        ];
        state.currentFolderId = 1;

        // Reaching this assertion at all proves the walk terminates; without
        // the visited guard the while loop never exits and the test times out.
        const crumbs = state.breadcrumbs as Array<{ id: number }>;
        expect(crumbs.length).toBe(2);
        expect(crumbs.map((crumb) => crumb.id)).toEqual([2, 1]);
    });

    it('terminates breadcrumbs on a self-referencing folder', () => {
        const state = createAppState();
        state.folders = [{ id: 7, name: 'Self', parent_id: 7, sort_order: 0 }];
        state.currentFolderId = 7;

        const crumbs = state.breadcrumbs as Array<{ id: number }>;
        expect(crumbs.map((crumb) => crumb.id)).toEqual([7]);
    });

    it('builds breadcrumbs normally for a healthy hierarchy', () => {
        const state = createAppState();
        state.folders = [
            { id: 1, name: 'Root', parent_id: null, sort_order: 0 },
            { id: 2, name: 'Child', parent_id: 1, sort_order: 0 },
            { id: 3, name: 'Grandchild', parent_id: 2, sort_order: 0 },
        ];
        state.currentFolderId = 3;

        const crumbs = state.breadcrumbs as Array<{ id: number }>;
        expect(crumbs.map((crumb) => crumb.id)).toEqual([1, 2, 3]);
    });

    it('excludes the edited folder and its whole subtree from the parent selector', () => {
        const state = createAppState();
        state.folders = [
            { id: 1, name: 'Root', parent_id: null, sort_order: 0 },
            { id: 2, name: 'Editing', parent_id: 1, sort_order: 0 },
            { id: 3, name: 'Descendant', parent_id: 2, sort_order: 0 },
            { id: 4, name: 'Deep Descendant', parent_id: 3, sort_order: 0 },
            { id: 5, name: 'Sibling', parent_id: 1, sort_order: 1 },
        ];
        state.selectorQuery = '';
        state.newFolderParentId = null;
        state.editingId = 2;

        const options = folderOptions(state, 2);

        // Every folder is still listed so the tree stays readable, but only
        // folders outside the edited subtree are selectable.
        expect([...options.keys()].sort()).toEqual([1, 2, 3, 4, 5]);

        expect(options.get(1)?.selectable).toBe(true);
        expect(options.get(5)?.selectable).toBe(true);

        for (const id of [2, 3, 4]) {
            expect(options.get(id)?.selectable, `folder ${id} must not be selectable`).toBe(false);
        }

        // Indentation still reflects tree depth for readable nesting.
        expect(options.get(1)?.paddingLeft).toBe(16);
        expect(options.get(4)?.paddingLeft).toBe(64);
    });

    it('omits cycle folders from the parent selector because they are unreachable from the root', () => {
        const state = createAppState();
        state.folders = [
            { id: 1, name: 'Visible', parent_id: null, sort_order: 0 },
            { id: 10, name: 'Cycle A', parent_id: 11, sort_order: 0 },
            { id: 11, name: 'Cycle B', parent_id: 10, sort_order: 0 },
        ];
        state.selectorQuery = '';
        state.newFolderParentId = null;
        state.editingId = null;

        const options = folderOptions(state, null);
        expect([...options.keys()]).toEqual([1]);
    });

    it('terminates the sidebar walk on legacy folder cycles', () => {
        const state = createAppState();
        state.folders = [
            { id: 1, name: 'Cycle A', parent_id: 2, sort_order: 0 },
            { id: 2, name: 'Cycle B', parent_id: 1, sort_order: 0 },
        ];
        state.expandedFolders = {};
        state.folderCounts = {};

        // Reaching this assertion at all proves the flatten walk terminates;
        // cycle folders are simply unreachable from the null root.
        const rows = state.sidebarFolders as Array<Record<string, any>>;
        expect(rows).toEqual([]);
    });
});
