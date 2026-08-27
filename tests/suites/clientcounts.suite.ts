import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { appAssetSource } from '../../src/templates/appAsset';describe('clientcounts', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
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
});
