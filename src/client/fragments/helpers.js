clearSessionState() {
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

async apiFetch(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const response = await fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout));
    if (!response.ok) {
        if (response.status === 401) {
            this.handleUnauthorized();
            throw new Error('Unauthorized');
        }
        let message = 'Request failed with status: ' + response.status;
        try {
            const text = await response.text();
            if (text) {
                try {
                    const data = JSON.parse(text);
                    if (data && typeof data.error === 'string' && data.error) {
                        message = data.error;
                    } else if (data && typeof data.message === 'string' && data.message) {
                        message = data.message;
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
