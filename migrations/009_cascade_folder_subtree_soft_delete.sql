-- Ensure legacy databases contain no active folder below a deleted ancestor.
WITH RECURSIVE deleted_tree(id, path) AS (
    SELECT id, printf('/%d/', id)
    FROM folders
    WHERE is_deleted = 1
    UNION ALL
    SELECT f.id, deleted_tree.path || printf('%d/', f.id)
    FROM folders f
    JOIN deleted_tree ON f.parent_id = deleted_tree.id
    WHERE instr(deleted_tree.path, printf('/%d/', f.id)) = 0
)
UPDATE folders
SET is_deleted = 1
WHERE is_deleted = 0
  AND id IN (SELECT id FROM deleted_tree);

-- A parent folder cannot be moved to the trash while retaining active children.
-- This complements the existing active-child-in-deleted-parent guards, which
-- only protect child inserts, moves, and restores.
CREATE TRIGGER IF NOT EXISTS folders_propagate_delete_to_descendant_folders
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
END;
