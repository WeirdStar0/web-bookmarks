export const scripts = `
    <script>
        function app() {
            return {
                loggedIn: false,
                isCheckingAuth: true,
                loginForm: { username: '', password: '' },
                loginError: '',
                
                folders: [],
                bookmarks: [],
                currentFolderId: JSON.parse(localStorage.getItem('currentFolderId')) || null,
                
                searchQuery: '',
                currentView: localStorage.getItem('currentView') || 'home', // 'home' | 'trash'
                trashFolders: [],
                trashBookmarks: [],
                expandedFolders: {}, // For sidebar tree
                folderCounts: {}, // Pre-calculated bookmark counts by folder ID

                isLoading: false,
                loadingText: '',
                isOperationPending: false,
                toast: { show: false, message: '', type: 'success' },
                
                editMode: false,
                editingId: null,

                showFolderModal: false,
                newFolderName: '',
                newFolderParentId: null,
                
                showBookmarkModal: false,
                newBookmarkTitle: '',
                newBookmarkUrl: '',
                newBookmarkFolderId: null,
                selectorExpanded: {}, // For custom folder selector in modal
                selectorOpen: false, // For custom folder selector dropdown visibility
                
                showSettingsModal: false,
                settingsForm: { username: '', password: '' },
                
                showConfirmModal: false,
                confirmMessage: '',
                confirmCallback: null,

                darkMode: localStorage.getItem('darkMode') === 'true',

                // 拖拽状态
                draggedItem: null, // { id, type, data }
                dropTarget: null, // { id, type }
                isSorting: false,

                init() {
                    if (this.darkMode) document.documentElement.classList.add('dark');
                    this.checkAuth();

                    this.$watch('currentFolderId', value => localStorage.setItem('currentFolderId', JSON.stringify(value)));
                    this.$watch('currentView', value => localStorage.setItem('currentView', value));
                },

                async checkAuth() {
                    try {
                        await this.loadData();
                        this.loggedIn = true;
                    } catch (e) {
                        this.loggedIn = false;
                    } finally {
                        this.isCheckingAuth = false;
                    }
                },

                async withLoading(fn) {
                    if (this.isOperationPending) return;
                    this.isOperationPending = true;
                    this.isLoading = true;
                    this.loadingText = '处理中...';
                    try {
                        await fn();
                    } finally {
                        this.isOperationPending = false;
                        this.isLoading = false;
                    }
                },

                async login() {
                    this.isLoading = true;
                    this.loadingText = '登录中...';
                    try {
                        const res = await fetch('/api/login', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(this.loginForm)
                        });
                        if (res.ok) {
                            this.loggedIn = true;
                            this.loginError = '';
                            await this.loadData();
                        } else {
                            const data = await res.json();
                            this.loginError = data.error || 'Login failed';
                        }
                    } catch (e) {
                        this.loginError = 'Network error';
                    } finally {
                        this.isLoading = false;
                    }
                },

                async logout() {
                    await this.withLoading(async () => {
                        await fetch('/api/logout', { method: 'POST' });
                        this.loggedIn = false;
                        this.loginForm = { username: '', password: '' };
                        this.folders = [];
                        this.bookmarks = [];
                    });
                },

                async loadData() {
                    const res = await fetch('/api/data');
                    if (res.status === 401) throw new Error('Unauthorized');
                    const data = await res.json();
                    this.folders = data.folders;
                    this.bookmarks = data.bookmarks;
                    this.calculateFolderCounts();
                },

                calculateFolderCounts() {
                    this.folderCounts = {};
                    this.bookmarks.forEach(b => {
                        if (!b.is_deleted && b.folder_id) {
                            this.folderCounts[b.folder_id] = (this.folderCounts[b.folder_id] || 0) + 1;
                        }
                    });
                },

                async loadTrash() {
                    const res = await fetch('/api/trash');
                    if (res.status === 401) throw new Error('Unauthorized');
                    const data = await res.json();
                    this.trashFolders = data.folders;
                    this.trashBookmarks = data.bookmarks;
                },

                get currentFolders() {
                    if (this.currentView === 'trash') {
                         return this.trashFolders.filter(f => f.name.toLowerCase().includes(this.searchQuery.toLowerCase()));
                    }
                    let items = this.folders.filter(f => f.parent_id === this.currentFolderId);
                    if (this.searchQuery) {
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
                        // Sort by sort_order then name (though backend already does this, good to be safe or if we re-sort locally)
                        children.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
                        
                        let result = [];
                        for (const child of children) {
                            result.push({
                                ...child,
                                level: level,
                                displayName: '\u00A0'.repeat(level * 4) + child.name
                            });
                            result = result.concat(buildHierarchy(child.id, level + 1));
                        }
                        return result;
                    };
                    return buildHierarchy(null, 0);
                },

                get sidebarHtml() {
                    const escapeHtml = (unsafe) => {
                        if (!unsafe) return '';
                        return unsafe
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;")
                            .replace(/>/g, "&gt;")
                            .replace(/"/g, "&quot;")
                            .replace(/'/g, "&#039;");
                    };

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
                            // Sort by sort_order
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
                    return roots.map(f => renderFolder(f)).join('');
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
                    }
                },

                getFolderName(id) {
                    if (!id) return '所有书签 (根目录)';
                    const folder = this.folders.find(f => f.id === id);
                    return folder ? folder.name : '未知文件夹';
                },

                toggleSelector(id) {
                    this.selectorExpanded[id] = !this.selectorExpanded[id];
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
                            await fetch(\`/api/folders/\${this.editingId}\`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ name: this.newFolderName, parent_id: this.newFolderParentId })
                            });
                        } else {
                            await fetch('/api/folders', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ name: this.newFolderName, parent_id: this.newFolderParentId })
                            });
                        }
                        this.showFolderModal = false;
                        this.loadData();
                    });
                },

                deleteFolder(id) {
                    this.confirmAction('确定要删除这个文件夹吗？', async () => {
                        await this.withLoading(async () => {
                            await fetch(\`/api/folders/\${id}\`, { method: 'DELETE' });
                            this.loadData();
                        });
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
                    this.selectorExpanded = {}; // Reset expansion state
                    this.selectorOpen = false;
                    this.showBookmarkModal = true;
                },

                async createBookmark() {
                    if (!this.newBookmarkUrl) return;
                    
                    await this.withLoading(async () => {
                        if (this.editMode) {
                            await fetch(\`/api/bookmarks/\${this.editingId}\`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    title: this.newBookmarkTitle || this.newBookmarkUrl,
                                    url: this.newBookmarkUrl,
                                    folder_id: this.newBookmarkFolderId
                                })
                            });
                        } else {
                            await fetch('/api/bookmarks', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    title: this.newBookmarkTitle || this.newBookmarkUrl,
                                    url: this.newBookmarkUrl,
                                    folder_id: this.newBookmarkFolderId
                                })
                            });
                        }
                        this.showBookmarkModal = false;
                        this.loadData();
                    });
                },

                deleteBookmark(id) {
                    this.confirmAction('确定要删除这个书签吗？', async () => {
                        await this.withLoading(async () => {
                            await fetch(\`/api/bookmarks/\${id}\`, { method: 'DELETE' });
                            this.loadData();
                        });
                    });
                },

                async restoreFolder(id) {
                    await this.withLoading(async () => {
                        await fetch(\`/api/restore/folders/\${id}\`, { method: 'POST' });
                        this.loadTrash();
                        this.loadData();
                    });
                },

                async restoreBookmark(id) {
                    await this.withLoading(async () => {
                        await fetch(\`/api/restore/bookmarks/\${id}\`, { method: 'POST' });
                        this.loadTrash();
                        this.loadData();
                    });
                },

                permanentDeleteFolder(id) {
                    this.confirmAction('确定要永久删除这个文件夹吗？此操作无法撤销！', async () => {
                        await this.withLoading(async () => {
                            await fetch(\`/api/trash/folders/\${id}\`, { method: 'DELETE' });
                            this.loadTrash();
                        });
                    });
                },

                permanentDeleteBookmark(id) {
                    this.confirmAction('确定要永久删除这个书签吗？此操作无法撤销！', async () => {
                        await this.withLoading(async () => {
                            await fetch(\`/api/trash/bookmarks/\${id}\`, { method: 'DELETE' });
                            this.loadTrash();
                        });
                    });
                },

                emptyTrash() {
                    this.confirmAction('确定要清空回收站吗？所有项目将被永久删除！', async () => {
                        await this.withLoading(async () => {
                            await fetch('/api/trash/empty', { method: 'DELETE' });
                            this.loadTrash();
                        });
                    });
                },

                toggleFolder(id) {
                    this.expandedFolders[id] = !this.expandedFolders[id];
                },

                openSettingsModal() {
                    this.settingsForm = { username: '', password: '' };
                    this.showSettingsModal = true;
                },

                async updateSettings() {
                    await this.withLoading(async () => {
                        const res = await fetch('/api/settings', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(this.settingsForm)
                        });
                        if (res.ok) {
                            this.showSettingsModal = false;
                            this.showToast('设置已更新', 'success');
                        } else {
                            this.showToast('更新失败', 'error');
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
                },
                
                async importBookmarks(event) {
                    const file = event.target.files[0];
                    if (!file) return;
                    
                    this.confirmAction('确定要导入书签吗？这可能需要一些时间。', async () => {
                        this.isLoading = true;
                        const preventUnload = (e) => {
                            e.preventDefault();
                            e.returnValue = '';
                        };
                        window.addEventListener('beforeunload', preventUnload);

                        await this.withLoading(async () => {
                            try {
                                const text = await file.text();
                                const res = await fetch('/api/import', {
                                    method: 'POST',
                                    body: text
                                });

                                if (res.ok) {
                                    this.showToast('导入成功', 'success');
                                    this.loadData();
                                    this.showSettingsModal = false;
                                } else {
                                    this.showToast('导入失败', 'error');
                                }
                            } catch (e) {
                                this.showToast('导入出错: ' + e.message, 'error');
                            } finally {
                                this.isLoading = false;
                                window.removeEventListener('beforeunload', preventUnload);
                                event.target.value = '';
                            }
                        });
                    });
                },

                // ========== 拖拽功能 ==========

                handleDragStart(event, item, type) {
                    this.draggedItem = {
                        id: item.id,
                        type: type,
                        data: item
                    };
                    // 设置拖拽数据
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', JSON.stringify({ id: item.id, type }));

                    // 延迟添加样式,让拖拽幻影显示
                    setTimeout(() => {
                        event.target.style.opacity = '0.5';
                    }, 0);
                },

                handleDragEnd(event) {
                    // 清除拖拽状态
                    this.draggedItem = null;
                    this.dropTarget = null;

                    // 恢复元素样式
                    if (event.target) {
                        event.target.style.opacity = '1';
                    }
                },

                handleDragOver(event, type) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                },

                async handleDrop(event, targetType) {
                    event.preventDefault();

                    if (!this.draggedItem) return;

                    // 获取放置目标
                    const className = targetType + '-item';
                    const targetElement = event.target.closest('.' + className);
                    if (!targetElement) {
                        this.draggedItem = null;
                        return;
                    }

                    // 从当前列表中找到目标项
                    const currentList = targetType === 'folder' ? this.currentFolders : this.currentBookmarks;
                    const allElements = Array.from(document.querySelectorAll('.' + className));
                    const targetIndex = allElements.indexOf(targetElement);

                    if (targetIndex === -1 || !currentList[targetIndex]) {
                        console.error('无法找到目标项:', { targetIndex, currentList });
                        this.draggedItem = null;
                        this.dropTarget = null;
                        return;
                    }

                    const targetItem = currentList[targetIndex];

                    if (!targetItem || this.draggedItem.id === targetItem.id) {
                        this.draggedItem = null;
                        this.dropTarget = null;
                        return;
                    }

                    console.log('拖拽操作:', {
                        draggedItem: this.draggedItem,
                        targetItem: targetItem,
                        targetType: targetType
                    });

                    // 执行拖拽操作
                    try {
                        if (this.draggedItem.type === 'folder' && targetType === 'folder') {
                            await this.reorderFolders(this.draggedItem.id, targetItem.id);
                        } else if (this.draggedItem.type === 'bookmark' && targetType === 'bookmark') {
                            await this.reorderBookmarks(this.draggedItem.id, targetItem.id);
                        } else if (this.draggedItem.type === 'bookmark' && targetType === 'folder') {
                            // 将书签移动到文件夹
                            await this.moveBookmarkToFolder(this.draggedItem.id, targetItem.id);
                        }
                    } catch (e) {
                        console.error('拖拽操作失败:', e);
                        this.showToast('操作失败: ' + e.message, 'error');
                    }

                    // 清除拖拽状态
                    this.draggedItem = null;
                    this.dropTarget = null;
                },

                // 重新排序文件夹
                async reorderFolders(draggedId, targetId) {
                    await this.withLoading(async () => {
                        try {
                            console.log('重新排序文件夹:', { draggedId, targetId, currentFolderId: this.currentFolderId });

                            // 获取当前文件夹列表
                            const currentFolders = this.folders.filter(f => f.parent_id === this.currentFolderId && !f.is_deleted);
                            console.log('当前文件夹列表:', currentFolders);

                            // 找到拖拽项和目标项的索引
                            const draggedIndex = currentFolders.findIndex(f => f.id === draggedId);
                            const targetIndex = currentFolders.findIndex(f => f.id === targetId);

                            if (draggedIndex === -1 || targetIndex === -1) {
                                console.error('找不到拖拽项或目标项:', { draggedIndex, targetIndex });
                                this.showToast('排序失败: 找不到项目', 'error');
                                return;
                            }

                            // 创建新顺序
                            const newOrder = [...currentFolders];
                            newOrder.splice(draggedIndex, 1);
                            newOrder.splice(targetIndex, 0, currentFolders[draggedIndex]);

                            // 提取 ID 数组
                            const orderedIds = newOrder.map(f => f.id);
                            console.log('新顺序 ID:', orderedIds);

                            // 发送到服务器
                            const res = await fetch('/api/folders/reorder', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ orderedIds })
                            });

                            const result = await res.json();
                            console.log('服务器响应:', result);

                            if (res.ok) {
                                this.showToast('排序已更新', 'success');
                                await this.loadData();
                            } else {
                                console.error('服务器错误:', result);
                                this.showToast('排序更新失败: ' + (result.error || '未知错误'), 'error');
                            }
                        } catch (e) {
                            console.error('排序异常:', e);
                            this.showToast('操作失败: ' + e.message, 'error');
                        }
                    });
                },

                // 重新排序书签
                async reorderBookmarks(draggedId, targetId) {
                    await this.withLoading(async () => {
                        try {
                            console.log('重新排序书签:', { draggedId, targetId, currentFolderId: this.currentFolderId });

                            // 获取当前文件夹的书签列表
                            const currentBookmarks = this.bookmarks.filter(b =>
                                b.folder_id === this.currentFolderId && !b.is_deleted
                            );
                            console.log('当前书签列表:', currentBookmarks);

                            // 找到拖拽项和目标项的索引
                            const draggedIndex = currentBookmarks.findIndex(b => b.id === draggedId);
                            const targetIndex = currentBookmarks.findIndex(b => b.id === targetId);

                            if (draggedIndex === -1 || targetIndex === -1) {
                                console.error('找不到拖拽项或目标项:', { draggedIndex, targetIndex });
                                this.showToast('排序失败: 找不到项目', 'error');
                                return;
                            }

                            // 创建新顺序
                            const newOrder = [...currentBookmarks];
                            newOrder.splice(draggedIndex, 1);
                            newOrder.splice(targetIndex, 0, currentBookmarks[draggedIndex]);

                            // 提取 ID 数组,确保是数字类型
                            const orderedIds = newOrder.map(b => {
                                const id = parseInt(b.id);
                                console.log('书签 ID:', b.id, '类型:', typeof b.id, '解析后:', id, 'isNaN:', isNaN(id));
                                return id;
                            });

                            // 验证所有 ID 都是有效数字
                            const invalidId = orderedIds.find(id => isNaN(id) || id <= 0);
                            if (invalidId !== undefined) {
                                console.error('发现无效 ID:', invalidId);
                                this.showToast('排序失败: 包含无效的 ID', 'error');
                                return;
                            }

                            console.log('新顺序 ID (数字):', orderedIds, '类型:', typeof orderedIds[0]);
                            console.log('ID 数组长度:', orderedIds.length);

                            const requestBody = JSON.stringify({ orderedIds });
                            console.log('请求体:', requestBody);

                            // 发送到服务器
                            const res = await fetch('/api/bookmarks/reorder', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: requestBody
                            });

                            const result = await res.json();
                            console.log('服务器响应:', result);

                            if (res.ok) {
                                this.showToast('排序已更新', 'success');
                                await this.loadData();
                            } else {
                                console.error('服务器错误:', result);
                                this.showToast('排序更新失败: ' + (result.error || '未知错误'), 'error');
                            }
                        } catch (e) {
                            console.error('排序异常:', e);
                            this.showToast('操作失败: ' + e.message, 'error');
                        }
                    });
                },

                // 移动书签到文件夹
                async moveBookmarkToFolder(bookmarkId, folderId) {
                    await this.withLoading(async () => {
                        try {
                            const bookmark = this.bookmarks.find(b => b.id === bookmarkId);
                            if (!bookmark) return;

                            const url = '/api/bookmarks/' + bookmarkId;
                            const res = await fetch(url, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    title: bookmark.title,
                                    url: bookmark.url,
                                    folder_id: folderId
                                })
                            });

                            if (res.ok) {
                                this.showToast('已移动到文件夹', 'success');
                                await this.loadData();
                            } else {
                                this.showToast('移动失败', 'error');
                            }
                        } catch (e) {
                            this.showToast('操作失败: ' + e.message, 'error');
                        }
                    });
                },
            }
        }
    </script>
`;
