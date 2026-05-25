DROP TABLE IF EXISTS bookmarks;
DROP TABLE IF EXISTS folders;
DROP TABLE IF EXISTS settings;

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
