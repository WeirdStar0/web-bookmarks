init() {
    if (this.darkMode) document.documentElement.classList.add('dark');
    this.checkAuth();

    this.$watch('currentFolderId', value => {
        localStorage.setItem('currentFolderId', JSON.stringify(value));
        this._sidebarDirty = true;
        if (this.loggedIn && this.currentView === 'home' && !this.searchQuery) {
            void this.loadData();
        }
    });
    this.$watch('currentView', value => {
        localStorage.setItem('currentView', value);
        this.scheduleSearch();
        if (this.loggedIn && value === 'home' && !this.searchQuery) {
            void this.loadData();
        }
    });
    this.$watch('searchQuery', () => this.scheduleSearch());
},

async checkAuth() {
    const authCheckVersion = ++this._authCheckVersion;
    const wasLoggedIn = this.loggedIn;
    try {
        await this.loadData();
        if (this.currentView === 'trash') {
            await this.loadTrash();
        }
        if (authCheckVersion !== this._authCheckVersion) return;
        this.loggedIn = true;
    } catch (e) {
        // A 401 is a definitive session transition only for the newest auth
        // check. A stale load may throw after apiFetch intentionally declined
        // to clear a fresher session, so it must not change UI state here.
        if (authCheckVersion !== this._authCheckVersion) return;
        if (e.message === 'Unauthorized') {
            this.loggedIn = false;
        } else {
            if (!wasLoggedIn) this.loggedIn = false;
            console.error('Auth check failed:', e);
        }
    } finally {
        if (authCheckVersion === this._authCheckVersion) {
            this.isCheckingAuth = false;
        }
    }
},

async withLoading(fn) {
    if (this.isOperationPending) return;
    this.isOperationPending = true;
    this.isLoading = true;
    this.loadingText = window.translations.toast.processing;
    try {
        await fn();
    } finally {
        this.isOperationPending = false;
        this.isLoading = false;
    }
},

async loadData() {
    const requestVersion = ++this._dataLoadVersion;
    const folderId = this.currentFolderId;
    const isFolderNavigation = this.loggedIn && this.currentView === 'home' && !this.searchQuery;
    const folderQuery = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';

    if (isFolderNavigation) this.isFolderLoading = true;

    try {
        const res = await this.apiFetch('/api/data' + folderQuery, {
            shouldHandleUnauthorized: () => requestVersion === this._dataLoadVersion,
        });
        let data;
        try {
            data = await res.json();
        } catch {
            throw new Error('Invalid data response');
        }
        if (!Array.isArray(data?.folders) || !Array.isArray(data?.bookmarks)) {
            throw new Error('Invalid data response');
        }
        if (requestVersion !== this._dataLoadVersion) return false;
        this.folders = data.folders;
        this.bookmarks = data.bookmarks;
        this.bookmarkCounts = data.bookmarkCounts && typeof data.bookmarkCounts === 'object' ? data.bookmarkCounts : {};
        this.searchResults = null;
        this.calculateFolderCounts();
        this._sidebarDirty = true;
        this._loadedFolderId = folderId;
        return true;
    } catch (error) {
        if (!isFolderNavigation) throw error;
        if (requestVersion !== this._dataLoadVersion) return false;
        if (error?.message !== 'Unauthorized') {
            console.error('Folder data load failed:', error);
            this.showToast(error?.message || window.translations.toast.networkError, 'error');
            if (this.currentFolderId === folderId && this.currentFolderId !== this._loadedFolderId) {
                this.currentFolderId = this._loadedFolderId;
            }
        }
        return false;
    } finally {
        if (isFolderNavigation && requestVersion === this._dataLoadVersion) {
            this.isFolderLoading = false;
        }
    }
},

scheduleSearch() {
    if (this._searchTimer) {
        clearTimeout(this._searchTimer);
        this._searchTimer = null;
    }

    const query = this.searchQuery.trim();
    this.searchResults = null;
    if (!query || this.currentView === 'trash') {
        this.searchPending = false;
        this._searchRequestVersion++;
        return;
    }

    this.searchPending = true;
    const requestVersion = ++this._searchRequestVersion;
    this._searchTimer = setTimeout(() => {
        this.loadSearchResults(query, requestVersion);
    }, 250);
},

async loadSearchResults(query, requestVersion) {
    try {
        const res = await this.apiFetch('/api/search?q=' + encodeURIComponent(query), {
            shouldHandleUnauthorized: () => requestVersion === this._searchRequestVersion,
        });
        const data = await res.json();
        if (!Array.isArray(data?.folders) || !Array.isArray(data?.bookmarks)) {
            throw new Error('Invalid search response');
        }
        if (requestVersion !== this._searchRequestVersion || query !== this.searchQuery.trim()) return;
        this.searchResults = { folders: data.folders, bookmarks: data.bookmarks };
    } catch (error) {
        if (requestVersion !== this._searchRequestVersion) return;
        if (error.message !== 'Unauthorized') {
            console.error('Search failed:', error);
            this.showToast(error.message || window.translations.toast.networkError, 'error');
        }
    } finally {
        if (requestVersion === this._searchRequestVersion) {
            this.searchPending = false;
            this._searchTimer = null;
        }
    }
},

calculateFolderCounts() {
    this.folderCounts = {};
    // Precompute parent→children map
    const childrenMap = {};
    this.folders.forEach(f => {
        const pid = f.parent_id;
        if (!childrenMap[pid]) childrenMap[pid] = [];
        childrenMap[pid].push(f.id);
    });
    // The API returns direct counts for the whole library even when the
    // current folder's bookmark list is loaded lazily.
    const directCounts = { ...this.bookmarkCounts };
    this.bookmarks.forEach(b => {
        if (!b.is_deleted && b.folder_id) {
            const key = String(b.folder_id);
            if (!Object.prototype.hasOwnProperty.call(directCounts, key)) {
                directCounts[key] = (directCounts[key] || 0) + 1;
            }
        }
    });
    // Memoize subtree totals so each folder is evaluated at most once. The
    // visited set also prevents a legacy/corrupted cyclic hierarchy from
    // causing unbounded client-side recursion.
    const computeTotal = (folderId, visiting = new Set()) => {
        if (Object.prototype.hasOwnProperty.call(this.folderCounts, folderId)) {
            return this.folderCounts[folderId];
        }
        if (visiting.has(folderId)) return 0;

        visiting.add(folderId);
        let total = directCounts[String(folderId)] || 0;
        const children = childrenMap[folderId] || [];
        for (const childId of children) {
            total += computeTotal(childId, visiting);
        }
        visiting.delete(folderId);
        this.folderCounts[folderId] = total;
        return total;
    };
    this.folders.forEach(f => {
        computeTotal(f.id);
    });
},

async loadTrash() {
    const requestVersion = ++this._trashLoadVersion;
    const res = await this.apiFetch('/api/trash', {
        shouldHandleUnauthorized: () => requestVersion === this._trashLoadVersion,
    });
    let data;
    try {
        data = await res.json();
    } catch {
        throw new Error('Invalid trash response');
    }
    if (!Array.isArray(data?.folders) || !Array.isArray(data?.bookmarks)) {
        throw new Error('Invalid trash response');
    }
    if (requestVersion !== this._trashLoadVersion) return false;
    this.trashFolders = data.folders;
    this.trashBookmarks = data.bookmarks;
    return true;
}
