-- Enforce the same 12-level invariant as the application layer for direct
-- writes and concurrent updates. The path checks make legacy cyclic graphs
-- terminate safely while the cycle trigger supplies the stronger rejection.
CREATE TRIGGER IF NOT EXISTS folders_prevent_excessive_depth_insert
BEFORE INSERT ON folders
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
  WITH RECURSIVE ancestors(id, parent_id, depth, path) AS (
    SELECT id, parent_id, 1, printf('/%d/', id)
    FROM folders
    WHERE id = NEW.parent_id
    UNION ALL
    SELECT f.id, f.parent_id, ancestors.depth + 1,
           ancestors.path || printf('%d/', f.id)
    FROM folders f
    JOIN ancestors ON f.id = ancestors.parent_id
    WHERE instr(ancestors.path, printf('/%d/', f.id)) = 0
  )
  SELECT CASE
    WHEN COALESCE((SELECT MAX(depth) FROM ancestors), 0) + 1 > 12
    THEN RAISE(ABORT, 'Folder depth cannot exceed 12')
  END;
END;

CREATE TRIGGER IF NOT EXISTS folders_prevent_excessive_depth_move
BEFORE UPDATE OF parent_id ON folders
FOR EACH ROW
WHEN NEW.parent_id IS NOT NULL
BEGIN
  WITH RECURSIVE
  ancestors(id, parent_id, depth, path) AS (
    SELECT id, parent_id, 1, printf('/%d/', id)
    FROM folders
    WHERE id = NEW.parent_id
    UNION ALL
    SELECT f.id, f.parent_id, ancestors.depth + 1,
           ancestors.path || printf('%d/', f.id)
    FROM folders f
    JOIN ancestors ON f.id = ancestors.parent_id
    WHERE instr(ancestors.path, printf('/%d/', f.id)) = 0
  ),
  descendants(id, depth, path) AS (
    SELECT id, 1, printf('/%d/', id)
    FROM folders
    WHERE id = NEW.id
    UNION ALL
    SELECT f.id, descendants.depth + 1,
           descendants.path || printf('%d/', f.id)
    FROM folders f
    JOIN descendants ON f.parent_id = descendants.id
    WHERE instr(descendants.path, printf('/%d/', f.id)) = 0
  )
  SELECT CASE
    WHEN COALESCE((SELECT MAX(depth) FROM ancestors), 0)
       + COALESCE((SELECT MAX(depth) FROM descendants), 1) > 12
    THEN RAISE(ABORT, 'Folder depth cannot exceed 12')
  END;
END;
