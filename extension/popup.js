// State
let API_BASE = '';
let token = null;
let folders = [];
let currentMessages = null; // Store loaded translations

// DOM Elements
const app = document.getElementById('app');
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
const folderSelect = document.getElementById('folderSelect');
const saveMessage = document.getElementById('saveMessage');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');


// Helper to get message (Custom Locale > Browser Locale)
function getMessage(key) {
    if (currentMessages && currentMessages[key]) {
        return currentMessages[key].message;
    }
    return chrome.i18n.getMessage(key);
}

// Helper to getting storage (Promisify if needed or handle callback)
function getStorage(keys) {
    return new Promise((resolve) => {
        try {
            const result = chrome.storage.local.get(keys);
            if (result && typeof result.then === 'function') {
                // It returned a promise (Chrome MV3)
                result.then(resolve);
            } else {
                // It used specific callback (Firefox chrome.* or older Chrome)
                chrome.storage.local.get(keys, resolve);
            }
        } catch (e) {
            // Fallback for Firefox if synchronous return fails immediately
            chrome.storage.local.get(keys, resolve);
        }
    });
}

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    // Load config
    const config = await getStorage(['apiBase', 'token', 'lastFolderId', 'theme', 'lang']);

    // Initialize Translations
    await loadTranslations(config.lang);
    localizeDom();

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

    if (config.apiBase) {
        API_BASE = config.apiBase;
        serverUrlInput.value = API_BASE;

        if (config.token) {
            token = config.token;
            showMainView(config.lastFolderId);
        } else {
            showLoginView();
        }
    } else {
        showSettingsView();
    }

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
    let url = serverUrlInput.value.trim();
    if (url.endsWith('/')) url = url.slice(0, -1);
    if (!url) return;

    API_BASE = url;
    await chrome.storage.local.set({ apiBase: url });
    token = null;
    await chrome.storage.local.remove(['token']);
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

        if (res.ok) {
            const data = await res.json();
            if (data.success) {
                await chrome.storage.local.set({ token: 'logged_in' });
                token = 'logged_in';
                showMainView();
            } else {
                showLoginError(getMessage('loginFailed') + (data.error || getMessage('unknownError')));
            }
        } else {
            showLoginError(getMessage('loginFailed') + res.status);
        }
    } catch (err) {
        showLoginError(getMessage('connectionFailed'));
    }
});

logoutBtn.addEventListener('click', async () => {
    try {
        await fetch(`${API_BASE}/api/logout`, { method: 'POST', credentials: 'include' });
    } catch (e) { }
    await chrome.storage.local.remove(['token']);
    token = null;
    showLoginView();
});

// Tab Events
tabSave.addEventListener('click', () => switchTab('save'));
tabSearch.addEventListener('click', () => switchTab('search'));

// Save Bookmark
saveForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('bookmarkTitle').value;
    const url = document.getElementById('bookmarkUrl').value;
    const description = document.getElementById('bookmarkDescription').value;
    const folderId = document.getElementById('folderSelect').value;

    if (!folderId) {
        showSaveMessage(getMessage('pleaseSelectFolder'), 'error');
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/bookmarks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, url, description, folder_id: parseInt(folderId) }),
            credentials: 'include'
        });

        if (res.ok) {
            await chrome.storage.local.set({ lastFolderId: folderId });
            showSaveMessage(getMessage('saveSuccess'), 'success');
            setTimeout(() => window.close(), 1000);
        } else {
            const data = await res.json();
            showSaveMessage(getMessage('saveFailed') + (data.error || getMessage('unknownError')), 'error');
        }
    } catch (err) {
        showSaveMessage(getMessage('networkError'), 'error');
    }
});

// Search
searchInput.addEventListener('input', debounce(async (e) => {
    const query = e.target.value.trim();
    if (!query) {
        searchResults.innerHTML = `<div class="text-center text-gray-500 text-xs py-8">${getMessage('enterKeyword')}</div>`;
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            renderSearchResults(data.bookmarks || []);
        }
    } catch (err) {
        console.error('Search error:', err);
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

async function loadFolders(lastFolderId) {
    if (!API_BASE) return;
    try {
        const res = await fetch(`${API_BASE}/api/data`, {
            credentials: 'include'
        });
        if (res.ok) {
            const data = await res.json();
            folders = data.folders || [];
            renderFolderSelect(lastFolderId);
        } else {
            console.error('Failed to load folders:', res.status);
            if (res.status === 401) {
                token = null;
                await chrome.storage.local.remove(['token']);
                showLoginView();
            }
        }
    } catch (e) {
        console.error('Network error loading folders:', e);
    }
}

async function showMainView(lastFolderId) {
    settingsView.classList.add('hidden');
    loginView.classList.add('hidden');
    mainView.classList.remove('hidden');
    settingsBtn.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    await loadFolders(lastFolderId);
}

function showLoginError(msg) {
    loginError.textContent = msg;
    loginError.classList.remove('hidden');
}

function switchTab(tab) {
    if (tab === 'save') {
        tabSave.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
        tabSave.classList.remove('text-gray-500');
        tabSearch.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
        tabSearch.classList.add('text-gray-500');
        panelSave.classList.remove('hidden');
        panelSearch.classList.add('hidden');
    } else {
        tabSearch.classList.add('text-blue-600', 'border-b-2', 'border-blue-600');
        tabSearch.classList.remove('text-gray-500');
        tabSave.classList.remove('text-blue-600', 'border-b-2', 'border-blue-600');
        tabSave.classList.add('text-gray-500');
        panelSearch.classList.remove('hidden');
        panelSave.classList.add('hidden');
        searchInput.focus();
    }
}


// Simplified Folder Logic to avoid undefined errors if any
function renderFolderSelect(lastFolderId) {
    const container = document.getElementById('folderTreeContainer');
    const trigger = document.getElementById('folderSelectTrigger');
    const hiddenInput = document.getElementById('folderSelect');

    if (!container || !trigger) return;

    container.innerHTML = '';

    trigger.onclick = (e) => {
        e.stopPropagation();
        container.classList.toggle('hidden');
    };

    document.addEventListener('click', (e) => {
        if (!container.contains(e.target) && !trigger.contains(e.target)) {
            container.classList.add('hidden');
        }
    });

    const findFolderName = (targetId) => {
        const f = folders.find(f => f.id.toString() === targetId.toString());
        return f ? f.name : getMessage('selectFolderPlaceholder');
    }

    if (lastFolderId) {
        hiddenInput.value = lastFolderId;
        const name = findFolderName(lastFolderId);
        trigger.innerHTML = `<span class="truncate">${name}</span>`;
    }

    const buildTree = (parentId, parentEl) => {
        const children = folders.filter(f => f.parent_id === parentId)
            .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));

        if (children.length === 0) return;

        children.forEach(folder => {
            const hasChildren = folders.some(f => f.parent_id === folder.id);

            const nodeDiv = document.createElement('div');
            const rowDiv = document.createElement('div');
            rowDiv.className = 'folder-node';
            if (hiddenInput.value === folder.id.toString()) {
                rowDiv.classList.add('selected');
            }

            const toggleBtn = document.createElement('div');
            toggleBtn.className = 'folder-toggle collapsed';
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
                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'folder-children hidden';
                nodeDiv.appendChild(childrenContainer);
                buildTree(folder.id, childrenContainer);

                toggleBtn.onclick = (e) => {
                    e.stopPropagation();
                    childrenContainer.classList.toggle('hidden');
                    toggleBtn.classList.toggle('collapsed');
                };
            }

            rowDiv.onclick = (e) => {
                hiddenInput.value = folder.id;
                trigger.innerHTML = `<span class="truncate">${folder.name}</span>`;
                container.classList.add('hidden');
                document.querySelectorAll('.folder-node').forEach(el => el.classList.remove('selected'));
                rowDiv.classList.add('selected');
            };
        });
    };

    buildTree(null, container);
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderSearchResults(bookmarks) {
    searchResults.innerHTML = '';
    if (bookmarks.length === 0) {
        searchResults.innerHTML = `<div class="text-center text-gray-500 text-xs py-8">${getMessage('noResults')}</div>`;
        return;
    }
    bookmarks.forEach(bookmark => {
        const div = document.createElement('div');
        div.className = 'p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded cursor-pointer flex items-center space-x-2.5 transition-colors';

        // Use Google Favicon Service
        const faviconUrl = `https://www.google.com/s2/favicons?domain=${escapeHtml(new URL(bookmark.url).hostname)}&sz=32`;

        div.innerHTML = `
        <div class="flex-shrink-0 w-6 h-6 bg-gray-100 dark:bg-gray-800 rounded flex items-center justify-center overflow-hidden">
            <img src="${faviconUrl}" class="w-4 h-4" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22currentColor%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z%22></path></svg>'">
        </div>
        <div class="flex-1 min-w-0">
            <div class="text-sm text-gray-900 dark:text-gray-200 truncate font-medium">${escapeHtml(bookmark.title)}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 truncate">${escapeHtml(bookmark.url)}</div>
        </div>
    `;
        div.addEventListener('click', () => {
            chrome.tabs.create({ url: bookmark.url });
        });
        searchResults.appendChild(div);
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
