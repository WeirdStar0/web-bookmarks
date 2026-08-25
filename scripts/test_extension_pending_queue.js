const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const rootDir = path.resolve(__dirname, '..');
const popupPath = path.join(rootDir, 'extension', 'popup.js');

class FakeClassList {
    add() {}
    remove() {}
    toggle() {}
    contains() { return false; }
}

class FakeElement {
    constructor() {
        this.classList = new FakeClassList();
        this.children = [];
        this.disabled = false;
        this.value = '';
        this.textContent = '';
    }

    addEventListener() {}
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    querySelector() { return new FakeElement(); }
    querySelectorAll() { return []; }
    focus() {}
    setCustomValidity() {}
    reportValidity() {}
    setAttribute() {}
    getAttribute() { return null; }
}

function createWebLocks() {
    let tail = Promise.resolve();
    return {
        request(_name, _options, callback) {
            const previous = tail;
            let release;
            tail = new Promise((resolve) => { release = resolve; });
            return previous.then(async () => {
                try {
                    return await callback();
                } finally {
                    release();
                }
            });
        },
    };
}

function createQueueHarness(shared = {}) {
    const elements = new Map();
    const getElement = (id) => {
        if (!elements.has(id)) elements.set(id, new FakeElement());
        return elements.get(id);
    };
    const storedValues = shared.storedValues || {};
    const removedStorageKeys = [];
    const removedOrigins = [];
    const document = {
        documentElement: new FakeElement(),
        addEventListener() {},
        createElement() { return new FakeElement(); },
        getElementById: getElement,
        querySelectorAll() { return []; },
    };
    const chrome = {
        i18n: { getMessage: (key) => key },
        permissions: {
            contains: async () => true,
            request: async () => true,
            remove: async ({ origins }) => {
                removedOrigins.push(...origins);
                return true;
            },
        },
        runtime: { getURL: () => 'chrome-extension://test/' },
        storage: {
            local: {
                get: async (keys) => {
                    const requestedKeys = Array.isArray(keys) ? keys : [keys];
                    return Object.fromEntries(requestedKeys
                        .filter((key) => Object.prototype.hasOwnProperty.call(storedValues, key))
                        .map((key) => [key, storedValues[key]]));
                },
                remove: async (keys) => {
                    const normalizedKeys = Array.isArray(keys) ? keys : [keys];
                    removedStorageKeys.push(...normalizedKeys);
                    for (const key of normalizedKeys) delete storedValues[key];
                },
                set: async (values) => Object.assign(storedValues, values),
            },
        },
        tabs: { query() {} },
    };
    const context = {
        AbortController,
        URL,
        chrome,
        console,
        crypto: webcrypto,
        document,
        navigator: shared.locks ? { locks: shared.locks } : {},
        setTimeout,
        clearTimeout,
        window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    };
    context.globalThis = context;
    context.fetch = async () => {
        throw new Error('Fetch stub was not configured.');
    };

    const source = `${fs.readFileSync(popupPath, 'utf8')}
;globalThis.__pendingQueueTestApi = {
    clearLocalSession,
    getStorage,
    enqueuePendingSave,
    flushPendingSaves,
    removePendingSave,
    hasApiHostPermission,
    requestApiHostPermission,
    revokeUnusedApiHostPermission,
    loadFolders,
    submitBookmarkRequest,
    handleStorageChanges,
    setApiBase: setActiveApiBase,
    getApiBase: () => API_BASE,
    setPendingSaves: (value) => { pendingSaves = value; },
    getPendingSaves: () => pendingSaves.map((item) => ({ ...item })),
    getCurrentServerPendingSaves: () => getCurrentServerPendingSaves().map((item) => ({ ...item })),
};`;
    vm.runInNewContext(source, context, { filename: popupPath });
    return { api: context.__pendingQueueTestApi, context, storedValues, removedOrigins, removedStorageKeys };
}

async function waitFor(predicate, message) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error(message);
}

function pendingSave(requestId) {
    return {
        apiBase: 'https://bookmarks.example',
        description: '',
        folderId: null,
        requestId,
        title: `Title ${requestId}`,
        url: `https://example.com/${requestId}`,
    };
}

function successfulResponse() {
    return { ok: true, status: 201, json: async () => ({ success: true }) };
}

function retryableResponse() {
    return { ok: false, status: 503, json: async () => ({ error: 'Temporary failure' }) };
}

async function testAppendDuringFlushIsPreserved() {
    const { api, context, storedValues } = createQueueHarness();
    const first = pendingSave('first');
    const addedDuringFlush = pendingSave('added-during-flush');
    let resolveFetch;

    api.setApiBase(first.apiBase);
    api.setPendingSaves([first]);
    context.fetch = async () => new Promise((resolve) => {
        resolveFetch = () => resolve(successfulResponse());
    });

    const flushing = api.flushPendingSaves();
    await waitFor(() => typeof resolveFetch === 'function', 'Flush did not begin its network request.');
    const enqueueing = api.enqueuePendingSave(addedDuringFlush);
    resolveFetch();
    await Promise.all([flushing, enqueueing]);

    assert.equal(JSON.stringify(api.getPendingSaves().map((item) => item.requestId)), JSON.stringify([addedDuringFlush.requestId]));
    assert.equal(JSON.stringify(storedValues.pendingSaves.map((item) => item.requestId)), JSON.stringify([addedDuringFlush.requestId]));
}

async function testConcurrentPopupEnqueuesAreMergedUnderWebLocks() {
    const shared = { storedValues: {}, locks: createWebLocks() };
    const firstPopup = createQueueHarness(shared);
    const secondPopup = createQueueHarness(shared);
    const first = pendingSave('popup-one');
    const second = pendingSave('popup-two');

    firstPopup.api.setApiBase(first.apiBase);
    secondPopup.api.setApiBase(second.apiBase);
    await Promise.all([
        firstPopup.api.enqueuePendingSave(first),
        secondPopup.api.enqueuePendingSave(second),
    ]);

    assert.equal(
        JSON.stringify(shared.storedValues.pendingSaves.map((item) => item.requestId).sort()),
        JSON.stringify([first.requestId, second.requestId].sort()),
    );
}

async function testBookmarkRequestTimeoutIsRetryable() {
    const { api, context } = createQueueHarness();
    let aborted = false;
    context.fetch = (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('Request aborted'));
        }, { once: true });
    });

    const result = await api.submitBookmarkRequest(pendingSave('timeout'), 1);
    assert.equal(aborted, true);
    assert.equal(result.state, 'retry');
}

async function testServerSwitchHidesOldServerPendingItems() {
    const { api } = createQueueHarness();
    const oldServerItem = pendingSave('old-server-private-title');
    const newServerItem = { ...pendingSave('new-server-private-title'), apiBase: 'https://replacement.example' };

    api.setApiBase(oldServerItem.apiBase);
    api.setPendingSaves([oldServerItem, newServerItem]);
    assert.equal(JSON.stringify(api.getCurrentServerPendingSaves().map((item) => item.requestId)), JSON.stringify([oldServerItem.requestId]));

    api.setApiBase(newServerItem.apiBase);
    assert.equal(JSON.stringify(api.getCurrentServerPendingSaves().map((item) => item.requestId)), JSON.stringify([newServerItem.requestId]));
    assert.equal(api.getPendingSaves().length, 2);
}

async function testServerSwitchStopsRemainingOldServerQueueSends() {
    const { api, context, storedValues } = createQueueHarness();
    const first = pendingSave('first-before-switch');
    const second = pendingSave('second-after-switch');
    let resolveFetch;
    let requestCount = 0;

    api.setApiBase(first.apiBase);
    api.setPendingSaves([first, second]);
    context.fetch = async () => {
        requestCount += 1;
        return new Promise((resolve) => {
            resolveFetch = () => resolve(successfulResponse());
        });
    };

    const flushing = api.flushPendingSaves();
    await waitFor(() => typeof resolveFetch === 'function', 'Flush did not begin its old-server request.');
    api.setApiBase('https://replacement.example');
    resolveFetch();
    await flushing;

    assert.equal(requestCount, 1);
    assert.equal(JSON.stringify(api.getPendingSaves().map((item) => item.requestId)), JSON.stringify([second.requestId]));
    assert.equal(JSON.stringify(storedValues.pendingSaves.map((item) => item.requestId)), JSON.stringify([second.requestId]));
}

async function testServerSwitchDiscardsLateFolderResponse() {
    const { api, context, storedValues } = createQueueHarness();
    let resolveFetch;
    api.setApiBase('https://old-folders.example');
    context.fetch = async () => new Promise((resolve) => {
        resolveFetch = () => resolve({
            ok: true,
            status: 200,
            json: async () => ({ folders: [{ id: 1, name: 'Old Server Folder', parent_id: null }] }),
        });
    });

    const loading = api.loadFolders(null);
    await waitFor(() => typeof resolveFetch === 'function', 'Folder request did not begin.');
    api.setApiBase('https://new-folders.example');
    resolveFetch();

    assert.equal((await loading).state, 'superseded');
    assert.equal(Object.prototype.hasOwnProperty.call(storedValues, 'folderCache'), false);
}

async function testFolderLoadSurvivesCachePersistenceFailure() {
    const { api, context } = createQueueHarness();
    api.setApiBase('https://cache-write-failure.example');
    context.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ folders: [{ id: 1, name: 'Available Online', parent_id: null }] }),
    });
    context.chrome.storage.local.set = async (values) => {
        if (Object.prototype.hasOwnProperty.call(values, 'folderCache')) {
            throw new Error('folder cache storage unavailable');
        }
    };

    const result = await api.loadFolders(null);
    assert.equal(result.state, 'success');
}

async function testStorageChangesSynchronizeQueueAndSessionAcrossPopups() {
    const { api } = createQueueHarness();
    const oldItem = pendingSave('old-server-item');
    const newItem = { ...pendingSave('new-server-item'), apiBase: 'https://replacement.example' };
    api.setApiBase(oldItem.apiBase);
    api.setPendingSaves([oldItem]);

    await api.handleStorageChanges({
        pendingSaves: { newValue: [oldItem, newItem] },
        apiBase: { newValue: newItem.apiBase },
        token: { newValue: undefined },
    }, 'local');

    assert.equal(api.getApiBase(), newItem.apiBase);
    assert.equal(JSON.stringify(api.getCurrentServerPendingSaves().map((item) => item.requestId)), JSON.stringify([newItem.requestId]));
}

async function testStorageTokenLoginSynchronizesAuthenticatedView() {
    const { api, context } = createQueueHarness();
    api.setApiBase('https://shared-login.example');
    let folderLoadCount = 0;
    context.fetch = async (url) => {
        if (url === 'https://shared-login.example/api/data?includeBookmarks=false') {
            folderLoadCount += 1;
            return {
                ok: true,
                status: 200,
                json: async () => ({ folders: [{ id: 1, name: 'Shared Login Folder', parent_id: null }] }),
            };
        }
        throw new Error(`Unexpected URL: ${url}`);
    };

    await api.handleStorageChanges({ token: { newValue: 'logged_in' } }, 'local');
    assert.equal(folderLoadCount, 1);
}

async function testStorageReadAndSessionClearFailuresDoNotBlockRecovery() {
    const { api, context, removedStorageKeys } = createQueueHarness();
    context.chrome.storage.local.get = async () => {
        throw new Error('storage unavailable');
    };
    assert.equal(Object.keys(await api.getStorage(['apiBase'])).length, 0);

    context.chrome.storage.local.remove = async () => {
        throw new Error('storage remove unavailable');
    };
    const cleared = await api.clearLocalSession();
    assert.equal(cleared, false);
    assert.equal(removedStorageKeys.length, 0);
}

async function testSessionClearRetainsOfflineQueueButClearsFolderMetadata() {
    const { api, removedStorageKeys } = createQueueHarness();
    const queued = pendingSave('retained-after-session-clear');
    api.setPendingSaves([queued]);

    await api.clearLocalSession();

    assert.equal(JSON.stringify(api.getPendingSaves().map((item) => item.requestId)), JSON.stringify([queued.requestId]));
    assert.equal(JSON.stringify(removedStorageKeys.sort()), JSON.stringify(['folderCache', 'lastFolderId', 'token'].sort()));
}

async function testPermissionApiFailuresKeepConfigurationRecoverable() {
    const { api, context } = createQueueHarness();
    context.chrome.permissions.contains = async () => {
        throw new Error('permission inspection unavailable');
    };
    assert.equal(await api.hasApiHostPermission('https://permission-failure.example'), false);
    assert.equal(await api.hasApiHostPermission('not a valid API base'), false);

    context.chrome.permissions.request = async () => {
        throw new Error('permission request unavailable');
    };
    assert.equal(await api.requestApiHostPermission('https://permission-failure.example'), false);
}

async function testPermissionIsRevokedWhenApiHostChanges() {
    const { api, removedOrigins } = createQueueHarness();

    await api.revokeUnusedApiHostPermission('https://old.example/app', 'https://new.example/app');
    assert.equal(JSON.stringify(removedOrigins), JSON.stringify(['https://old.example/*']));

    await api.revokeUnusedApiHostPermission('https://new.example/old-path', 'https://new.example/new-path');
    assert.equal(JSON.stringify(removedOrigins), JSON.stringify(['https://old.example/*']));

    await api.revokeUnusedApiHostPermission('https://unpersisted.example/app', '');
    assert.equal(JSON.stringify(removedOrigins), JSON.stringify(['https://old.example/*', 'https://unpersisted.example/*']));
}

async function testRemovalDuringFlushIsNotResurrected() {
    const { api, context, storedValues } = createQueueHarness();
    const item = pendingSave('remove-during-flush');
    let resolveFetch;

    api.setApiBase(item.apiBase);
    api.setPendingSaves([item]);
    context.fetch = async () => new Promise((resolve) => {
        resolveFetch = () => resolve(retryableResponse());
    });

    const flushing = api.flushPendingSaves();
    await waitFor(() => typeof resolveFetch === 'function', 'Flush did not begin its network request.');
    const removing = api.removePendingSave(item.requestId);
    resolveFetch();
    await Promise.all([flushing, removing]);

    assert.equal(JSON.stringify(api.getPendingSaves()), '[]');
    assert.equal(JSON.stringify(storedValues.pendingSaves), '[]');
}

(async () => {
    await testAppendDuringFlushIsPreserved();
    await testRemovalDuringFlushIsNotResurrected();
    await testConcurrentPopupEnqueuesAreMergedUnderWebLocks();
    await testBookmarkRequestTimeoutIsRetryable();
    await testServerSwitchHidesOldServerPendingItems();
    await testServerSwitchStopsRemainingOldServerQueueSends();
    await testServerSwitchDiscardsLateFolderResponse();
    await testFolderLoadSurvivesCachePersistenceFailure();
    await testStorageChangesSynchronizeQueueAndSessionAcrossPopups();
    await testStorageTokenLoginSynchronizesAuthenticatedView();
    await testStorageReadAndSessionClearFailuresDoNotBlockRecovery();
    await testSessionClearRetainsOfflineQueueButClearsFolderMetadata();
    await testPermissionApiFailuresKeepConfigurationRecoverable();
    await testPermissionIsRevokedWhenApiHostChanges();
    console.log('Extension offline queue and optional-host permission checks passed.');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
