import type { TemplateTranslations } from './types';

const modalAlpineString = (value: string) => JSON.stringify(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const modals = (t: TemplateTranslations) => `
    <!-- Modals -->
    <!-- Add Folder Modal -->
    <div x-show="showFolderModal" @keydown.escape.window="showFolderModal && closeModal('showFolderModal')" class="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4" x-transition:enter="ui-transition" x-transition:enter-start="ui-transition-start" x-transition:enter-end="ui-transition-end" x-transition:leave="ui-transition" x-transition:leave-start="ui-transition-end" x-transition:leave-end="ui-transition-start" x-cloak>
        <div class="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl transform transition-all max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="folderModalTitle" @click.away="closeModal('showFolderModal')">
            <h2 id="folderModalTitle" class="text-xl font-bold mb-6 text-gray-800 dark:text-white" x-text="editMode ? ${modalAlpineString(t.modals.editFolder)} : ${modalAlpineString(t.modals.createFolder)}"></h2>
            <label for="folderNameInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t.modals.folderName}</label>
            <input id="folderNameInput" type="text" x-model="newFolderName" @keyup.enter="createFolder()" placeholder="${t.modals.folderNamePlaceholder}" class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg p-3 mb-6 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow">

            <div class="mb-6">
                <label for="folderParentSelect" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t.modals.location}</label>
                <div class="relative" @click.away="selectorOpen = false">
                    <button id="folderParentSelect" type="button" @click="selectorOpen = !selectorOpen" :aria-expanded="selectorOpen" aria-haspopup="listbox" class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg p-3 text-left flex justify-between items-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow">
                        <span x-text="getFolderName(newFolderParentId)"></span>
                        <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                    </button>
                    <div x-show="selectorOpen" role="listbox" aria-labelledby="folderParentSelect" class="absolute z-10 mt-1 w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto" x-transition:enter="ui-transition" x-transition:enter-start="ui-transition-start" x-transition:enter-end="ui-transition-end" x-transition:leave="ui-transition" x-transition:leave-start="ui-transition-end" x-transition:leave-end="ui-transition-start">
                        <div class="p-2 border-b border-gray-200 dark:border-gray-600">
                            <input type="text" x-model="selectorQuery" placeholder="${t.modals.searchFolders}" class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent">
                        </div>
                        <div class="py-1">
                            <button type="button" role="option" :aria-selected="newFolderParentId === null" @click="newFolderParentId = null; selectorOpen = false; selectorQuery = ''" class="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-900 dark:text-white text-sm">
                                ${t.modals.rootFolder}
                            </button>
                            <div x-html="folderSelectorTemplate('newFolderParentId', editingId)"></div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="flex justify-end space-x-3">
                <button type="button" @click="closeModal('showFolderModal')" class="px-5 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors">${t.modals.cancel}</button>
                <button type="button" @click="createFolder()" :disabled="isOperationPending" :class="{'opacity-50 cursor-not-allowed': isOperationPending}" class="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-md transition-colors" x-text="editMode ? ${modalAlpineString(t.modals.save)} : ${modalAlpineString(t.modals.create)}"></button>
            </div>
        </div>
    </div>

    <!-- Add Bookmark Modal -->
    <div x-show="showBookmarkModal" @keydown.escape.window="showBookmarkModal && closeModal('showBookmarkModal')" class="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4" x-transition:enter="ui-transition" x-transition:enter-start="ui-transition-start" x-transition:enter-end="ui-transition-end" x-transition:leave="ui-transition" x-transition:leave-start="ui-transition-end" x-transition:leave-end="ui-transition-start" x-cloak>
        <div class="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl transform transition-all max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="bookmarkModalTitle" @click.away="closeModal('showBookmarkModal')">
            <h2 id="bookmarkModalTitle" class="text-xl font-bold mb-6 text-gray-800 dark:text-white" x-text="editMode ? ${modalAlpineString(t.modals.editBookmark)} : ${modalAlpineString(t.modals.createBookmark)}"></h2>
            <div class="space-y-4 mb-6">
                <div>
                    <label for="bookmarkTitleInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t.modals.bookmarkTitle}</label>
                    <input id="bookmarkTitleInput" type="text" x-model="newBookmarkTitle" placeholder="${t.modals.titlePlaceholder}" class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow">
                </div>
                <div>
                    <label for="bookmarkUrlInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t.modals.bookmarkUrl}</label>
                    <input id="bookmarkUrlInput" type="url" x-model="newBookmarkUrl" @keyup.enter="createBookmark()" placeholder="https://example.com" class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow">
                </div>
                <div>
                    <label for="bookmarkDescriptionInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t.modals.bookmarkDesc}</label>
                    <textarea id="bookmarkDescriptionInput" x-model="newBookmarkDescription" rows="3" placeholder="${t.modals.descPlaceholder}" class="w-full resize-y border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"></textarea>
                </div>
                <div>
                    <label for="bookmarkFolderSelect" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t.modals.location}</label>
                    <div class="relative" @click.away="selectorOpen = false">
                        <button id="bookmarkFolderSelect" type="button" @click="selectorOpen = !selectorOpen" :aria-expanded="selectorOpen" aria-haspopup="listbox" class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg p-3 text-left flex justify-between items-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow">
                            <span x-text="getFolderName(newBookmarkFolderId)"></span>
                            <svg class="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
                        </button>
                        <div x-show="selectorOpen" role="listbox" aria-labelledby="bookmarkFolderSelect" class="absolute z-10 mt-1 w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-y-auto" x-transition:enter="ui-transition" x-transition:enter-start="ui-transition-start" x-transition:enter-end="ui-transition-end" x-transition:leave="ui-transition" x-transition:leave-start="ui-transition-end" x-transition:leave-end="ui-transition-start">
                            <div class="p-2 border-b border-gray-200 dark:border-gray-600">
                                <input type="text" x-model="selectorQuery" placeholder="${t.modals.searchFolders}" class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent">
                            </div>
                            <div class="py-1">
                                <button type="button" role="option" :aria-selected="newBookmarkFolderId === null" @click="newBookmarkFolderId = null; selectorOpen = false; selectorQuery = ''" class="w-full text-left px-4 py-2 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-900 dark:text-white text-sm">
                                    ${t.modals.rootFolder}
                                </button>
                                <div x-html="folderSelectorTemplate('newBookmarkFolderId', null)"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="flex justify-end space-x-3">
                <button type="button" @click="closeModal('showBookmarkModal')" class="px-5 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors">${t.modals.cancel}</button>
                <button type="button" @click="createBookmark()" :disabled="isOperationPending" :class="{'opacity-50 cursor-not-allowed': isOperationPending}" class="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-md transition-colors">${t.modals.save}</button>
            </div>
        </div>
    </div>

    <!-- Settings Modal -->
    <div x-show="showSettingsModal" @keydown.escape.window="showSettingsModal && closeModal('showSettingsModal')" class="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-50 p-4" x-transition:enter="ui-transition" x-transition:enter-start="ui-transition-start" x-transition:enter-end="ui-transition-end" x-transition:leave="ui-transition" x-transition:leave-start="ui-transition-end" x-transition:leave-end="ui-transition-start" x-cloak>
        <div class="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl transform transition-all max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle" @click.away="closeModal('showSettingsModal')">
            <h2 id="settingsModalTitle" class="text-xl font-bold mb-6 text-gray-800 dark:text-white">${t.dashboard.settings}</h2>
            <div class="space-y-4 mb-6">
                <div>
                    <label for="settingsUsernameInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t.modals.newUsername}</label>
                    <input id="settingsUsernameInput" type="text" x-model="settingsForm.username" placeholder="${t.modals.leaveEmptyToKeep}" autocomplete="username" class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow">
                </div>
                <div>
                    <label for="settingsPasswordInput" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${t.modals.newPassword}</label>
                    <input id="settingsPasswordInput" type="password" x-model="settingsForm.password" placeholder="${t.modals.leaveEmptyToKeep}" autocomplete="new-password" class="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow">
                </div>

                <hr class="border-gray-200 dark:border-gray-700">

                <div class="flex justify-between items-center gap-3">
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-300">${t.modals.dataManagement}</span>
                    <div class="space-x-2 whitespace-nowrap">
                        <button type="button" @click="$refs.importInput.click()" class="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded transition-colors">${t.modals.import}</button>
                        <input type="file" x-ref="importInput" class="hidden" accept=".html,text/html" @change="importBookmarks($event)">
                        <a href="/api/export" target="_blank" rel="noopener" class="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded transition-colors inline-block">${t.modals.export}</a>
                    </div>
                </div>
            </div>
            <div class="flex justify-end space-x-3">
                <button type="button" @click="closeModal('showSettingsModal')" class="px-5 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors">${t.modals.cancel}</button>
                <button type="button" @click="updateSettings()" :disabled="isOperationPending" :class="{'opacity-50 cursor-not-allowed': isOperationPending}" class="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-md transition-colors">${t.modals.save}</button>
            </div>
        </div>
    </div>

    <!-- Confirm Modal -->
    <div x-show="showConfirmModal" @keydown.escape.window="showConfirmModal && closeModal('showConfirmModal')" class="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex items-center justify-center z-[80] p-4" x-transition:enter="ui-transition" x-transition:enter-start="ui-transition-start" x-transition:enter-end="ui-transition-end" x-transition:leave="ui-transition" x-transition:leave-start="ui-transition-end" x-transition:leave-end="ui-transition-start" x-cloak>
        <div class="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl transform transition-all" role="dialog" aria-modal="true" aria-labelledby="confirmModalTitle" aria-describedby="confirmModalMessage" @click.away="closeModal('showConfirmModal')">
            <div class="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 dark:bg-red-900 rounded-full mb-4" aria-hidden="true">
                <svg class="w-6 h-6 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77-1.333.192-3.333 1.732-3z"></path></svg>
            </div>
            <h3 id="confirmModalTitle" class="text-lg font-bold text-center text-gray-900 dark:text-white mb-2">${t.modals.confirmTitle}</h3>
            <p id="confirmModalMessage" class="text-gray-500 dark:text-gray-400 text-center mb-6" x-text="confirmMessage"></p>
            <div class="flex justify-end space-x-3">
                <button type="button" @click="closeModal('showConfirmModal')" class="px-5 py-2.5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors">${t.modals.cancel}</button>
                <button type="button" @click="executeConfirm()" :disabled="isOperationPending" :class="{'opacity-50 cursor-not-allowed': isOperationPending}" class="px-5 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium shadow-md transition-colors">${t.modals.confirm}</button>
            </div>
        </div>
    </div>
`;
