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
        client_request_id TEXT,
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
    `CREATE INDEX IF NOT EXISTS idx_bookmarks_url_folder ON bookmarks(url, folder_id)`,
    `CREATE INDEX IF NOT EXISTS idx_folders_trash_name ON folders(name ASC) WHERE is_deleted = 1`,
    `CREATE INDEX IF NOT EXISTS idx_bookmarks_trash_created_at ON bookmarks(created_at DESC) WHERE is_deleted = 1`,
    `CREATE INDEX IF NOT EXISTS idx_folders_parent_id_all ON folders(parent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_bookmarks_folder_id_all ON bookmarks(folder_id)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_client_request_id ON bookmarks(client_request_id) WHERE client_request_id IS NOT NULL`,
    // SQLite treats NULL values as distinct in UNIQUE indexes. Coalesce the
    // root parent to 0 so root-level siblings are also protected.
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_active_sibling_name
        ON folders(COALESCE(parent_id, 0), name)
        WHERE is_deleted = 0`,
    `CREATE TRIGGER IF NOT EXISTS folders_prevent_circular_parent
    BEFORE UPDATE OF parent_id ON folders
    FOR EACH ROW
    WHEN NEW.parent_id IS NOT NULL
    BEGIN
      SELECT CASE
        WHEN NEW.parent_id = NEW.id
        THEN RAISE(ABORT, 'Folder parent cannot reference itself')
      END;

      WITH RECURSIVE ancestors(id, parent_id) AS (
        SELECT id, parent_id FROM folders WHERE id = NEW.parent_id
        UNION
        SELECT f.id, f.parent_id
        FROM folders f
        JOIN ancestors a ON f.id = a.parent_id
      )
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
        THEN RAISE(ABORT, 'Folder parent cannot create a cycle')
      END;
    END`,
    `CREATE TRIGGER IF NOT EXISTS folders_prevent_excessive_depth_insert
    BEFORE INSERT ON folders
    FOR EACH ROW
    WHEN NEW.parent_id IS NOT NULL
    BEGIN
      WITH RECURSIVE ancestors(id, parent_id, depth, path) AS (
        SELECT id, parent_id, 1, printf('/%d/', id) FROM folders WHERE id = NEW.parent_id
        UNION ALL
        SELECT f.id, f.parent_id, ancestors.depth + 1, ancestors.path || printf('%d/', f.id)
        FROM folders f JOIN ancestors ON f.id = ancestors.parent_id
        WHERE instr(ancestors.path, printf('/%d/', f.id)) = 0
      )
      SELECT CASE
        WHEN COALESCE((SELECT MAX(depth) FROM ancestors), 0) + 1 > 12
        THEN RAISE(ABORT, 'Folder depth cannot exceed 12')
      END;
    END`,
    `CREATE TRIGGER IF NOT EXISTS folders_prevent_excessive_depth_move
    BEFORE UPDATE OF parent_id ON folders
    FOR EACH ROW
    WHEN NEW.parent_id IS NOT NULL
    BEGIN
      WITH RECURSIVE
      ancestors(id, parent_id, depth, path) AS (
        SELECT id, parent_id, 1, printf('/%d/', id) FROM folders WHERE id = NEW.parent_id
        UNION ALL
        SELECT f.id, f.parent_id, ancestors.depth + 1, ancestors.path || printf('%d/', f.id)
        FROM folders f JOIN ancestors ON f.id = ancestors.parent_id
        WHERE instr(ancestors.path, printf('/%d/', f.id)) = 0
      ),
      descendants(id, depth, path) AS (
        SELECT id, 1, printf('/%d/', id) FROM folders WHERE id = NEW.id
        UNION ALL
        SELECT f.id, descendants.depth + 1, descendants.path || printf('%d/', f.id)
        FROM folders f JOIN descendants ON f.parent_id = descendants.id
        WHERE instr(descendants.path, printf('/%d/', f.id)) = 0
      )
      SELECT CASE
        WHEN COALESCE((SELECT MAX(depth) FROM ancestors), 0)
           + COALESCE((SELECT MAX(depth) FROM descendants), 1) > 12
        THEN RAISE(ABORT, 'Folder depth cannot exceed 12')
      END;
    END`,
    `CREATE TRIGGER IF NOT EXISTS folders_prevent_active_in_deleted_parent_insert
    BEFORE INSERT ON folders
    FOR EACH ROW
    WHEN NEW.is_deleted = 0
      AND NEW.parent_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM folders WHERE id = NEW.parent_id AND is_deleted = 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'Cannot keep active folder inside deleted parent folder');
    END`,
    `CREATE TRIGGER IF NOT EXISTS folders_prevent_active_in_deleted_parent_update
    BEFORE UPDATE OF parent_id, is_deleted ON folders
    FOR EACH ROW
    WHEN NEW.is_deleted = 0
      AND NEW.parent_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM folders WHERE id = NEW.parent_id AND is_deleted = 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'Cannot keep active folder inside deleted parent folder');
    END`,
    `CREATE TRIGGER IF NOT EXISTS folders_prevent_active_in_invalid_parent_insert
    BEFORE INSERT ON folders
    FOR EACH ROW
    WHEN NEW.is_deleted = 0
      AND NEW.parent_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM folders WHERE id = NEW.parent_id AND is_deleted = 0)
    BEGIN
      SELECT RAISE(ABORT, 'Active folder parent must exist and not be deleted');
    END`,
    `CREATE TRIGGER IF NOT EXISTS folders_prevent_active_in_invalid_parent_update
    BEFORE UPDATE OF parent_id, is_deleted ON folders
    FOR EACH ROW
    WHEN NEW.is_deleted = 0
      AND NEW.parent_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM folders WHERE id = NEW.parent_id AND is_deleted = 0)
    BEGIN
      SELECT RAISE(ABORT, 'Active folder parent must exist and not be deleted');
    END`,
    `CREATE TRIGGER IF NOT EXISTS bookmarks_prevent_active_in_invalid_folder_insert
    BEFORE INSERT ON bookmarks
    FOR EACH ROW
    WHEN NEW.is_deleted = 0
      AND NEW.folder_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM folders WHERE id = NEW.folder_id AND is_deleted = 0)
    BEGIN
      SELECT RAISE(ABORT, 'Active bookmark folder must exist and not be deleted');
    END`,
    `CREATE TRIGGER IF NOT EXISTS bookmarks_prevent_active_in_invalid_folder_update
    BEFORE UPDATE OF folder_id, is_deleted ON bookmarks
    FOR EACH ROW
    WHEN NEW.is_deleted = 0
      AND NEW.folder_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM folders WHERE id = NEW.folder_id AND is_deleted = 0)
    BEGIN
      SELECT RAISE(ABORT, 'Active bookmark folder must exist and not be deleted');
    END`,
    `CREATE TRIGGER IF NOT EXISTS folders_propagate_delete_to_descendant_folders
    AFTER UPDATE OF is_deleted ON folders
    FOR EACH ROW
    WHEN NEW.is_deleted = 1 AND OLD.is_deleted = 0
    BEGIN
      UPDATE folders
      SET is_deleted = 1
      WHERE is_deleted = 0
        AND id IN (
          WITH RECURSIVE descendants(id, path) AS (
            SELECT id, printf('/%d/', id) FROM folders WHERE id = NEW.id
            UNION ALL
            SELECT f.id, descendants.path || printf('%d/', f.id)
            FROM folders f
            JOIN descendants ON f.parent_id = descendants.id
            WHERE instr(descendants.path, printf('/%d/', f.id)) = 0
          )
          SELECT id FROM descendants WHERE id != NEW.id
        );
    END`,
    `CREATE TRIGGER IF NOT EXISTS folders_updated_at
    AFTER UPDATE OF name, parent_id, sort_order, is_deleted ON folders
    FOR EACH ROW
    BEGIN
      UPDATE folders SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END`,
    `CREATE TRIGGER IF NOT EXISTS bookmarks_updated_at
    AFTER UPDATE OF title, url, description, folder_id, sort_order, is_deleted ON bookmarks
    FOR EACH ROW
    BEGIN
      UPDATE bookmarks SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
    END`,
    `CREATE TRIGGER IF NOT EXISTS folders_propagate_delete_to_bookmarks
    AFTER UPDATE OF is_deleted ON folders
    FOR EACH ROW
    WHEN NEW.is_deleted != OLD.is_deleted
    BEGIN
      UPDATE bookmarks SET is_deleted = NEW.is_deleted WHERE folder_id = NEW.id;
    END`,
    `CREATE TRIGGER IF NOT EXISTS bookmarks_prevent_active_in_deleted_folder_insert
    BEFORE INSERT ON bookmarks
    FOR EACH ROW
    WHEN NEW.is_deleted = 0
      AND NEW.folder_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM folders WHERE id = NEW.folder_id AND is_deleted = 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'Cannot keep active bookmark inside deleted folder');
    END`,
    `CREATE TRIGGER IF NOT EXISTS bookmarks_prevent_active_in_deleted_folder_update
    BEFORE UPDATE OF folder_id, is_deleted ON bookmarks
    FOR EACH ROW
    WHEN NEW.is_deleted = 0
      AND NEW.folder_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM folders WHERE id = NEW.folder_id AND is_deleted = 1
      )
    BEGIN
      SELECT RAISE(ABORT, 'Cannot keep active bookmark inside deleted folder');
    END`,
    `CREATE TABLE IF NOT EXISTS d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `INSERT OR IGNORE INTO d1_migrations (name) VALUES 
        ('001_initial_schema.sql'),
        ('002_add_indexes.sql'),
        ('003_upgrade_schema.sql'),
        ('004_enforce_trash_consistency.sql'),
        ('005_add_bookmark_sort_index.sql'),
        ('006_add_bookmark_idempotency.sql'),
        ('007_prevent_folder_cycles.sql'),
        ('008_prevent_active_folder_in_deleted_parent.sql'),
        ('009_cascade_folder_subtree_soft_delete.sql'),
        ('010_enforce_folder_depth_limit.sql'),
        ('011_enforce_active_parent_existence.sql'),
        ('012_add_trash_and_hierarchy_indexes.sql'),
        ('013_unique_active_folder_sibling_name.sql')`
];
