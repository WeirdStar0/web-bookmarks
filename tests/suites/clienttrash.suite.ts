import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { appAssetSource } from '../../src/templates/appAsset';describe('clienttrash', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
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
});
