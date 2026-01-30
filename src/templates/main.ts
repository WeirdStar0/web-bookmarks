export const main = (t: any) => `
    <!-- Main Content -->
    <div x-show="loggedIn" class="h-screen flex flex-col" x-cloak>
        <!-- Navbar -->
        <nav class="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
            <!-- Enhanced Global Loading Indicator -->
            <div x-show="isOperationPending"
                 class="absolute top-0 left-0 w-full h-2 bg-gray-200 dark:bg-gray-700 overflow-hidden z-50"
                 x-transition:enter="transition ease-out duration-200"
                 x-transition:enter-start="opacity-0"
                 x-transition:enter-end="opacity-100"
                 x-transition:leave="transition ease-in duration-200"
                 x-transition:leave-start="opacity-100"
                 x-transition:leave-end="opacity-0">
                <div class="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 bg-300% animate-shimmer"></div>
            </div>
            <style>
                @keyframes shimmer {
                    0% { background-position: 100% 0; }
                    100% { background-position: 0 0; }
                }
                .animate-shimmer {
                    background-size: 200% 100%;
                    animation: shimmer 2s infinite linear;
                }
                .bg-300\% {
                    background-size: 300% 100%;
                }
            </style>
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex justify-between h-16">
                    <div class="flex items-center flex-1">
                        <!-- Mobile Menu Button -->
                        <button @click="mobileMenuOpen = !mobileMenuOpen" class="md:hidden p-2 -ml-2 mr-2 text-gray-500 hover:text-blue-600 transition-colors" title="Toggle Menu">
                            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
                        </button>
                        <!-- Logo -->
                        <div class="flex-shrink-0 flex items-center text-blue-600 dark:text-blue-400 font-bold text-xl mr-8">
                            <svg class="w-8 h-8 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"></path></svg>
                            <span class="hidden sm:inline">${t.dashboard.title}</span>
                        </div>

                        <!-- Search Bar -->
                        <div class="flex-1 max-w-lg">
                            <div class="relative">
                                <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <svg class="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                                </div>
                                <input type="text" x-model.debounce.300ms="searchQuery" class="block w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg leading-5 bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 focus:outline-none focus:bg-white dark:focus:bg-gray-600 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-colors" placeholder="${t.dashboard.searchPlaceholder}">
                            </div>
                        </div>
                    </div>

                    <!-- Actions -->
                    <div class="flex items-center space-x-2 sm:space-x-4 ml-4">
                        <div class="relative" x-data="{ openLang: false }" @click.away="openLang = false">
                            <button @click="openLang = !openLang" class="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors" title="Change Language">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.204 4.196L17 5v16c0 .552-.448 1-1 1H6a1 1 0 01-1-1V7.971M5 11h13.5"></path></svg>
                            </button>
                            <div x-show="openLang" class="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-lg py-1 border border-gray-100 dark:border-gray-700 transform origin-top-right transition-all z-50 overflow-y-auto max-h-80" x-transition.opacity>
                                <button @click="setLanguage('zh')" class="flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">简体中文</button>
                                <button @click="setLanguage('en')" class="flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">English</button>
                                <button @click="setLanguage('zhtw')" class="flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">繁體中文</button>
                                <button @click="setLanguage('ja')" class="flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">日本語</button>
                                <button @click="setLanguage('ko')" class="flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">한국어</button>
                                <button @click="setLanguage('es')" class="flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Español</button>
                                <button @click="setLanguage('fr')" class="flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Français</button>
                                <button @click="setLanguage('de')" class="flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Deutsch</button>
                                <button @click="setLanguage('ru')" class="flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Русский</button>
                                <button @click="setLanguage('pt')" class="flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Português</button>
                                <button @click="setLanguage('it')" class="flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">Italiano</button>
                            </div>
                        </div>
                        <button @click="toggleDarkMode()" class="p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors" title="${t.dashboard.toggleDarkMode}">
                            <svg x-show="!darkMode" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
                            <svg x-show="darkMode" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>
                        </button>
                        
                        <div class="relative" x-data="{ open: false }" @click.away="open = false">
                            <button @click="open = !open" class="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                                <div class="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold shadow-sm">
                                    A
                                </div>
                            </button>
                            
                            <div x-show="open" class="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-lg py-1 border border-gray-100 dark:border-gray-700 transform origin-top-right transition-all" x-transition.opacity>
                                <button @click="openSettingsModal(); open = false" class="flex w-full items-center px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
                                    <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                                    ${t.dashboard.settings}
                                </button>
                                <div class="border-t border-gray-100 dark:border-gray-700 my-1"></div>
                                <button @click="logout()" class="flex w-full items-center px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20">
                                    <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
                                    ${t.dashboard.logout}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </nav>

        <div class="flex flex-1 overflow-hidden relative">
            <!-- Mobile Sidebar Backdrop -->
            <div x-show="mobileMenuOpen" 
                 @click="mobileMenuOpen = false" 
                 class="fixed inset-0 bg-black/50 z-40 md:hidden"
                 x-transition:enter="transition ease-out duration-300"
                 x-transition:enter-start="opacity-0"
                 x-transition:enter-end="opacity-100"
                 x-transition:leave="transition ease-in duration-200"
                 x-transition:leave-start="opacity-100"
                 x-transition:leave-end="opacity-0"></div>

            <!-- Sidebar -->
            <aside :class="mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'" 
                   class="fixed inset-y-0 left-0 w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 z-50 md:relative md:translate-x-0 transition-transform duration-300 md:flex md:flex-col overflow-hidden">
                <div class="p-4 space-y-1 flex-shrink-0">
                    <button @click="currentFolderId = null; currentView = 'home'; searchQuery = ''; mobileMenuOpen = false" :class="{'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400': currentFolderId === null && currentView === 'home', 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700': !(currentFolderId === null && currentView === 'home')}" class="w-full flex items-center px-3 py-2 rounded-lg transition-colors font-medium">
                        <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
                        ${t.dashboard.allBookmarks}
                    </button>
                    
                    <button @click="currentView = 'trash'; loadTrash(); mobileMenuOpen = false" :class="{'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400': currentView === 'trash', 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700': currentView !== 'trash'}" class="w-full flex items-center px-3 py-2 rounded-lg transition-colors font-medium">
                        <svg class="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        ${t.dashboard.trash}
                    </button>
                </div>

                <div class="flex-1 overflow-y-auto px-4 py-2">
                    <h3 class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">${t.dashboard.folders}</h3>
                    <div class="space-y-0.5"
                         x-html="sidebarHtml"
                         @click="handleSidebarClick($event)"></div>
                </div>
            </aside>

            <!-- Main Content Area -->
            <main class="flex-1 flex flex-col overflow-hidden min-h-0 bg-gray-50 dark:bg-gray-900">
                <div class="p-4 sm:p-8 flex-shrink-0">
                
                <!-- Breadcrumbs (Home View) -->
                <div x-show="currentView === 'home' && !searchQuery" class="flex items-center text-sm text-gray-500 dark:text-gray-400 mb-6 overflow-x-auto whitespace-nowrap no-scrollbar">
                    <button @click="currentFolderId = null" class="hover:text-blue-600 dark:hover:text-blue-400 transition-colors px-1">${t.dashboard.home}</button>
                    <template x-for="(folder, index) in breadcrumbs" :key="folder.id">
                        <div class="flex items-center">
                            <svg class="w-4 h-4 mx-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                            <button @click="currentFolderId = folder.id" class="hover:text-blue-600 dark:hover:text-blue-400 transition-colors px-1 font-medium" x-text="folder.name"></button>
                        </div>
                    </template>
                </div>

                <!-- Trash Header (Trash View) -->
                <div x-show="currentView === 'trash'" class="flex items-center justify-between mb-6">
                    <h2 class="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                        <svg class="w-8 h-8 mr-3 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        ${t.dashboard.trash}
                    </h2>
                    <button @click="emptyTrash()" class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors shadow-sm text-sm font-medium" x-show="trashFolders.length > 0 || trashBookmarks.length > 0">
                        ${t.dashboard.emptyTrash}
                    </button>
                </div>

                <!-- Search Header -->
                <div x-show="searchQuery" class="mb-6">
                    <h2 class="text-xl font-bold text-gray-900 dark:text-white">
                        ${t.dashboard.searchResult}: "<span x-text="searchQuery"></span>"
                    </h2>
                </div>

                <!-- Action Buttons (Home View) -->
                <div x-show="currentView === 'home' && !searchQuery" class="flex space-x-3 mb-6">
                    <button @click="openFolderModal()" :disabled="isOperationPending || isSorting" :class="{'opacity-50 cursor-not-allowed': isOperationPending || isSorting}" class="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium shadow-sm">
                        <svg class="w-5 h-5 mr-2 text-yellow-500" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
                        ${t.dashboard.newFolder}
                    </button>
                    <button @click="openBookmarkModal()" :disabled="isOperationPending || isSorting" :class="{'opacity-50 cursor-not-allowed': isOperationPending || isSorting}" class="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm text-sm font-medium">
                        <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path></svg>
                        ${t.dashboard.newBookmark}
                    </button>
                    <button @click="toggleSorting()" class="flex items-center px-4 py-2 rounded-lg transition-colors shadow-sm text-sm font-medium"
                            :class="isSorting ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200'">
                        <template x-if="!isSorting">
                            <div class="flex items-center">
                                <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11l5-5m0 0l5 5m-5-5v12"></path></svg>
                                ${t.dashboard.sort}
                            </div>
                        </template>
                        <template x-if="isSorting">
                            <div class="flex items-center">
                                <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                                ${t.dashboard.done}
                            </div>
                        </template>
                    </button>
                </div>

                </div>
                <div class="flex-1 overflow-y-auto px-4 sm:px-8 pb-8">
                    <!-- Folders Grid -->
                    <div x-show="currentFolders.length > 0" class="mb-8"
                         x-transition:enter="transition ease-out duration-300"
                         x-transition:enter-start="opacity-0 transform scale-95"
                         x-transition:enter-end="opacity-100 transform scale-100">
                        <h3 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">${t.dashboard.folders}</h3>
                        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                             @dragover.prevent="handleDragOver($event, 'folder')"
                             @drop="handleDrop($event, 'folder')">
                            <template x-for="folder in currentFolders" :key="folder.id">
                                <div class="group relative bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm hover:shadow-md border-2 border-gray-100 dark:border-gray-700 transition-all duration-200 folder-item"
                                     :draggable="isSorting && currentView === 'home' && !searchQuery"
                                     @dragstart="handleDragStart($event, folder, 'folder')"
                                     @dragend="handleDragEnd($event)"
                                     @click="!isSorting && currentView === 'home' ? currentFolderId = folder.id : null"
                                     :class="{
                                        'opacity-40 scale-95 shadow-lg': draggedItem?.type === 'folder' && draggedItem?.id === folder.id,
                                        'border-blue-500 shadow-lg shadow-blue-500/20 bg-blue-50 dark:bg-blue-900/20': dropTarget?.type === 'folder' && dropTarget?.id === folder.id,
                                        'cursor-grab active:cursor-grabbing': isSorting && currentView === 'home' && !searchQuery,
                                        'cursor-pointer': !isSorting && currentView === 'home'
                                     }">
                                    <div class="flex flex-col items-center text-center">
                                        <div class="w-12 h-12 mb-3 text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform pointer-events-none">
                                            <svg class="w-7 h-7" fill="currentColor" viewBox="0 0 20 20"><path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path></svg>
                                        </div>
                                        <h3 class="text-sm font-medium text-gray-900 dark:text-gray-200 truncate w-full pointer-events-none" x-text="folder.name"></h3>
                                        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 pointer-events-none" x-text="currentView === 'home' ? (folders.filter(f => f.parent_id === folder.id).length + ' ${t.dashboard.folders}, ' + getFolderBookmarkCount(folder.id) + ' ${t.dashboard.bookmarks}') : '${t.dashboard.deleted}'"></p>
                                    </div>

                                    <!-- Home View Actions -->
                                    <div x-show="currentView === 'home' && !isSorting" class="absolute top-2 right-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-all">
                                        <button @click.stop="openFolderModal(folder)" class="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-full" title="${t.dashboard.rename}">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                        </button>
                                        <button @click.stop="deleteFolder(folder.id)" class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full" title="${t.dashboard.delete}">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                        </button>
                                    </div>

                                    <!-- Trash View Actions -->
                                    <div x-show="currentView === 'trash'" class="absolute inset-0 bg-black bg-opacity-50 rounded-xl flex items-center justify-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                                        <button @click.stop="restoreFolder(folder.id)" class="p-2 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors" title="${t.dashboard.restore}">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                        </button>
                                        <button @click.stop="permanentDeleteFolder(folder.id)" class="p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors" title="${t.dashboard.permanentDelete}">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                        </button>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- Bookmarks Grid -->
                    <div x-show="currentBookmarks.length > 0"
                         x-transition:enter="transition ease-out duration-300"
                         x-transition:enter-start="opacity-0 transform scale-95"
                         x-transition:enter-end="opacity-100 transform scale-100">
                        <h3 class="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-4">${t.dashboard.bookmarks}</h3>
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                             @dragover.prevent="handleDragOver($event, 'bookmark')"
                             @drop="handleDrop($event, 'bookmark')">
                            <template x-for="bookmark in currentBookmarks" :key="bookmark.id">
                                <div class="group relative bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm hover:shadow-md border-2 border-gray-100 dark:border-gray-700 transition-all duration-200 bookmark-item"
                                     :draggable="isSorting && currentView === 'home' && !searchQuery"
                                     @dragstart="handleDragStart($event, bookmark, 'bookmark')"
                                     @dragend="handleDragEnd($event)"
                                     :class="{
                                        'opacity-40 scale-95 shadow-lg': draggedItem?.type === 'bookmark' && draggedItem?.id === bookmark.id,
                                        'border-blue-500 shadow-lg shadow-blue-500/20 bg-blue-50 dark:bg-blue-900/20': dropTarget?.type === 'bookmark' && dropTarget?.id === bookmark.id,
                                        'cursor-grab active:cursor-grabbing': isSorting && currentView === 'home' && !searchQuery
                                     }">
                                    <a :href="currentView === 'home' && !isSorting ? bookmark.url : '#'" :target="currentView === 'home' && !isSorting ? '_blank' : ''" class="flex items-start space-x-3" :class="isSorting ? 'cursor-default' : ''">
                                        <div class="flex-shrink-0 w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center text-gray-500 dark:text-gray-400 font-bold text-lg uppercase pointer-events-none">
                                            <img :src="'https://www.google.com/s2/favicons?sz=64&domain=' + bookmark.url" class="w-6 h-6" @error="$el.style.display='none'" />
                                            <span x-show="!$el.previousElementSibling || $el.previousElementSibling.style.display === 'none'" x-text="bookmark.title.charAt(0)"></span>
                                        </div>
                                        <div class="flex-1 min-w-0 pr-16 pointer-events-none">
                                            <h3 class="text-sm font-medium text-gray-900 dark:text-gray-200 truncate" x-text="bookmark.title"></h3>
                                            <p class="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5" x-text="bookmark.url"></p>
                                        </div>
                                    </a>

                                    <!-- Home View Actions -->
                                    <div x-show="currentView === 'home' && !isSorting" class="absolute top-3 right-3 flex space-x-1 opacity-0 group-hover:opacity-100 transition-all">
                                        <button @click.prevent="openBookmarkModal(bookmark)" class="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-full" title="${t.dashboard.rename}">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
                                        </button>
                                        <button @click.prevent="deleteBookmark(bookmark.id)" class="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-full" title="${t.dashboard.delete}">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                        </button>
                                    </div>

                                    <!-- Trash View Actions -->
                                    <div x-show="currentView === 'trash'" class="absolute inset-0 bg-black bg-opacity-50 rounded-xl flex items-center justify-center space-x-2 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                                        <button @click.stop="restoreBookmark(bookmark.id)" class="p-2 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors" title="${t.dashboard.restore}">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                                        </button>
                                        <button @click.stop="permanentDeleteBookmark(bookmark.id)" class="p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors" title="${t.dashboard.permanentDelete}">
                                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                                        </button>
                                    </div>
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- Empty State -->
                    <div x-show="currentFolders.length === 0 && currentBookmarks.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
                        <div class="w-24 h-24 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-6">
                            <svg x-show="currentView === 'home' && !searchQuery" class="w-12 h-12 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
                            <svg x-show="currentView === 'trash'" class="w-12 h-12 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            <svg x-show="searchQuery" class="w-12 h-12 text-gray-400 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
                        </div>
                        <h3 class="text-xl font-medium text-gray-900 dark:text-gray-200 mb-2" x-text="currentView === 'trash' ? '${t.dashboard.emptyTrashTitle}' : (searchQuery ? '${t.dashboard.notFoundTitle}' : '${t.dashboard.emptyHomeTitle}')"></h3>
                        <p class="text-gray-500 dark:text-gray-400 max-w-sm mx-auto mb-8" x-text="currentView === 'trash' ? '${t.dashboard.emptyTrashDesc}' : (searchQuery ? '${t.dashboard.notFoundDesc}' : '${t.dashboard.emptyHomeDesc}')"></p>
                        <div class="flex space-x-4" x-show="currentView === 'home' && !searchQuery">
                            <button @click="openFolderModal()" :disabled="isOperationPending || isSorting" :class="{'opacity-50 cursor-not-allowed': isOperationPending || isSorting}" class="px-6 py-3 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium transition-colors">
                                ${t.dashboard.newFolder}
                            </button>
                            <button @click="openBookmarkModal()" :disabled="isOperationPending || isSorting" :class="{'opacity-50 cursor-not-allowed': isOperationPending || isSorting}" class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-lg transition-colors">
                                ${t.dashboard.addBookmark}
                            </button>
                        </div>
                    </div>

                
            </main>
        </div>

        <!-- Toast Notification -->
        <div x-show="toast.show"
             x-transition:enter="transition ease-out duration-300"
             x-transition:enter-start="opacity-0 transform translate-y-2"
             x-transition:enter-end="opacity-100 transform translate-y-0"
             x-transition:leave="transition ease-in duration-200"
             x-transition:leave-start="opacity-100 transform translate-y-0"
             x-transition:leave-end="opacity-0 transform translate-y-2"
             class="fixed bottom-6 right-6 z-50" x-cloak>
            <div :class="{'bg-green-500': toast.type === 'success', 'bg-red-500': toast.type === 'error'}" class="text-white px-6 py-3 rounded-lg shadow-lg flex items-center space-x-3">
                <svg x-show="toast.type === 'success'" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                <svg x-show="toast.type === 'error'" class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                <span x-text="toast.message" class="font-medium"></span>
            </div>
        </div>

        <!-- Enhanced Loading Overlay -->
        <div x-show="isLoading"
             x-transition:enter="transition ease-out duration-200"
             x-transition:enter-start="opacity-0"
             x-transition:enter-end="opacity-100"
             x-transition:leave="transition ease-in duration-200"
             x-transition:leave-start="opacity-100"
             x-transition:leave-end="opacity-0"
             class="fixed inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-50 flex items-center justify-center"
             x-cloak>
            <div class="text-center">
                <!-- Spinning Loader -->
                <div class="relative w-20 h-20 mx-auto mb-4">
                    <div class="absolute inset-0 border-4 border-blue-200 dark:border-blue-900 rounded-full"></div>
                    <div class="absolute inset-0 border-4 border-transparent border-t-blue-500 rounded-full animate-spin"></div>
                    <div class="absolute inset-2 border-4 border-transparent border-t-purple-500 rounded-full animate-spin" style="animation-duration: 1.5s; animation-direction: reverse;"></div>
                </div>
                <p class="text-gray-600 dark:text-gray-400 font-medium" x-text="loadingText || '${t.dashboard.loading}'"></p>
            </div>
        </div>
    </div>
`;
