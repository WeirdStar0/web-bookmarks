import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { appAssetSource } from '../../src/templates/appAsset';describe('clientlogout', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
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
});
