loggedIn: false,
isCheckingAuth: true,
loginForm: { username: '', password: '' },
loginError: '',

folders: [],
bookmarks: [],
bookmarkCounts: {},
currentFolderId: (() => {
    try {
        const value = JSON.parse(localStorage.getItem('currentFolderId'));
        return Number.isInteger(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
})(),

searchQuery: '',
searchResults: null,
searchPending: false,
currentView: localStorage.getItem('currentView') || 'home',
trashFolders: [],
trashBookmarks: [],
expandedFolders: {},
folderCounts: {},

isLoading: false,
isFolderLoading: false,
loadingText: '',
isOperationPending: false,
mobileMenuOpen: false,
toast: { show: false, message: '', type: 'success' },

editMode: false,
editingId: null,

showFolderModal: false,
newFolderName: '',
newFolderParentId: null,

showBookmarkModal: false,
newBookmarkTitle: '',
newBookmarkUrl: '',
newBookmarkDescription: '',
newBookmarkFolderId: null,
selectorExpanded: {},
selectorOpen: false,

showSettingsModal: false,
settingsForm: { username: '', password: '' },

showConfirmModal: false,
confirmMessage: '',
confirmCallback: null,

darkMode: localStorage.getItem('darkMode') === 'true',

draggedItem: null,
dropTarget: null,
isSorting: false,

t: window.translations,

	_sidebarCache: null,
	_sidebarDirty: true,
							_dataLoadVersion: 0,
				_loadedFolderId: null,

			_trashLoadVersion: 0,
			_authCheckVersion: 0,
			_searchRequestVersion: 0,
			_searchTimer: null,
			_modalReturnFocus: null
