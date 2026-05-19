handleDragStart(event, item, type) {
    this.draggedItem = {
        id: item.id,
        type: type,
        data: item,
    };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify({ id: item.id, type }));

    setTimeout(() => {
        event.target.style.opacity = '0.5';
    }, 0);
},

handleDragEnd(event) {
    this.draggedItem = null;
    this.dropTarget = null;

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

    const className = targetType + '-item';
    const targetElement = event.target.closest('.' + className);
    if (!targetElement) {
        this.draggedItem = null;
        return;
    }

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
        targetType: targetType,
    });

    try {
        if (this.draggedItem.type === 'folder' && targetType === 'folder') {
            await this.reorderFolders(this.draggedItem.id, targetItem.id);
        } else if (this.draggedItem.type === 'bookmark' && targetType === 'bookmark') {
            await this.reorderBookmarks(this.draggedItem.id, targetItem.id);
        } else if (this.draggedItem.type === 'bookmark' && targetType === 'folder') {
            await this.moveBookmarkToFolder(this.draggedItem.id, targetItem.id);
        }
    } catch (e) {
        console.error('拖拽操作失败:', e);
        this.showToast(window.translations.toast.operationFailed + ': ' + e.message, 'error');
    }

    this.draggedItem = null;
    this.dropTarget = null;
},

async reorderFolders(draggedId, targetId) {
    await this.withLoading(async () => {
        try {
            console.log('重新排序文件夹:', { draggedId, targetId, currentFolderId: this.currentFolderId });

            const currentFolders = this.folders.filter(f => f.parent_id === this.currentFolderId && !f.is_deleted);
            console.log('当前文件夹列表:', currentFolders);

            const draggedIndex = currentFolders.findIndex(f => f.id === draggedId);
            const targetIndex = currentFolders.findIndex(f => f.id === targetId);

            if (draggedIndex === -1 || targetIndex === -1) {
                console.error('找不到拖拽项或目标项:', { draggedIndex, targetIndex });
                this.showToast(window.translations.toast.sortFailed + '找不到项目', 'error');
                return;
            }

            const newOrder = [...currentFolders];
            newOrder.splice(draggedIndex, 1);
            newOrder.splice(targetIndex, 0, currentFolders[draggedIndex]);

            const orderedIds = newOrder.map(f => f.id);
            console.log('新顺序 ID:', orderedIds);

            const res = await this.submitJson('/api/folders/reorder', { orderedIds }, 'PUT');

            const result = await res.json();
            console.log('服务器响应:', result);
            this.showToast(window.translations.toast.sortUpdated, 'success');
            await this.loadData();
        } catch (e) {
            console.error('排序异常:', e);
            this.showToast(window.translations.toast.operationFailed + ': ' + e.message, 'error');
        }
    });
},

async reorderBookmarks(draggedId, targetId) {
    await this.withLoading(async () => {
        try {
            console.log('重新排序书签:', { draggedId, targetId, currentFolderId: this.currentFolderId });

            const currentBookmarks = this.bookmarks.filter(b => b.folder_id === this.currentFolderId && !b.is_deleted);
            console.log('当前书签列表:', currentBookmarks);

            const draggedIndex = currentBookmarks.findIndex(b => b.id === draggedId);
            const targetIndex = currentBookmarks.findIndex(b => b.id === targetId);

            if (draggedIndex === -1 || targetIndex === -1) {
                console.error('找不到拖拽项或目标项:', { draggedIndex, targetIndex });
                this.showToast(window.translations.toast.sortFailed + '找不到项目', 'error');
                return;
            }

            const newOrder = [...currentBookmarks];
            newOrder.splice(draggedIndex, 1);
            newOrder.splice(targetIndex, 0, currentBookmarks[draggedIndex]);

            const orderedIds = newOrder.map(b => Number.parseInt(b.id, 10));
            const invalidId = orderedIds.find(id => Number.isNaN(id) || id <= 0);
            if (invalidId !== undefined) {
                console.error('发现无效 ID:', invalidId);
                this.showToast(window.translations.toast.sortFailed + '包含无效的 ID', 'error');
                return;
            }

            const res = await this.submitJson('/api/bookmarks/reorder', { orderedIds }, 'PUT');

            const result = await res.json();
            console.log('服务器响应:', result);
            this.showToast(window.translations.toast.sortUpdated, 'success');
            await this.loadData();
        } catch (e) {
            console.error('排序异常:', e);
            this.showToast(window.translations.toast.operationFailed + ': ' + e.message, 'error');
        }
    });
},

async moveBookmarkToFolder(bookmarkId, folderId) {
    await this.withLoading(async () => {
        try {
            const bookmark = this.bookmarks.find(b => b.id === bookmarkId);
            if (!bookmark) return;

            const res = await this.submitJson('/api/bookmarks/' + bookmarkId, {
                title: bookmark.title,
                url: bookmark.url,
                folder_id: folderId,
            }, 'PUT');

            this.showToast(window.translations.toast.movedToFolder, 'success');
            await this.loadData();
        } catch (e) {
            this.showToast(window.translations.toast.moveFailed + ': ' + e.message, 'error');
        }
    });
}
