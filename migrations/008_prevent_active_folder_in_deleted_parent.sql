-- Keep the active folder tree consistent even when writes bypass application
-- preflight checks or interleave with a soft-delete operation.
CREATE TRIGGER IF NOT EXISTS folders_prevent_active_in_deleted_parent_insert
BEFORE INSERT ON folders
FOR EACH ROW
WHEN NEW.is_deleted = 0
  AND NEW.parent_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM folders WHERE id = NEW.parent_id AND is_deleted = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Cannot keep active folder inside deleted parent folder');
END;

CREATE TRIGGER IF NOT EXISTS folders_prevent_active_in_deleted_parent_update
BEFORE UPDATE OF parent_id, is_deleted ON folders
FOR EACH ROW
WHEN NEW.is_deleted = 0
  AND NEW.parent_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM folders WHERE id = NEW.parent_id AND is_deleted = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'Cannot keep active folder inside deleted parent folder');
END;
