import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { appAssetSource } from '../../src/templates/appAsset';describe('clientcreds', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('immediately clears the web client session after credentials are updated', async () => {
        const originalWindow = (global as any).window;
        const originalDocument = (global as any).document;
        const mockWindow = {
            translations: {
                toast: {
                    processing: 'Processing...',
                    settingsUpdated: 'Settings updated',
                    updateFailed: 'Update failed',
                },
            },
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
            clientApp.loggedIn = true;
            clientApp.settingsForm = { username: 'rotated-admin', password: 'rotated-password' };
            clientApp.withLoading = async (fn: () => Promise<void>) => fn();
            clientApp.submitJson = async () => ({ ok: true });

            await clientApp.updateSettings();

            expect(clientApp.loggedIn).toBe(false);
            expect(clientApp.settingsForm).toEqual({ username: '', password: '' });
            expect(clientApp.loginForm).toEqual({ username: 'rotated-admin', password: '' });
        } finally {
            (global as any).window = originalWindow;
            (global as any).document = originalDocument;
            delete (global as any).localStorage;
        }
    });
});
