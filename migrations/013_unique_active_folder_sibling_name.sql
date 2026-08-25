-- Prevent concurrent writes from creating duplicate active folders under the same parent.
-- COALESCE makes the root parent (NULL) share one uniqueness bucket.
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_active_sibling_name
    ON folders(COALESCE(parent_id, 0), name)
    WHERE is_deleted = 0;
