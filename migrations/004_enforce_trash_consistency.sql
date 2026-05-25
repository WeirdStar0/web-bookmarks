-- Enforce folder/bookmark trash consistency at DB level
-- Run: wrangler d1 execute bookmarks-db --local --file=./migrations/004_enforce_trash_consistency.sql

-- Backfill existing inconsistent data before adding strict triggers
UPDATE bookmarks
SET is_deleted = 1
WHERE folder_id IS NOT NULL
  AND folder_id IN (SELECT id FROM folders WHERE is_deleted = 1)
  AND is_deleted = 0;

-- Keep folder subtree and child bookmarks deletion state consistent
CREATE TRIGGER IF NOT EXISTS folders_propagate_delete_to_bookmarks
AFTER UPDATE OF is_deleted ON folders
FOR EACH ROW
WHEN NEW.is_deleted != OLD.is_deleted
BEGIN
  UPDATE bookmarks
  SET is_deleted = NEW.is_deleted
  WHERE folder_id = NEW.id;
END;

-- Prevent active bookmark from referencing a deleted folder on insert
CREATE TRIGGER IF NOT EXISTS bookmarks_prevent_active_in_deleted_folder_insert
BEFORE INSERT ON bookmarks
FOR EACH ROW
WHEN NEW.is_deleted = 0
  AND NEW.folder_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM folders
    WHERE id = NEW.folder_id
      AND is_deleted = 1
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
    SELECT 1
    FROM folders
    WHERE id = NEW.folder_id
      AND is_deleted = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Cannot keep active bookmark inside deleted folder');
END;
