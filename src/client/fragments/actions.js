async login() {
    this.isLoading = true;
    this.loadingText = window.translations.toast.loggingIn;
    try {
        const res = await this.submitJson('/api/login', this.loginForm);
        this.loggedIn = true;
        this.loginError = '';
        await this.loadData();
    } catch (e) {
        this.loggedIn = false;
        this.loginError = e.message || window.translations.toast.loginFailed;
    } finally {
        this.isLoading = false;
    }
},

async logout() {
    await this.withLoading(async () => {
        await fetch('/api/logout', { method: 'POST' });
        this.clearSessionState();
        this.loginForm = { username: '', password: '' };
    });
},

openFolderModal(folder = null) {
    if (folder) {
        this.editMode = true;
        this.editingId = folder.id;
        this.newFolderName = folder.name;
        this.newFolderParentId = folder.parent_id;
    } else {
        this.editMode = false;
        this.editingId = null;
        this.newFolderName = '';
        this.newFolderParentId = this.currentFolderId;
    }
    this.selectorExpanded = {};
    this.selectorOpen = false;
    this.showFolderModal = true;
},

async createFolder() {
    if (!this.newFolderName) return;

    await this.withLoading(async () => {
        if (this.editMode) {
            await this.submitJson('/api/folders/' + this.editingId, { name: this.newFolderName, parent_id: this.newFolderParentId }, 'PUT');
        } else {
            await this.submitJson('/api/folders', { name: this.newFolderName, parent_id: this.newFolderParentId });
        }
        this.showFolderModal = false;
        await this.loadData();
    });
},

deleteFolder(id) {
    this.confirmAndRun(window.translations.modals.confirmDeleteFolderGeneric, async () => {
        await this.deleteAndRefresh('/api/folders/' + id);
    });
},

openBookmarkModal(bookmark = null) {
    if (bookmark) {
        this.editMode = true;
        this.editingId = bookmark.id;
        this.newBookmarkTitle = bookmark.title;
        this.newBookmarkUrl = bookmark.url;
        this.newBookmarkFolderId = bookmark.folder_id;
    } else {
        this.editMode = false;
        this.editingId = null;
        this.newBookmarkTitle = '';
        this.newBookmarkUrl = '';
        this.newBookmarkFolderId = this.currentFolderId;
    }
    this.selectorExpanded = {};
    this.selectorOpen = false;
    this.showBookmarkModal = true;
},

async createBookmark() {
    if (!this.newBookmarkUrl) return;

    await this.withLoading(async () => {
        if (this.editMode) {
            await this.submitJson('/api/bookmarks/' + this.editingId, {
                title: this.newBookmarkTitle || this.newBookmarkUrl,
                url: this.newBookmarkUrl,
                folder_id: this.newBookmarkFolderId,
            }, 'PUT');
        } else {
            await this.submitJson('/api/bookmarks', {
                title: this.newBookmarkTitle || this.newBookmarkUrl,
                url: this.newBookmarkUrl,
                folder_id: this.newBookmarkFolderId,
            });
        }
        this.showBookmarkModal = false;
        await this.loadData();
    });
},

deleteBookmark(id) {
    this.confirmAndRun(window.translations.modals.confirmDeleteBookmarkGeneric, async () => {
        await this.deleteAndRefresh('/api/bookmarks/' + id);
    });
},

async restoreFolder(id) {
    await this.postAndRefresh('/api/restore/folders/' + id, { refreshTrash: true });
},

async restoreBookmark(id) {
    await this.postAndRefresh('/api/restore/bookmarks/' + id, { refreshTrash: true });
},

permanentDeleteFolder(id) {
    this.confirmAndRun(window.translations.modals.confirmPermanentDeleteFolder, async () => {
        await this.withLoading(async () => {
            await this.apiFetch('/api/trash/folders/' + id, { method: 'DELETE' });
            await this.loadTrash();
        });
    });
},

permanentDeleteBookmark(id) {
    this.confirmAndRun(window.translations.modals.confirmPermanentDeleteBookmark, async () => {
        await this.withLoading(async () => {
            await this.apiFetch('/api/trash/bookmarks/' + id, { method: 'DELETE' });
            await this.loadTrash();
        });
    });
},

emptyTrash() {
    this.confirmAndRun(window.translations.modals.confirmEmptyTrashGeneric, async () => {
        await this.withLoading(async () => {
            await this.apiFetch('/api/trash/empty', { method: 'DELETE' });
            await this.loadTrash();
        });
    });
},

openSettingsModal() {
    this.settingsForm = { username: '', password: '' };
    this.showSettingsModal = true;
},

async updateSettings() {
    await this.withLoading(async () => {
        try {
            await this.submitJson('/api/settings', this.settingsForm, 'PUT');
            this.showSettingsModal = false;
            this.showToast(window.translations.toast.settingsUpdated, 'success');
        } catch (e) {
            this.showToast(e.message || window.translations.toast.updateFailed, 'error');
        }
    });
},

toggleDarkMode() {
    this.darkMode = !this.darkMode;
    localStorage.setItem('darkMode', this.darkMode);
    if (this.darkMode) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
},

toggleSorting() {
    this.isSorting = !this.isSorting;
},

setLanguage(lang) {
    document.cookie = 'locale=' + lang + '; path=/; max-age=31536000';
    window.location.reload();
},

showToast(message, type = 'success') {
    this.toast = { show: true, message, type };
    setTimeout(() => {
        this.toast.show = false;
    }, 3000);
},

confirmAction(message, callback) {
    this.confirmMessage = message;
    this.confirmCallback = callback;
    this.showConfirmModal = true;
},

executeConfirm() {
    if (this.confirmCallback) {
        this.confirmCallback();
    }
    this.showConfirmModal = false;
}
