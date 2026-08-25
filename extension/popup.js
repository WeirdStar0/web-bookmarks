// State
let API_BASE = '';
let apiBaseGeneration = 0;
let token = null;
let folders = [];
let currentMessages = null; // Store loaded translations
const FOLDER_CACHE_TTL_MS = 5 * 60 * 1000;
let folderOutsideClickBound = false;
let activeSearchController = null;
let searchRequestVersion = 0;
let pendingSaves = [];
let isFlushingPendingSaves = false;
let pendingSavesOperation = Promise.resolve();
const MAX_PENDING_SAVES = 50;

// DOM Elements

const settingsBtn = document.getElementById('settingsBtn');
const logoutBtn = document.getElementById('logoutBtn');
const settingsView = document.getElementById('settingsView');
const settingsForm = document.getElementById('settingsForm');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const serverUrlInput = document.getElementById('serverUrl');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const themeSun = themeToggleBtn.querySelector('.theme-sun');
const themeMoon = themeToggleBtn.querySelector('.theme-moon');

const loginView = document.getElementById('loginView');
const mainView = document.getElementById('mainView');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');

const tabSave = document.getElementById('tabSave');
const tabSearch = document.getElementById('tabSearch');
const panelSave = document.getElementById('panelSave');
const panelSearch = document.getElementById('panelSearch');

const saveForm = document.getElementById('saveForm');

const saveMessage = document.getElementById('saveMessage');
const syncMessage = document.getElementById('syncMessage');
const retryPendingSavesBtn = document.getElementById('retryPendingSavesBtn');
const extensionOriginElement = document.getElementById('extensionOrigin');
const copyExtensionOriginBtn = document.getElementById('copyExtensionOriginBtn');
const extensionOriginMessage = document.getElementById('extensionOriginMessage');
const pendingSavesPanel = document.getElementById('pendingSavesPanel');
const pendingSavesList = document.getElementById('pendingSavesList');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');
const saveSubmitButton = saveForm.querySelector('button[type="submit"]');

let isSaving = false;


// Helper to get message (Custom Locale > Browser Locale)
function getMessage(key) {
    if (currentMessages && currentMessages[key]) {
        return currentMessages[key].message;
    }
    return chrome.i18n.getMessage(key);
}

// Read storage through either the Promise or callback API. Storage failures
// must not leave popup initialization waiting forever; callers can safely use
// an empty configuration and keep the settings screen available for recovery.
function getStorage(keys) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value && typeof value === 'object' ? value : {});
        };
        const fail = (error) => {
            console.error('Failed to read extension storage:', error);
            finish({});
        };
        const readWithCallback = () => {
            try {
                chrome.storage.local.get(keys, (value) => {
                    const lastError = chrome.runtime?.lastError;
                    if (lastError) {
                        fail(lastError);
                        return;
                    }
                    finish(value);
                });
            } catch (error) {
                fail(error);
            }
        };

        try {
            const result = chrome.storage.local.get(keys);
            if (result && typeof result.then === 'function') {
                result.then(finish, fail);
            } else {
                readWithCallback();
            }
        } catch {
            readWithCallback();
        }
    });
}

async function responseJson(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

function setActiveApiBase(apiBase) {
    API_BASE = apiBase;
    apiBaseGeneration += 1;
    folders = [];
}

async function clearLocalSession() {
    token = null;
    folders = [];
    // Pending saves intentionally remain available for a later authenticated
    // retry, but cached folder names and the prior selection are not needed
    // once the active session has ended.
    try {
        await chrome.storage.local.remove(['token', 'folderCache', 'lastFolderId']);
        return true;
    } catch (error) {
        // In-memory authentication state is already cleared. Do not prevent
        // the caller from returning to login just because persistence failed.
        console.error('Failed to clear extension session storage:', error);
        showSyncMessage(getMessage('pendingStorageFailed'), 'error');
        return false;
    }
}

function createRequestId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function getExtensionOrigin() {
    try {
        const extensionUrl = chrome.runtime?.getURL?.('/') || window.location.href;
        return new URL(extensionUrl).origin;
    } catch {
        return window.location.origin;
    }
}

function showExtensionOriginMessage(message, type = 'info') {
    if (!extensionOriginMessage) return;
    extensionOriginMessage.textContent = message;
    extensionOriginMessage.className = `status-msg status-${type}`;
}

async function copyExtensionOrigin() {
    const origin = getExtensionOrigin();
    try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(origin);
        showExtensionOriginMessage(getMessage('extensionOriginCopied'), 'success');
    } catch {
        showExtensionOriginMessage(getMessage('extensionOriginCopyFailed'), 'error');
    }
}

function showSyncMessage(message, type = 'info') {
    if (!syncMessage) return;
    syncMessage.textContent = message;
    syncMessage.className = `status-msg sync-${type}`;
    syncMessage.classList.remove('hidden');
}

function hideSyncMessage() {
    if (syncMessage) syncMessage.classList.add('hidden');
}

function getCurrentServerPendingSaves() {
    if (!API_BASE) return [];
    return pendingSaves.filter((item) => item?.apiBase === API_BASE);
}

function updatePendingSyncControls() {
    if (!retryPendingSavesBtn) return;
    retryPendingSavesBtn.classList.toggle('hidden', getCurrentServerPendingSaves().length === 0);
    retryPendingSavesBtn.disabled = isFlushingPendingSaves;
}

async function refreshPendingSavesFromStorage() {
    const stored = await getStorage(['pendingSaves']);
    // Preserve the in-memory snapshot when storage is unavailable. Replacing it
    // with an empty fallback would turn a transient read failure into data loss.
    if (Array.isArray(stored.pendingSaves)) {
        pendingSaves = stored.pendingSaves;
    }
}

async function withPendingSavesStorageLock(operation) {
    const run = async () => {
        await refreshPendingSavesFromStorage();
        return operation();
    };
    // Popup instances in different browser windows have separate JavaScript
    // queues. Web Locks serializes them under the extension origin; older
    // browsers retain the existing per-popup promise fallback.
    if (navigator.locks?.request) {
        return navigator.locks.request('web-bookmarks-pending-saves', { mode: 'exclusive' }, run);
    }
    return run();
}

function queuePendingSavesOperation(operation) {
    const queuedOperation = pendingSavesOperation.then(
        () => withPendingSavesStorageLock(operation),
        () => withPendingSavesStorageLock(operation),
    );
    pendingSavesOperation = queuedOperation.catch((error) => {
        console.error('Pending bookmark operation failed:', error);
        showSyncMessage(getMessage('pendingStorageFailed'), 'error');
    });
    return queuedOperation;
}

function renderPendingSaves() {
    if (!pendingSavesPanel || !pendingSavesList) return;
    const currentServerPendingSaves = getCurrentServerPendingSaves();
    pendingSavesPanel.classList.toggle('hidden', currentServerPendingSaves.length === 0);
    pendingSavesList.replaceChildren();

    for (const item of currentServerPendingSaves) {
        const entry = document.createElement('article');
        entry.className = 'pending-save-item';

        const title = document.createElement('strong');
        title.textContent = item.title || item.url;
        entry.appendChild(title);

        const url = document.createElement('p');
        url.className = 'pending-save-url';
        url.textContent = item.url;
        entry.appendChild(url);

        const detail = document.createElement('p');
        detail.className = item.lastError ? 'pending-save-error' : 'pending-save-detail';
        detail.textContent = item.lastError || getMessage('pendingSaveWaiting');
        entry.appendChild(detail);

        const actions = document.createElement('div');
        actions.className = 'pending-save-actions';
        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'btn-secondary';
        removeButton.textContent = getMessage('removePendingSave');
        removeButton.disabled = isFlushingPendingSaves;
        removeButton.addEventListener('click', () => removePendingSave(item.requestId));
        actions.appendChild(removeButton);
        entry.appendChild(actions);
        pendingSavesList.appendChild(entry);
    }
}

function removePendingSave(requestId) {
    return queuePendingSavesOperation(() => removePendingSaveUnsafe(requestId));
}

async function removePendingSaveUnsafe(requestId) {
    const previousPendingSaves = pendingSaves;
    pendingSaves = pendingSaves.filter((item) => item.requestId !== requestId);
    if (!await persistPendingSaves()) {
        pendingSaves = previousPendingSaves;
        renderPendingSaves();
        updatePendingSyncControls();
        return;
    }
    renderPendingSaves();
    updatePendingSyncControls();
    if (pendingSaves.length === 0) hideSyncMessage();
}

async function persistPendingSaves() {
    try {
        await chrome.storage.local.set({ pendingSaves });
        return true;
    } catch (error) {
        console.error('Failed to persist pending bookmarks:', error);
        showSyncMessage(getMessage('pendingStorageFailed'), 'error');
        return false;
    }
}

function enqueuePendingSave(item) {
    return queuePendingSavesOperation(() => enqueuePendingSaveUnsafe(item));
}

async function enqueuePendingSaveUnsafe(item) {
    if (pendingSaves.some((pending) => pending.requestId === item.requestId)) return true;
    if (pendingSaves.length >= MAX_PENDING_SAVES) {
        showSyncMessage(getMessage('pendingSyncFull'), 'error');
        return false;
    }

    const previousPendingSaves = pendingSaves;
    pendingSaves = [...pendingSaves, item];
    if (!await persistPendingSaves()) {
        pendingSaves = previousPendingSaves;
        updatePendingSyncControls();
        return false;
    }
    updatePendingSyncControls();
    renderPendingSaves();
    showSyncMessage(getMessage('pendingSyncWaiting'), 'info');
    return true;
}

const BOOKMARK_REQUEST_TIMEOUT_MS = 30_000;

async function submitBookmarkRequest(item, timeoutMs = BOOKMARK_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${item.apiBase}/api/bookmarks`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': item.requestId,
            },
            body: JSON.stringify({
                title: item.title,
                url: item.url,
                description: item.description,
                folder_id: item.folderId,
            }),
            credentials: 'include',
            signal: controller.signal,
        });
        const data = await responseJson(response);

        if (response.ok && data.success) return { state: 'success', data };
        if (response.status === 401) return { state: 'unauthorized', data };
        if (response.status >= 500 || response.status === 429) return { state: 'retry', data };
        return { state: 'failed', data };
    } catch {
        return { state: 'retry', data: {} };
    } finally {
        clearTimeout(timeout);
    }
}

function flushPendingSaves() {
    return queuePendingSavesOperation(flushPendingSavesUnsafe);
}

async function flushPendingSavesUnsafe() {
    if (isFlushingPendingSaves || !API_BASE || pendingSaves.length === 0) return;

    isFlushingPendingSaves = true;
    updatePendingSyncControls();
    renderPendingSaves();
    const flushApiBase = API_BASE;
    const flushGeneration = apiBaseGeneration;
    const previousPendingSaves = pendingSaves;
    const remaining = [];
    try {
        for (let index = 0; index < pendingSaves.length; index += 1) {
            const item = pendingSaves[index];
            if (API_BASE !== flushApiBase || apiBaseGeneration !== flushGeneration) {
                remaining.push(...pendingSaves.slice(index));
                break;
            }
            if (item.apiBase !== flushApiBase) {
                remaining.push(item);
                continue;
            }

            const result = await submitBookmarkRequest(item);
            if (result.state === 'success') continue;
            // Do not send subsequent queued entries to an old server after its
            // asynchronous request completes during a configuration change.
            if (API_BASE !== flushApiBase || apiBaseGeneration !== flushGeneration) {
                remaining.push(item, ...pendingSaves.slice(index + 1));
                break;
            }
            if (result.state === 'unauthorized') {
                // Preserve the current and all not-yet-attempted items until a
                // valid session can be established.
                remaining.push(item, ...pendingSaves.slice(index + 1));
                await clearLocalSession();
                showLoginView();
                showLoginError(getMessage('sessionExpiredSync'));
                break;
            }
            if (result.state === 'retry') {
                remaining.push(item);
                continue;
            }

            // Invalid input and other permanent 4xx errors stay visible in the
            // queue rather than being silently discarded.
            remaining.push({ ...item, lastError: result.data.message || result.data.error || getMessage('syncFailed') });
        }

        pendingSaves = remaining;
        if (!await persistPendingSaves()) {
            pendingSaves = previousPendingSaves;
        }
        if (pendingSaves.length === 0) hideSyncMessage();
        else showSyncMessage(getMessage('pendingSyncRemaining'), 'info');
        renderPendingSaves();
    } finally {
        isFlushingPendingSaves = false;
        updatePendingSyncControls();
        renderPendingSaves();
    }
}

async function handleStorageChanges(changes, areaName) {
    if (areaName !== 'local' || !changes || typeof changes !== 'object') return;

    if (changes.pendingSaves) {
        const nextPendingSaves = changes.pendingSaves.newValue;
        pendingSaves = Array.isArray(nextPendingSaves) ? nextPendingSaves : [];
        renderPendingSaves();
        updatePendingSyncControls();
    }

    if (changes.apiBase) {
        const nextApiBase = typeof changes.apiBase.newValue === 'string' ? changes.apiBase.newValue : '';
        if (nextApiBase !== API_BASE) {
            setActiveApiBase(nextApiBase);
            searchRequestVersion += 1;
            activeSearchController?.abort();
            activeSearchController = null;
            searchInput.value = '';
            searchResults.replaceChildren();
            token = null;
            serverUrlInput.value = nextApiBase;
            updatePendingSyncControls();
            renderPendingSaves();
            if (nextApiBase) showLoginView();
            else showSettingsView();
        }
    }

    if (changes.token) {
        const nextToken = typeof changes.token.newValue === 'string' && changes.token.newValue
            ? changes.token.newValue
            : null;
        if (!nextToken && token) {
            // Another popup may have logged out or switched servers. Clear only
            // memory and UI here; writing storage again would create a feedback loop.
            token = null;
            folders = [];
            showLoginView();
        } else if (nextToken && !token && API_BASE) {
            // Login cookies are shared by the extension origin. When another
            // popup completes login, converge this popup to the authenticated
            // view instead of requiring a redundant second login.
            token = nextToken;
            const config = await getStorage(['lastFolderId', 'folderCache']);
            await showMainView(config.lastFolderId, config.folderCache);
        }
    }
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Load config
    const config = await getStorage(['apiBase', 'token', 'lastFolderId', 'theme', 'lang', 'folderCache', 'pendingSaves']);
    pendingSaves = Array.isArray(config.pendingSaves) ? config.pendingSaves : [];
    updatePendingSyncControls();

    // Initialize Translations
    await loadTranslations(config.lang);
    localizeDom();
    renderPendingSaves();
    if (extensionOriginElement) extensionOriginElement.textContent = getExtensionOrigin();

    // Set Language Selector
    if (document.getElementById('langSelect')) {
        document.getElementById('langSelect').value = config.lang || 'en';
    }

    // Apply Theme
    if (config.theme) {
        setTheme(config.theme);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        setTheme('dark');
    } else {
        setTheme('light');
    }

    if (config.apiBase && await hasApiHostPermission(config.apiBase)) {
        setActiveApiBase(config.apiBase);
        serverUrlInput.value = API_BASE;
        updatePendingSyncControls();
        renderPendingSaves();

        if (config.token) {
            token = config.token;
            await showMainView(config.lastFolderId, config.folderCache);
        } else {
            showLoginView();
        }
    } else {
        if (config.apiBase) serverUrlInput.value = config.apiBase;
        showSettingsView();
    }

    // Keep multiple popup windows consistent when another instance updates
    // shared storage. The listener is optional for test or restricted contexts.
    chrome.storage?.onChanged?.addListener(handleStorageChanges);

    // Initialize current page info
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            document.getElementById('bookmarkTitle').value = tabs[0].title;
            document.getElementById('bookmarkUrl').value = tabs[0].url;
        }
    });
});

async function loadTranslations(lang) {
    if (!lang) return; // Use default
    try {
        const url = chrome.runtime.getURL(`_locales/${lang}/messages.json`);
        const res = await fetch(url);
        if (res.ok) {
            currentMessages = await res.json();
        }
    } catch (e) {
        console.error("Failed to load locale:", e);
    }
}

function localizeDom() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        const msg = getMessage(key);
        if (msg) el.innerText = msg;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        const msg = getMessage(key);
        if (msg) el.placeholder = msg;
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        const msg = getMessage(key);
        if (msg) el.title = msg;
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
        const key = el.getAttribute('data-i18n-aria-label');
        const msg = getMessage(key);
        if (msg) el.setAttribute('aria-label', msg);
    });
}

// Language Toggle
const langSelect = document.getElementById('langSelect');
// ... other elements

// Language Selector
if (langSelect) {
    langSelect.addEventListener('change', async (e) => {
        const next = e.target.value;
        await chrome.storage.local.set({ lang: next });

        // Reload translations and update DOM
        await loadTranslations(next);
        localizeDom();
    });
}

// Theme Toggle
themeToggleBtn.addEventListener('click', async () => {
    const isDark = document.documentElement.classList.contains('dark');
    const newTheme = isDark ? 'light' : 'dark';
    setTheme(newTheme);
    await chrome.storage.local.set({ theme: newTheme });
});

function setTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        themeSun.classList.remove('hidden');
        themeMoon.classList.add('hidden');
    } else {
        document.documentElement.classList.remove('dark');
        themeSun.classList.add('hidden');
        themeMoon.classList.remove('hidden');
    }
}

// Settings Events
function normalizeApiBase(rawUrl) {
    const parsed = new URL(rawUrl.trim());
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

    if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
        throw new Error('Use HTTPS, or HTTP only for localhost development.');
    }
    if (parsed.username || parsed.password || parsed.hash || parsed.search) {
        throw new Error('Server URL must be a clean origin or path without credentials, query, or fragment.');
    }

    return parsed.toString().replace(/\/$/, '');
}

function getApiHostPermissionPattern(apiBase) {
    const parsed = new URL(apiBase);
    return `${parsed.protocol}//${parsed.host}/*`;
}

async function hasApiHostPermission(apiBase) {
    if (!chrome.permissions?.contains) return true;
    try {
        return await chrome.permissions.contains({ origins: [getApiHostPermissionPattern(apiBase)] });
    } catch (error) {
        // Treat malformed persisted values and browser API failures as an
        // unavailable permission. This keeps the settings view recoverable.
        console.warn('Failed to inspect API host permission:', error);
        return false;
    }
}

async function requestApiHostPermission(apiBase) {
    if (!chrome.permissions?.request) return true;
    try {
        return await chrome.permissions.request({ origins: [getApiHostPermissionPattern(apiBase)] });
    } catch (error) {
        console.warn('Failed to request API host permission:', error);
        return false;
    }
}

async function revokeUnusedApiHostPermission(previousApiBase, nextApiBase) {
    if (!previousApiBase || !chrome.permissions?.remove) return;
    try {
        const previousPattern = getApiHostPermissionPattern(previousApiBase);
        const nextPattern = nextApiBase ? getApiHostPermissionPattern(nextApiBase) : null;
        if (previousPattern !== nextPattern) {
            await chrome.permissions.remove({ origins: [previousPattern] });
        }
    } catch (error) {
        // The new server is already configured. Retain the old permission only
        // when the browser cannot revoke it, rather than blocking the switch.
        console.warn('Failed to revoke previous API host permission:', error);
    }
}

settingsBtn.addEventListener('click', () => {
    showSettingsView();
});

cancelSettingsBtn.addEventListener('click', () => {
    if (API_BASE) {
        if (token) showMainView();
        else showLoginView();
    } else {
        serverUrlInput.focus();
    }
});

settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    serverUrlInput.setCustomValidity('');

    let url;
    try {
        url = normalizeApiBase(serverUrlInput.value);
    } catch (error) {
        serverUrlInput.setCustomValidity(error.message || 'Invalid server URL.');
        serverUrlInput.reportValidity();
        return;
    }

    const permissionGranted = await requestApiHostPermission(url);
    if (!permissionGranted) {
        serverUrlInput.setCustomValidity('Permission for this server was not granted.');
        serverUrlInput.reportValidity();
        return;
    }

    const previousApiBase = API_BASE;
    try {
        await chrome.storage.local.set({ apiBase: url });
    } catch (error) {
        // Do not enter a server context that would disappear when the popup
        // closes. The requested new permission is no longer needed either.
        console.error('Failed to persist API server setting:', error);
        await revokeUnusedApiHostPermission(url, previousApiBase);
        serverUrlInput.setCustomValidity(getMessage('pendingStorageFailed'));
        serverUrlInput.reportValidity();
        return;
    }

    setActiveApiBase(url);
    // Invalidate in-flight searches and remove old-account results before the
    // new server becomes available to the user.
    searchRequestVersion += 1;
    activeSearchController?.abort();
    activeSearchController = null;
    searchInput.value = '';
    searchResults.replaceChildren();
    hideSyncMessage();
    await clearLocalSession();
    updatePendingSyncControls();
    renderPendingSaves();
    await revokeUnusedApiHostPermission(previousApiBase, url);
    showLoginView();
});

// Auth Events
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    try {
        const res = await fetch(`${API_BASE}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            credentials: 'include'
        });

        const data = await responseJson(res);
        if (res.ok && data.success) {
            // The authenticated cookie is already established. Keep this popup
            // usable if storage is temporarily unavailable; persistence only
            // affects reopening the popup later.
            token = 'logged_in';
            try {
                await chrome.storage.local.set({ token });
            } catch (error) {
                console.warn('Failed to persist extension login state:', error);
                showSyncMessage(getMessage('pendingStorageFailed'), 'error');
            }
            await showMainView();
            return;
        }

        if (res.status === 401) {
            showLoginError(getMessage('loginFailed'));
        } else if (res.status === 503 && data.error === 'RATE_LIMIT_UNAVAILABLE') {
            showLoginError(getMessage('serverLoginProtectionMissing'));
        } else {
            showLoginError(`${getMessage('loginFailed')} ${data.message || data.error || res.status}`);
        }
    } catch {
        showLoginError(getMessage('connectionFailed'));
    }
});

logoutBtn.addEventListener('click', async () => {
    try {
        await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
    } catch { }
    await clearLocalSession();
    showLoginView();
});

copyExtensionOriginBtn?.addEventListener('click', copyExtensionOrigin);

retryPendingSavesBtn?.addEventListener('click', async () => {
    if (pendingSaves.length === 0) return;
    showSyncMessage(getMessage('syncRetrying'), 'info');
    await flushPendingSaves();
});

window.addEventListener('online', () => {
    if (token && pendingSaves.length > 0) flushPendingSaves();
});

// Tab Events

tabSave.addEventListener('click', () => switchTab('save'));
tabSearch.addEventListener('click', () => switchTab('search'));

// Save Bookmark
function setSaveBusy(busy) {
    isSaving = busy;
    saveSubmitButton.disabled = busy;
    saveSubmitButton.setAttribute('aria-busy', String(busy));
    saveSubmitButton.classList.toggle('opacity-60', busy);
    saveSubmitButton.classList.toggle('cursor-not-allowed', busy);
}

saveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSaving) return;

    const title = document.getElementById('bookmarkTitle').value.trim();
    const url = document.getElementById('bookmarkUrl').value.trim();
    const description = document.getElementById('bookmarkDescription').value.trim();
    const folderId = document.getElementById('folderSelect').value;

    if (!folderId) {
        showSaveMessage(getMessage('pleaseSelectFolder'), 'error');
        return;
    }

    const item = {
        requestId: createRequestId(),
        apiBase: API_BASE,
        title,
        url,
        description,
        folderId: parseInt(folderId, 10),
        createdAt: Date.now(),
    };

    setSaveBusy(true);
    try {
        const result = await submitBookmarkRequest(item);
        if (result.state === 'success') {
            // The server already accepted an idempotent bookmark write. A
            // preference-cache failure must not hide that success from users.
            try {
                await chrome.storage.local.set({ lastFolderId: folderId });
            } catch (error) {
                console.warn('Failed to persist last selected folder:', error);
            }
            showSaveMessage(getMessage('saveSuccess'), 'success');
            setTimeout(() => window.close(), 1000);
            return;
        }

        if (result.state === 'unauthorized') {
            await clearLocalSession();
            showLoginView();
            showLoginError(getMessage('sessionExpired'));
            return;
        }

        if (result.state === 'retry') {
            const queued = await enqueuePendingSave(item);
            if (queued) {
                showSaveMessage(getMessage('pendingSaveQueued'), 'success');
            } else {
                showSaveMessage(getMessage('pendingStorageFailed'), 'error');
            }
            return;
        }

        showSaveMessage(`${getMessage('saveFailed')} ${result.data.message || result.data.error || getMessage('unknownError')}`, 'error');
    } finally {
        setSaveBusy(false);
    }
});

// Search
function showSearchStatus(message) {
    searchResults.replaceChildren();
    const status = document.createElement('div');
    status.className = 'text-center text-gray-500 text-xs py-8';
    status.textContent = message;
    searchResults.appendChild(status);
}

searchInput.addEventListener('input', debounce(async (e) => {
    const query = e.target.value.trim();
    if (activeSearchController) {
        activeSearchController.abort();
        activeSearchController = null;
    }

    if (!query) {
        showSearchStatus(getMessage('enterKeyword'));
        return;
    }
    if (query.length < 2) {
        showSearchStatus(getMessage('minSearchChars'));
        return;
    }

    const requestVersion = ++searchRequestVersion;
    const controller = new AbortController();
    activeSearchController = controller;
    showSearchStatus(getMessage('searching'));

    try {
        const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`, {
            credentials: 'include',
            signal: controller.signal,
        });
        if (requestVersion !== searchRequestVersion) return;

        if (res.status === 401) {
            await clearLocalSession();
            showLoginView();
            showLoginError(getMessage('sessionExpired'));
            return;
        }
        if (!res.ok) {
            showSearchStatus(`${getMessage('searchFailed')} (${res.status})`);
            return;
        }

        const data = await responseJson(res);
        renderSearchResults(data.bookmarks || []);
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Search error:', err);
        if (requestVersion === searchRequestVersion) {
            showSearchStatus(getMessage('searchOffline'));
        }
    } finally {
        if (requestVersion === searchRequestVersion) activeSearchController = null;
    }
}, 300));

// View Management
function showSettingsView() {
    settingsView.classList.remove('hidden');
    loginView.classList.add('hidden');
    mainView.classList.add('hidden');
    settingsBtn.classList.add('hidden');
    logoutBtn.classList.add('hidden');
}

function showLoginView() {
    settingsView.classList.add('hidden');
    loginView.classList.remove('hidden');
    mainView.classList.add('hidden');
    settingsBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    loginError.classList.add('hidden');
}

function applyFolderCache(cache, lastFolderId) {
    if (!cache || cache.apiBase !== API_BASE || !Array.isArray(cache.folders)) return false;
    if (Date.now() - cache.cachedAt > FOLDER_CACHE_TTL_MS) return false;

    folders = cache.folders;
    renderFolderSelect(lastFolderId);
    return true;
}

async function loadFolders(lastFolderId) {
    if (!API_BASE) return { state: 'offline' };
    const requestApiBase = API_BASE;
    const requestGeneration = apiBaseGeneration;
    try {
        const res = await fetch(`${requestApiBase}/api/data?includeBookmarks=false`, {
            credentials: 'include'
        });
        if (res.ok) {
            const data = await responseJson(res);
            if (API_BASE !== requestApiBase || apiBaseGeneration !== requestGeneration) {
                return { state: 'superseded' };
            }
            folders = data.folders || [];
            // The cache only improves offline startup. A storage failure must
            // not turn an otherwise successful authenticated folder request
            // into a misleading offline/login failure.
            try {
                await chrome.storage.local.set({
                    folderCache: {
                        apiBase: requestApiBase,
                        folders,
                        cachedAt: Date.now(),
                    },
                });
            } catch (error) {
                console.warn('Failed to persist folder cache:', error);
            }
            if (API_BASE !== requestApiBase || apiBaseGeneration !== requestGeneration) {
                return { state: 'superseded' };
            }
            renderFolderSelect(lastFolderId);
            return { state: 'success' };
        }

        if (API_BASE !== requestApiBase || apiBaseGeneration !== requestGeneration) {
            return { state: 'superseded' };
        }
        console.error('Failed to load folders:', res.status);
        if (res.status === 401) return { state: 'unauthorized' };
        return { state: 'offline', status: res.status };
    } catch (e) {
        if (API_BASE !== requestApiBase || apiBaseGeneration !== requestGeneration) {
            return { state: 'superseded' };
        }
        console.error('Network error loading folders:', e);
        return { state: 'offline' };
    }
}

function revealMainView() {
    settingsView.classList.add('hidden');
    loginView.classList.add('hidden');
    mainView.classList.remove('hidden');
    settingsBtn.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
}

async function showMainView(lastFolderId, cache) {
    mainView.classList.add('hidden');
    const hasCachedFolders = applyFolderCache(cache, lastFolderId);
    if (hasCachedFolders) revealMainView();

    const loadResult = await loadFolders(lastFolderId);
    if (loadResult.state === 'success') {
        revealMainView();
        await flushPendingSaves();
        return;
    }

    if (loadResult.state === 'superseded') return;

    if (loadResult.state === 'unauthorized') {
        await clearLocalSession();
        showLoginView();
        showLoginError(getMessage('sessionExpired'));
        return;
    }

    if (hasCachedFolders) {
        revealMainView();
        showSyncMessage(getMessage('offlineCachedMode'), 'info');
        return;
    }

    showLoginView();
    showLoginError(loadResult.status ? `${getMessage('connectionFailed')} (${loadResult.status})` : getMessage('connectionFailed'));
}

function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('hidden');
}

function switchTab(tab) {
    const saveActive = tab === 'save';
    tabSave.classList.toggle('text-blue-600', saveActive);
    tabSave.classList.toggle('border-b-2', saveActive);
    tabSave.classList.toggle('border-blue-600', saveActive);
    tabSave.classList.toggle('text-gray-500', !saveActive);
    tabSave.setAttribute('aria-selected', String(saveActive));
    tabSave.tabIndex = saveActive ? 0 : -1;

    tabSearch.classList.toggle('text-blue-600', !saveActive);
    tabSearch.classList.toggle('border-b-2', !saveActive);
    tabSearch.classList.toggle('border-blue-600', !saveActive);
    tabSearch.classList.toggle('text-gray-500', saveActive);
    tabSearch.setAttribute('aria-selected', String(!saveActive));
    tabSearch.tabIndex = saveActive ? -1 : 0;

    panelSave.classList.toggle('hidden', !saveActive);
    panelSearch.classList.toggle('hidden', saveActive);
    panelSave.hidden = !saveActive;
    panelSearch.hidden = saveActive;
    if (!saveActive) searchInput.focus();
}

[tabSave, tabSearch].forEach((tabButton) => {
    tabButton.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const nextTab = tabButton === tabSave ? tabSearch : tabSave;
        nextTab.focus();
        switchTab(nextTab === tabSave ? 'save' : 'search');
    });
});


// Simplified Folder Logic to avoid undefined errors if any
function renderFolderSelect(lastFolderId) {
    const container = document.getElementById('folderTreeContainer');
    const trigger = document.getElementById('folderSelectTrigger');
    const hiddenInput = document.getElementById('folderSelect');

    if (!container || !trigger) return;

    container.innerHTML = '';

    trigger.onclick = (e) => {
        e.stopPropagation();
        const isOpen = container.classList.toggle('hidden') === false;
        trigger.setAttribute('aria-expanded', String(isOpen));
        if (isOpen) container.querySelector('[role="treeitem"]')?.focus();
    };

    if (!folderOutsideClickBound) {
        document.addEventListener('click', (e) => {
            if (!container.contains(e.target) && !trigger.contains(e.target)) {
                container.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
            }
        });
        folderOutsideClickBound = true;
    }

    const findFolderName = (targetId) => {
        const f = folders.find(f => f.id.toString() === targetId.toString());
        return f ? f.name : getMessage('selectFolderPlaceholder');
    }

    if (lastFolderId && folders.some((folder) => folder.id.toString() === lastFolderId.toString())) {
        hiddenInput.value = lastFolderId;
        const name = findFolderName(lastFolderId);
        setTriggerText(trigger, name);
    } else {
        hiddenInput.value = '';
        setTriggerText(trigger, getMessage('selectFolderPlaceholder'));
    }

    const buildTree = (parentId, parentEl, level = 1) => {
        const children = folders.filter(f => f.parent_id === parentId)
            .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));

        if (children.length === 0) return;

        children.forEach(folder => {
            const hasChildren = folders.some(f => f.parent_id === folder.id);

            const nodeDiv = document.createElement('div');
            const rowDiv = document.createElement('div');
            rowDiv.className = 'folder-node';
            rowDiv.setAttribute('role', 'treeitem');
            rowDiv.tabIndex = 0;
            rowDiv.setAttribute('aria-selected', String(hiddenInput.value === folder.id.toString()));
            rowDiv.setAttribute('aria-level', String(level));
            if (hiddenInput.value === folder.id.toString()) {
                rowDiv.classList.add('selected');
            }

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'folder-toggle collapsed';
            toggleBtn.setAttribute('aria-label', getMessage('toggleSubfolders'));
            toggleBtn.setAttribute('aria-expanded', 'false');
            if (!hasChildren) toggleBtn.classList.add('invisible');
            toggleBtn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>`;

            const icon = document.createElement('div');
            icon.className = 'folder-icon';
            icon.innerHTML = `<svg fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>`;

            const nameSpan = document.createElement('div');
            nameSpan.className = 'folder-name';
            nameSpan.textContent = folder.name;

            rowDiv.appendChild(toggleBtn);
            rowDiv.appendChild(icon);
            rowDiv.appendChild(nameSpan);
            nodeDiv.appendChild(rowDiv);
            parentEl.appendChild(nodeDiv);

            if (hasChildren) {
                rowDiv.setAttribute('aria-expanded', 'false');
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'folder-children hidden';
                nodeDiv.appendChild(childrenContainer);
                buildTree(folder.id, childrenContainer, level + 1);

                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    const isExpanded = childrenContainer.classList.toggle('hidden') === false;
                    toggleBtn.classList.toggle('collapsed', !isExpanded);
                    toggleBtn.setAttribute('aria-expanded', String(isExpanded));
                    rowDiv.setAttribute('aria-expanded', String(isExpanded));
                };
            }

            const selectFolder = () => {
                hiddenInput.value = folder.id;
                setTriggerText(trigger, folder.name);
                container.classList.add('hidden');
                trigger.setAttribute('aria-expanded', 'false');
                document.querySelectorAll('.folder-node').forEach((el) => {
                    el.classList.remove('selected');
                    el.setAttribute('aria-selected', 'false');
                });
                rowDiv.classList.add('selected');
                rowDiv.setAttribute('aria-selected', 'true');
                trigger.focus();
            };
            rowDiv.onclick = selectFolder;
            rowDiv.onkeydown = (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectFolder();
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const nodes = [...container.querySelectorAll('[role="treeitem"]')];
                    const currentIndex = nodes.indexOf(rowDiv);
                    const nextIndex = event.key === 'ArrowDown'
                        ? Math.min(nodes.length - 1, currentIndex + 1)
                        : Math.max(0, currentIndex - 1);
                    nodes[nextIndex]?.focus();
                }
                if (event.key === 'Escape') {
                    container.classList.add('hidden');
                    trigger.setAttribute('aria-expanded', 'false');
                    trigger.focus();
                }
            };
        });
    };

    buildTree(null, container);
}



function setTriggerText(trigger, text) {
    trigger.textContent = '';
    const span = document.createElement('span');
    span.className = 'truncate';
    span.textContent = text;
    trigger.appendChild(span);
}

function renderSearchResults(bookmarks) {
    searchResults.innerHTML = '';
    if (bookmarks.length === 0) {
        searchResults.textContent = getMessage('noResults');
        searchResults.className = 'text-center text-gray-500 text-xs py-8';
        return;
    }
    searchResults.className = '';

    bookmarks.forEach((bookmark) => {
        let parsedUrl;
        try {
            parsedUrl = new URL(bookmark.url);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) return;
        } catch {
            return;
        }

        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'w-full p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer flex items-center space-x-2.5 transition-colors text-left';

        const icon = document.createElement('div');
        icon.className = 'flex-shrink-0 w-6 h-6 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center overflow-hidden text-xs font-semibold text-gray-500 dark:text-gray-300';
        icon.textContent = (bookmark.title || parsedUrl.hostname).trim().charAt(0).toUpperCase() || '•';

        const text = document.createElement('div');
        text.className = 'flex-1 min-w-0';
        const title = document.createElement('div');
        title.className = 'text-sm text-gray-900 dark:text-gray-200 truncate font-medium';
        title.textContent = bookmark.title || parsedUrl.hostname;
        const url = document.createElement('div');
        url.className = 'text-xs text-gray-500 dark:text-gray-400 truncate';
        url.textContent = bookmark.url;

        text.append(title, url);
        row.append(icon, text);
        row.addEventListener('click', () => chrome.tabs.create({ url: bookmark.url }));
        searchResults.appendChild(row);
    });
}

function showSaveMessage(msg, type) {
    saveMessage.textContent = msg;
    saveMessage.className = `p-2 my-2 rounded text-xs text-center ${type === 'success' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`;
    saveMessage.classList.remove('hidden');
    setTimeout(() => saveMessage.classList.add('hidden'), 3000);
}

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}
