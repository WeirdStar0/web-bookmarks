loggedIn: false,
isCheckingAuth: true,
loginForm: { username: '', password: '' },
loginError: '',

folders: [],
bookmarks: [],
currentFolderId: JSON.parse(localStorage.getItem('currentFolderId')) || null,

searchQuery: '',
currentView: localStorage.getItem('currentView') || 'home',
trashFolders: [],
trashBookmarks: [],
expandedFolders: {},
folderCounts: {},

isLoading: false,
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
	_sidebarDirty: true
