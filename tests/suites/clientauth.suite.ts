import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { appAssetSource } from '../../src/templates/appAsset';

describe('clientauth', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('sets loginError when login succeeds but the follow-up data load returns 401', async () => {
        const originalWindow = (global as any).window;
        const originalDocument = (global as any).document;
        const originalFetch = (global as any).fetch;
        const mockWindow = {
            translations: { toast: { processing: 'Processing...', loggingIn: 'Logging in...', loginFailed: 'Login failed' } },
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
        // Scripted responses: first /api/login succeeds, then /api/data 401s.
        const responses = [
            { status: 200, ok: true, json: async () => ({ success: true }) },
            { status: 401, ok: false, text: async () => 'Unauthorized' },
        ];
        (global as any).fetch = async () => responses.shift();
        try {
            const initFn = new Function(appAssetSource + '; return window.app();');
            const clientApp = initFn();
            clientApp.loginForm = { username: 'admin', password: 'pw' };
            await clientApp.login();
            expect(clientApp.loggedIn).toBe(false);
            expect(clientApp.loginError).toBeTruthy();
        } finally {
            (global as any).window = originalWindow;
            (global as any).document = originalDocument;
            (global as any).fetch = originalFetch;
            delete (global as any).localStorage;
        }
    });

    it('shows a visible error when login succeeds but the initial data load fails with a network error', async () => {
        const originalWindow = (global as any).window;
        const originalDocument = (global as any).document;
        const originalFetch = (global as any).fetch;
        const mockWindow = {
            translations: {
                toast: {
                    processing: 'Processing...',
                    loggingIn: 'Logging in...',
                    loginFailed: 'Login failed',
                    networkError: 'Network error, please try again later',
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
        // /api/login succeeds, then /api/data throws a network error.
        (global as any).fetch = async (url: string) => {
            if (url.endsWith('/api/login')) {
                return { status: 200, ok: true, json: async () => ({ success: true }) };
            }
            throw new TypeError('Failed to fetch');
        };
        try {
            const initFn = new Function(appAssetSource + '; return window.app();');
            const clientApp = initFn();
            const toasts: string[] = [];
            clientApp.showToast = (message: string) => toasts.push(message);
            clientApp.loginForm = { username: 'admin', password: 'pw' };
            await clientApp.login();
            // The session is valid, so the user stays logged in...
            expect(clientApp.loggedIn).toBe(true);
            expect(clientApp.loginError).toBe('');
            // ...but a visible error explains why the page is empty.
            expect(toasts.length).toBeGreaterThan(0);
            expect(toasts[0]).toBe('Failed to fetch');
        } finally {
            (global as any).window = originalWindow;
            (global as any).document = originalDocument;
            (global as any).fetch = originalFetch;
            delete (global as any).localStorage;
        }
    });

    it('does not let a stale checkAuth 401 override a newer successful auth check', async () => {
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
            const staleCheck = clientApp.checkAuth();
            const freshCheck = clientApp.checkAuth();
            expect(pendingResponses).toHaveLength(2);

            pendingResponses[1]({
                status: 200,
                ok: true,
                json: async () => ({ folders: [{ id: 3, parent_id: null }], bookmarks: [] }),
            });
            await freshCheck;
            expect(clientApp.loggedIn).toBe(true);

            pendingResponses[0]({ status: 401, ok: false, text: async () => '' });
            await staleCheck;
            expect(clientApp.loggedIn).toBe(true);
            expect(clientApp.folders).toEqual([{ id: 3, parent_id: null }]);
        } finally {
            (global as any).window = originalWindow;
            (global as any).document = originalDocument;
            (global as any).fetch = originalFetch;
            delete (global as any).localStorage;
        }
    });
});
