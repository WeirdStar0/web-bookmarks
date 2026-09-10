/**
 * Restrict a stored bookmark URL to http(s) before it reaches an href.
 *
 * Write paths already validate the protocol with zod, but rows created by
 * legacy versions or direct SQL writes can still hold `javascript:` and
 * similar schemes, so the href binding filters again as defense in depth.
 * This keeps the dashboard consistent with the export path and the
 * extension, which both apply the same allowlist.
 *
 * The original string is returned verbatim on success so no normalization
 * side effects are introduced into existing links. This is deliberately a
 * pure function: it is evaluated by three separate Alpine bindings per row
 * and must never write to `this`, since mutating the reactive proxy during
 * effect evaluation risks a re-render loop. One URL parse per call is well
 * under a millisecond even for a four-digit bookmark count.
 */
safeBookmarkUrl(url) {
    const raw = String(url ?? '');
    try {
        const parsed = new URL(raw);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : '#';
    } catch {
        // Relative, empty, or otherwise unparseable values cannot be proven
        // safe, so they render inert rather than inheriting the page origin.
        return '#';
    }
},

get currentFolders() {
    if (this.currentView === 'trash') {
        return this.trashFolders.filter(f => f.name.toLowerCase().includes(this.searchQuery.toLowerCase()));
    }
    let items = this.folders.filter(f => f.parent_id === this.currentFolderId);
    if (this.searchQuery) {
        if (this.searchResults) return this.searchResults.folders;
        items = this.folders.filter(f => f.name.toLowerCase().includes(this.searchQuery.toLowerCase()));
    }
    return items;
},

get currentBookmarks() {
    if (this.currentView === 'trash') {
        return this.trashBookmarks.filter(b => b.title.toLowerCase().includes(this.searchQuery.toLowerCase()) || b.url.toLowerCase().includes(this.searchQuery.toLowerCase()));
    }
    let items = this.bookmarks.filter(b => b.folder_id === this.currentFolderId);
    if (this.searchQuery) {
        if (this.searchResults) return this.searchResults.bookmarks;
        items = this.bookmarks.filter(b => b.title.toLowerCase().includes(this.searchQuery.toLowerCase()) || b.url.toLowerCase().includes(this.searchQuery.toLowerCase()));
    }
    return items;
},

get breadcrumbs() {
    const crumbs = [];
    // Unlike tree building, this walks upward from the selected folder, so a
    // parent_id cycle in legacy rows (migration 007 only blocks new ones)
    // would spin forever without the visited guard.
    const visited = new Set();
    let currentId = this.currentFolderId;
    while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const folder = this.folders.find(f => f.id === currentId);
        if (folder) {
            crumbs.unshift(folder);
            currentId = folder.parent_id;
        } else {
            break;
        }
    }
    return crumbs;
},

get rootFolders() {
    return this.folders.filter(f => !f.parent_id);
},

getChildFolders(parentId) {
    return this.folders.filter(f => f.parent_id === parentId);
},

getFolderBookmarkCount(folderId) {
    return this.folderCounts[folderId] || 0;
},

/**
 * Flat render list for the sidebar tree. Alpine's CSP build has no x-html,
 * so the sidebar renders through x-for: the tree is flattened into the rows
 * that are currently visible (collapsed subtrees are simply absent). The
 * visited set keeps the walk finite if legacy rows contain a parent_id
 * cycle (migration 007 only blocks new ones).
 */
get sidebarFolders() {
    const rows = [];
    const visited = new Set();
    const walk = (parentId, level) => {
        const children = this.folders
            .filter(f => f.parent_id === parentId && !visited.has(f.id))
            .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
        for (const folder of children) {
            visited.add(folder.id);
            rows.push({
                id: folder.id,
                name: folder.name,
                paddingLeft: level * 16 + 8,
                hasChildren: this.folders.some(f => f.parent_id === folder.id),
                bookmarkCount: this.getFolderBookmarkCount(folder.id),
            });
            if (this.expandedFolders[folder.id]) {
                walk(folder.id, level + 1);
            }
        }
    };
    walk(null, 0);
    return rows;
},

selectSidebarFolder(id) {
    this.currentFolderId = id;
    this.currentView = 'home';
    this.mobileMenuOpen = false;
},

openFolderIfHome(folder) {
    if (!this.isSorting && this.currentView === 'home') {
        this.currentFolderId = folder.id;
    }
},

folderSubtitle(folder) {
    if (this.currentView !== 'home') {
        return window.translations?.dashboard?.deleted ?? 'Deleted';
    }
    const childCount = this.folders.filter(f => f.parent_id === folder.id).length;
    const labels = window.translations?.dashboard;
    return childCount + ' ' + (labels?.folders ?? 'folders') + ', '
        + this.getFolderBookmarkCount(folder.id) + ' ' + (labels?.bookmarks ?? 'bookmarks');
},

folderCardClasses(folder) {
    const classes = [];
    if (this.draggedItem?.type === 'folder' && this.draggedItem?.id === folder.id) {
        classes.push('opacity-40 scale-95 shadow-lg');
    }
    if (this.dropTarget?.type === 'folder' && this.dropTarget?.id === folder.id) {
        classes.push('border-blue-500 shadow-lg shadow-blue-500/20 bg-blue-50 dark:bg-blue-900/20');
    }
    if (this.isSorting && this.currentView === 'home' && !this.searchQuery) {
        classes.push('cursor-grab active:cursor-grabbing');
    } else if (!this.isSorting && this.currentView === 'home') {
        classes.push('cursor-pointer');
    }
    return classes.join(' ');
},

bookmarkCardClasses(bookmark) {
    const classes = [];
    if (this.draggedItem?.type === 'bookmark' && this.draggedItem?.id === bookmark.id) {
        classes.push('opacity-40 scale-95 shadow-lg');
    }
    if (this.dropTarget?.type === 'bookmark' && this.dropTarget?.id === bookmark.id) {
        classes.push('border-blue-500 shadow-lg shadow-blue-500/20 bg-blue-50 dark:bg-blue-900/20');
    }
    if (this.isSorting && this.currentView === 'home' && !this.searchQuery) {
        classes.push('cursor-grab active:cursor-grabbing');
    }
    return classes.join(' ');
},

getFolderName(id) {
    if (!id) return window.translations?.modals?.rootFolder ?? 'Root';
    const folder = this.folders.find(f => f.id === id);
    return folder ? folder.name : (window.translations?.modals?.unknownFolder ?? 'Unknown');
},

/**
 * Option lists for the two folder pickers. Alpine's CSP build has no
 * x-html, so the pickers render through x-for over plain option objects;
 * names reach the DOM only via x-text, which escapes them. Each picker has
 * its own getter so it renders from its own target field
 * ('newFolderParentId' for the folder modal, 'newBookmarkFolderId' for the
 * bookmark modal) and the two stay independent even when both modals are
 * open.
 */
get folderModalSelectorOptions() {
    return this.buildSelectorOptions(this.editingId);
},

get bookmarkModalSelectorOptions() {
    return this.buildSelectorOptions(null);
},

buildSelectorOptions(editingId) {
    const query = (this.selectorQuery || '').trim().toLowerCase();

    // `editingId` is constant for one render, so resolve the folders that
    // cannot act as a parent once (the folder itself plus its whole subtree)
    // instead of walking the ancestor chain again for every row. The stack
    // carries its own visited set, so a legacy hierarchy containing a cycle
    // terminates instead of looping forever.
    const forbiddenParents = new Set();
    if (editingId !== null && editingId !== undefined) {
        forbiddenParents.add(editingId);
        const stack = [editingId];
        while (stack.length > 0) {
            const currentId = stack.pop();
            for (const folder of this.folders) {
                if (folder.parent_id === currentId && !forbiddenParents.has(folder.id)) {
                    forbiddenParents.add(folder.id);
                    stack.push(folder.id);
                }
            }
        }
    }

    // Guard against cycles rather than relying on the current data model.
    // With a single parent pointer a cycle has no `parent_id = null` entry
    // point, so a walk from the root cannot reach it today; the visited set
    // keeps that property from silently mattering if it ever stops holding.
    const visited = new Set();
    const build = (parentId, depth) => {
        const children = this.folders
            .filter(f => f.parent_id === parentId && !visited.has(f.id))
            .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
        const rows = [];
        for (const folder of children) {
            visited.add(folder.id);
            const childRows = build(folder.id, depth + 1);
            const matches = !query || folder.name.toLowerCase().includes(query);
            // Keep an ancestor row when the query matches one of its
            // descendants so the path to the match stays readable.
            if (!matches && childRows.length === 0) continue;
            rows.push({
                id: folder.id,
                name: folder.name,
                paddingLeft: 16 + depth * 16,
                selectable: editingId === null || editingId === undefined || !forbiddenParents.has(folder.id),
            });
            for (const child of childRows) rows.push(child);
        }
        return rows;
    };

    return build(null, 0);
},

selectFolderOption(targetField, folderId) {
    this[targetField] = folderId;
    this.selectorOpen = false;
    this.selectorQuery = '';
},

selectRootFolderOption(targetField) {
    this[targetField] = null;
    this.selectorOpen = false;
    this.selectorQuery = '';
},

triggerImportClick() {
    this.$refs.importInput.click();
},

toggleFolder(id) {
    this.expandedFolders[id] = !this.expandedFolders[id];
}
