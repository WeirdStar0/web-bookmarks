escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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
    let currentId = this.currentFolderId;
    while (currentId) {
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

get flattenedFolders() {
    const buildHierarchy = (parentId = null, level = 0) => {
        const children = this.folders.filter(f => f.parent_id === parentId);
        children.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));

        let result = [];
        for (const child of children) {
            result.push({
                ...child,
                level: level,
            });
            result = result.concat(buildHierarchy(child.id, level + 1));
        }
        return result;
    };
    return buildHierarchy(null, 0);
},

get sidebarHtml() {
    if (!this._sidebarDirty && this._sidebarCache !== null) {
        return this._sidebarCache;
    }

    const renderFolder = (folder, level = 0) => {
        const isExpanded = this.expandedFolders[folder.id];
        const isSelected = this.currentFolderId === folder.id;
        const hasChildren = this.folders.some(f => f.parent_id === folder.id);
        const paddingLeft = level * 16 + 8;

        const selectedClass = isSelected ? 'bg-gray-100 dark:bg-gray-700' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700';
        const expandedClass = isExpanded ? 'rotate-90' : '';
        const invisibleClass = !hasChildren ? 'invisible' : '';

        let html = '<div class="select-none sidebar-folder-item" data-folder-id="' + folder.id + '">';
        html += '<div class="w-full flex items-center py-1.5 rounded-md text-sm transition-all duration-200 ' + selectedClass + '" ';
        html += 'style="padding-left: ' + paddingLeft + 'px">';

        html += '<div class="p-1 mr-0.5 cursor-pointer text-gray-400 transform transition-transform ' + expandedClass + ' ' + invisibleClass + '" data-action="toggle" data-id="' + folder.id + '">';
        html += '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>';
        html += '</div>';
        html += '<div class="flex-1 flex items-center cursor-pointer overflow-hidden" data-action="select" data-id="' + folder.id + '">';
        html += '<svg class="w-5 h-5 mr-2 text-yellow-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>';
        html += '<span class="truncate">' + escapeHtml(folder.name) + '</span>';
        html += '<span class="text-xs text-gray-400 ml-2">' + this.getFolderBookmarkCount(folder.id) + '</span>';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        if (isExpanded && hasChildren) {
            const children = this.folders.filter(f => f.parent_id === folder.id);
            children.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
            html += '<div class="space-y-0.5 mt-0.5">';
            children.forEach(child => {
                html += renderFolder(child, level + 1);
            });
            html += '</div>';
        }
        return html;
    };

    const roots = this.folders.filter(f => !f.parent_id);
    roots.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
    this._sidebarCache = roots.map(f => renderFolder(f)).join('');
    this._sidebarDirty = false;
    return this._sidebarCache;
},

handleSidebarClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const idStr = target.dataset.id;
    const id = parseInt(idStr, 10);

    if (action === 'toggle') {
        this.toggleFolder(id);
    } else if (action === 'select') {
        this.currentFolderId = id;
        this.currentView = 'home';
        this.mobileMenuOpen = false;
    }
},

getFolderName(id) {
    if (!id) return window.translations?.modals?.rootFolder ?? 'Root';
    const folder = this.folders.find(f => f.id === id);
    return folder ? folder.name : (window.translations?.modals?.unknownFolder ?? 'Unknown');
},

/**
 * Render the folder picker options. `targetField` is the component field the
 * selection writes to ('newFolderParentId' for the folder modal,
 * 'newBookmarkFolderId' for the bookmark modal) and is supplied explicitly by
 * the caller so both pickers stay independent even when both modals are open.
 *
 * The folder name is never embedded into an Alpine expression. It is placed
 * as HTML-escaped text inside a plain <span>, so a folder name containing
 * quotes or script syntax cannot be executed.
 */
folderSelectorTemplate(targetField, editingId) {
    const query = (this.selectorQuery || '').trim().toLowerCase();
    const canBeParent = (folder) =>
        editingId === null || (folder.id !== editingId && !this.isFolderDescendant(folder.id, editingId));

    const build = (parentId, depth = 0) => {
        let children = this.folders.filter(f => f.parent_id === parentId);
        children.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));

        let html = '';
        for (const folder of children) {
            const matches = !query || folder.name.toLowerCase().includes(query);
            const childHtml = build(folder.id, depth + 1);
            if (!matches && !childHtml) continue;

            const selectable = canBeParent(folder);
            const classes = 'block w-full text-left pr-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-900 dark:text-white text-sm truncate'
                + (selectable ? '' : ' opacity-40 cursor-not-allowed');
            const clickHandler = selectable
                ? `@click="selectFolderOption($event, '${targetField}')"`
                : '';
            const padding = 16 + depth * 16;

            html += `<button type="button" role="option" data-folder-id="${folder.id}" ${clickHandler} :aria-selected="${targetField} === ${folder.id}" style="padding-left: ${padding}px" class="${classes}" ${selectable ? '' : 'disabled'}>`;
            html += `<span>${this.escapeHtml(folder.name)}</span>`;
            html += '</button>';
            html += childHtml;
        }
        return html;
    };

    return build(null);
},

selectFolderOption(event, targetField) {
    const row = event.currentTarget;
    this[targetField] = Number(row.dataset.folderId);
    this.selectorOpen = false;
    this.selectorQuery = '';
},

isFolderDescendant(folderId, ancestorId) {
    if (!folderId || !ancestorId || folderId === ancestorId) return false;
    const visited = new Set();
    let current = this.folders.find((folder) => folder.id === folderId);
    while (current?.parent_id !== null && current?.parent_id !== undefined) {
        if (visited.has(current.id)) return false;
        visited.add(current.id);
        if (current.parent_id === ancestorId) return true;
        current = this.folders.find((folder) => folder.id === current.parent_id);
    }
    return false;
},

toggleSelector(id) {
    this.selectorExpanded[id] = !this.selectorExpanded[id];
},

toggleFolder(id) {
    this.expandedFolders[id] = !this.expandedFolders[id];
    this._sidebarDirty = true;
}
