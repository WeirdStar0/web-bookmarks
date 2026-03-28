export const INIT_SQL = [
    `CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER,
        sort_order INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        description TEXT,
        folder_id INTEGER,
        sort_order INTEGER DEFAULT 0,
        is_deleted INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id) WHERE is_deleted = 0`,
    `CREATE INDEX IF NOT EXISTS idx_folders_is_deleted ON folders(is_deleted)`,
    `CREATE INDEX IF NOT EXISTS idx_folders_sort_order ON folders(sort_order ASC, name ASC) WHERE is_deleted = 0`,
    `CREATE INDEX IF NOT EXISTS idx_bookmarks_folder_id ON bookmarks(folder_id) WHERE is_deleted = 0`,
    `CREATE INDEX IF NOT EXISTS idx_bookmarks_is_deleted ON bookmarks(is_deleted)`,
    `CREATE INDEX IF NOT EXISTS idx_bookmarks_sort_order ON bookmarks(sort_order ASC, created_at ASC) WHERE is_deleted = 0`,
    `CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks(created_at DESC) WHERE is_deleted = 0`,
    `CREATE INDEX IF NOT EXISTS idx_bookmarks_url_folder ON bookmarks(url, folder_id)`
];
