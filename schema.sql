-- 检测当前是否是全新数据库（即 folders 表是否尚不存在）
CREATE TABLE IF NOT EXISTS _init_status (is_new INTEGER);
INSERT INTO _init_status (is_new) 
SELECT 1 
WHERE NOT EXISTS (
  SELECT 1 FROM sqlite_master WHERE type='table' AND name='folders'
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER,
  sort_order INTEGER DEFAULT 0,
  is_deleted INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmarks (
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
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Triggers for updated_at
CREATE TRIGGER IF NOT EXISTS folders_updated_at
AFTER UPDATE OF name, parent_id, sort_order, is_deleted ON folders
FOR EACH ROW
BEGIN
  UPDATE folders SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS bookmarks_updated_at
AFTER UPDATE OF title, url, description, folder_id, sort_order, is_deleted ON bookmarks
FOR EACH ROW
BEGIN
  UPDATE bookmarks SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- Keep folder subtree and child bookmarks deletion state consistent
CREATE TRIGGER IF NOT EXISTS folders_propagate_delete_to_bookmarks
AFTER UPDATE OF is_deleted ON folders
FOR EACH ROW
WHEN NEW.is_deleted != OLD.is_deleted
BEGIN
  UPDATE bookmarks SET is_deleted = NEW.is_deleted WHERE folder_id = NEW.id;
END;

-- Prevent active bookmark from referencing a deleted folder on insert
CREATE TRIGGER IF NOT EXISTS bookmarks_prevent_active_in_deleted_folder_insert
BEFORE INSERT ON bookmarks
FOR EACH ROW
WHEN NEW.is_deleted = 0
  AND NEW.folder_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM folders WHERE id = NEW.folder_id AND is_deleted = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Cannot keep active bookmark inside deleted folder');
END;

-- Prevent active bookmark from referencing a deleted folder on update
CREATE TRIGGER IF NOT EXISTS bookmarks_prevent_active_in_deleted_folder_update
BEFORE UPDATE OF folder_id, is_deleted ON bookmarks
FOR EACH ROW
WHEN NEW.is_deleted = 0
  AND NEW.folder_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM folders WHERE id = NEW.folder_id AND is_deleted = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Cannot keep active bookmark inside deleted folder');
END;

-- Insert a root folder or some sample data if needed, but for now we keep it clean.

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_folders_is_deleted ON folders(is_deleted);
CREATE INDEX IF NOT EXISTS idx_folders_sort_order ON folders(sort_order ASC, name ASC) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_bookmarks_folder_id ON bookmarks(folder_id) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_bookmarks_is_deleted ON bookmarks(is_deleted);
CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks(created_at DESC) WHERE is_deleted = 0;
CREATE INDEX IF NOT EXISTS idx_bookmarks_url_folder ON bookmarks(url, folder_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_sort_order ON bookmarks(sort_order ASC, created_at ASC) WHERE is_deleted = 0;

-- Mark historical migrations as applied ONLY for new databases
CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO d1_migrations (name)
SELECT name_val FROM (
  SELECT '002_add_indexes.sql' AS name_val UNION ALL
  SELECT '003_upgrade_schema.sql' AS name_val UNION ALL
  SELECT '004_enforce_trash_consistency.sql' AS name_val UNION ALL
  SELECT '005_add_bookmark_sort_index.sql' AS name_val
)
WHERE (SELECT COUNT(*) FROM _init_status) > 0;

DROP TABLE IF EXISTS _init_status;


