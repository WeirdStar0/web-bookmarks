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
    try {
        await this.withLoading(async () => {
            await this.apiFetch('/api/logout', { method: 'POST' });
        });
    } catch (e) {
        // Clear local UI state even if the network is unavailable, but make it
        // explicit that server-side session revocation was not confirmed.
        this.showToast(window.translations.toast.operationFailed + ': ' + e.message, 'error');
    } finally {
        this.clearSessionState();
        this.loginForm = { username: '', password: '' };
    }
},

openFolderModal(folder = null) {
    this.rememberModalFocus();
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
        this.closeModal('showFolderModal');
        await this.loadData();
    });
},

deleteFolder(id) {
    this.confirmAndRun(window.translations.modals.confirmDeleteFolderGeneric, async () => {
        await this.deleteAndRefresh('/api/folders/' + id);
    });
},

openBookmarkModal(bookmark = null) {
    this.rememberModalFocus();
    if (bookmark) {
        this.editMode = true;
        this.editingId = bookmark.id;
        this.newBookmarkTitle = bookmark.title;
        this.newBookmarkUrl = bookmark.url;
        this.newBookmarkDescription = bookmark.description || '';
        this.newBookmarkFolderId = bookmark.folder_id;
    } else {
        this.editMode = false;
        this.editingId = null;
        this.newBookmarkTitle = '';
        this.newBookmarkUrl = '';
        this.newBookmarkDescription = '';
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
                description: this.newBookmarkDescription || null,
                folder_id: this.newBookmarkFolderId,
            }, 'PUT');
        } else {
            await this.submitJson('/api/bookmarks', {
                title: this.newBookmarkTitle || this.newBookmarkUrl,
                url: this.newBookmarkUrl,
                description: this.newBookmarkDescription || null,
                folder_id: this.newBookmarkFolderId,
            });
        }
        this.closeModal('showBookmarkModal');
        await this.loadData();
    });
},

deleteBookmark(id) {
    this.confirmAndRun(window.translations.modals.confirmDeleteBookmarkGeneric, async () => {
        await this.deleteAndRefresh('/api/bookmarks/' + id);
    });
},

async restoreFolder(id) {
    try {
        await this.postAndRefresh('/api/restore/folders/' + id, { refreshTrash: true });
        this.showToast(window.translations.toast.restoreSuccess, 'success');
    } catch (e) {
        this.showToast(e.message || 'Error', 'error');
    }
},

async restoreBookmark(id) {
    try {
        await this.postAndRefresh('/api/restore/bookmarks/' + id, { refreshTrash: true });
        this.showToast(window.translations.toast.restoreSuccess, 'success');
    } catch (e) {
        this.showToast(e.message || 'Error', 'error');
    }
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
    this.rememberModalFocus();
    this.settingsForm = { username: '', password: '' };
    this.showSettingsModal = true;
},

    async updateSettings() {
        await this.withLoading(async () => {
            const nextUsername = this.settingsForm.username;
            const nextPassword = this.settingsForm.password;
            const payload = {};
            if (nextUsername) payload.username = nextUsername;
            if (nextPassword) payload.password = nextPassword;
            if (Object.keys(payload).length === 0) {
                this.showToast(window.translations.toast.operationFailed, 'error');
                return;
            }
            const credentialsChanged = Boolean(nextUsername || nextPassword);
            try {
                await this.submitJson('/api/settings', payload, 'PUT');
                this.closeModal('showSettingsModal');
                this.settingsForm = { username: '', password: '' };
                this.showToast(window.translations.toast.settingsUpdated, 'success');

                // The server rotates session_version when account credentials
                // change, so the current Cookie is intentionally no longer
                // authorized. Reflect that immediately instead of leaving the
                // dashboard visible until its next API call fails.
                if (credentialsChanged) {
                    this.handleUnauthorized();
                    this.loginForm = { username: nextUsername || '', password: '' };
                }
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
    this.rememberModalFocus();
    this.confirmMessage = message;
    this.confirmCallback = callback;
    this.showConfirmModal = true;
},

async executeConfirm() {
    const callback = this.confirmCallback;
    this.confirmCallback = null;
    this.closeModal('showConfirmModal');
    if (!callback) return;

    try {
        await callback();
    } catch (e) {
        this.showToast(window.translations.toast.operationFailed + ': ' + e.message, 'error');
    }
}
