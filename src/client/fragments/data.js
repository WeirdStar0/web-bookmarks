init() {
    if (this.darkMode) document.documentElement.classList.add('dark');
    this.checkAuth();

    this.$watch('currentFolderId', value => { localStorage.setItem('currentFolderId', JSON.stringify(value)); this._sidebarDirty = true; });
    this.$watch('currentView', value => localStorage.setItem('currentView', value));
},

async checkAuth() {
    try {
        await this.loadData();
        if (this.currentView === 'trash') {
            await this.loadTrash();
        }
        this.loggedIn = true;
    } catch (e) {
        this.loggedIn = false;
        if (e.message !== 'Unauthorized') {
            console.error('Auth check failed:', e);
        }
    } finally {
        this.isCheckingAuth = false;
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
    const res = await fetch('/api/data');
    if (res.status === 401) throw new Error('Unauthorized');
    if (!res.ok) {
        throw new Error('Load data failed with status: ' + res.status);
    }
    const data = await res.json();
    this.folders = data.folders;
    this.bookmarks = data.bookmarks;
    this.calculateFolderCounts();
    this._sidebarDirty = true;
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
    // Count direct bookmarks per folder
    const directCounts = {};
    this.bookmarks.forEach(b => {
        if (!b.is_deleted && b.folder_id) {
            directCounts[b.folder_id] = (directCounts[b.folder_id] || 0) + 1;
        }
    });
    // Recursively sum children bookmarks
    const computeTotal = (folderId) => {
        let total = directCounts[folderId] || 0;
        const children = childrenMap[folderId] || [];
        for (const childId of children) {
            total += computeTotal(childId);
        }
        return total;
    };
    this.folders.forEach(f => {
        this.folderCounts[f.id] = computeTotal(f.id);
    });
},

async loadTrash() {
    const res = await fetch('/api/trash');
    if (res.status === 401) throw new Error('Unauthorized');
    const data = await res.json();
    this.trashFolders = data.folders;
    this.trashBookmarks = data.bookmarks;
}
