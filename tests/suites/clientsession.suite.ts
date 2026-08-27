import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { appAssetSource } from '../../src/templates/appAsset';describe('clientsession', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
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
});
