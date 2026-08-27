clearSessionState() {
    this._dataLoadVersion++;
    this._searchRequestVersion++;
    this.clearFolderLoading();
    this.loggedIn = false;
    this.folders = [];
    this.bookmarks = [];
    this.trashFolders = [];
    this.trashBookmarks = [];
},

handleUnauthorized() {
    this.clearSessionState();
    this.loginError = '';
},

clearFolderLoading() {
    if (this._folderLoadingTimer) {
        clearTimeout(this._folderLoadingTimer);
        this._folderLoadingTimer = null;
    }
    this.isFolderLoading = false;
},

async apiFetch(url, options = {}) {
    const { shouldHandleUnauthorized, ...requestOptions } = options;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(url, { ...requestOptions, signal: controller.signal }).finally(() => clearTimeout(timeout));
    if (!response.ok) {
        if (response.status === 401) {
            // A response from an older load must not clear a session that
            // a later request has already established or refreshed.
            if (typeof shouldHandleUnauthorized !== 'function' || shouldHandleUnauthorized()) {
                this.handleUnauthorized();
            }
            throw new Error('Unauthorized');
        }
        let message = 'Request failed with status: ' + response.status;
        try {
            const text = await response.text();
            if (text) {
                try {
                    const data = JSON.parse(text);
                    if (data && typeof data.message === 'string' && data.message) {
                        message = data.message;
                    } else if (data && typeof data.error === 'string' && data.error) {
                        message = data.error;
                    }
                } catch {
                    message = text;
                }
            }
        } catch {
            // Keep the status-based fallback when the body is unreadable.
        }
        throw new Error(message);
    }
    return response;
},

async runAndRefresh(fn, { refreshTrash = false } = {}) {
    await this.withLoading(async () => {
        await fn();
        if (refreshTrash) {
            await this.loadTrash();
        }
        await this.loadData();
    });
},

rememberModalFocus() {
    const active = document.activeElement;
    this._modalReturnFocus = active && typeof active.focus === 'function' ? active : null;
},

closeModal(property) {
    this[property] = false;
    this.selectorOpen = false;
    this.selectorQuery = '';
    const previous = this._modalReturnFocus;
    this._modalReturnFocus = null;
    if (previous && previous.isConnected) {
        setTimeout(() => previous.focus(), 0);
    }
},

confirmAndRun(message, callback) {
    this.confirmAction(message, async () => {
        await callback();
    });
},

async submitJson(url, payload, method = 'POST') {
    return this.apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
},

async deleteAndRefresh(url, options = {}) {
    await this.runAndRefresh(async () => {
        await this.apiFetch(url, { method: 'DELETE' });
    }, options);
},

async postAndRefresh(url, options = {}) {
    await this.runAndRefresh(async () => {
        await this.apiFetch(url, { method: 'POST' });
    }, options);
}
