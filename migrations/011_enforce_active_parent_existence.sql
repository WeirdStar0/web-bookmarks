-- Keep active records attached only to an existing active parent even when
-- callers bypass application-level existence checks or foreign-key settings.
CREATE TRIGGER IF NOT EXISTS folders_prevent_active_in_invalid_parent_insert
BEFORE INSERT ON folders
FOR EACH ROW
WHEN NEW.is_deleted = 0
  AND NEW.parent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM folders WHERE id = NEW.parent_id AND is_deleted = 0
  )
BEGIN
  SELECT RAISE(ABORT, 'Active folder parent must exist and not be deleted');
END;

CREATE TRIGGER IF NOT EXISTS folders_prevent_active_in_invalid_parent_update
BEFORE UPDATE OF parent_id, is_deleted ON folders
FOR EACH ROW
WHEN NEW.is_deleted = 0
  AND NEW.parent_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM folders WHERE id = NEW.parent_id AND is_deleted = 0
  )
BEGIN
  SELECT RAISE(ABORT, 'Active folder parent must exist and not be deleted');
END;

CREATE TRIGGER IF NOT EXISTS bookmarks_prevent_active_in_invalid_folder_insert
BEFORE INSERT ON bookmarks
FOR EACH ROW
WHEN NEW.is_deleted = 0
  AND NEW.folder_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM folders WHERE id = NEW.folder_id AND is_deleted = 0
  )
BEGIN
  SELECT RAISE(ABORT, 'Active bookmark folder must exist and not be deleted');
END;

CREATE TRIGGER IF NOT EXISTS bookmarks_prevent_active_in_invalid_folder_update
BEFORE UPDATE OF folder_id, is_deleted ON bookmarks
FOR EACH ROW
WHEN NEW.is_deleted = 0
  AND NEW.folder_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM folders WHERE id = NEW.folder_id AND is_deleted = 0
  )
BEGIN
  SELECT RAISE(ABORT, 'Active bookmark folder must exist and not be deleted');
END;
