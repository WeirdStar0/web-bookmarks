import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { appAssetSource } from '../../src/templates/appAsset';describe('clientstale', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
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
});
