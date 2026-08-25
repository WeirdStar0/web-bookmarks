-- Enforce the folder tree invariant at the database boundary.
-- Application-level checks improve UX, but concurrent moves can otherwise
-- pass separate preflight reads and form a cycle.
CREATE TRIGGER IF NOT EXISTS folders_prevent_circular_parent
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
END;
