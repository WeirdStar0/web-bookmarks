-- Support unbounded trash listing without sorting all deleted rows in a temporary B-tree.
CREATE INDEX IF NOT EXISTS idx_folders_trash_name
    ON folders(name ASC) WHERE is_deleted = 1;

CREATE INDEX IF NOT EXISTS idx_bookmarks_trash_created_at
    ON bookmarks(created_at DESC) WHERE is_deleted = 1;

-- Recursive subtree triggers and parent-wide bookmark propagation must also
-- reach historical/deleted rows, which partial active-row indexes cannot cover.
CREATE INDEX IF NOT EXISTS idx_folders_parent_id_all
    ON folders(parent_id);

CREATE INDEX IF NOT EXISTS idx_bookmarks_folder_id_all
    ON bookmarks(folder_id);
