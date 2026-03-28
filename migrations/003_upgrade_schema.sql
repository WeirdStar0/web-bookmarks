-- 增量更新数据库架构
-- 执行方式: wrangler d1 execute bookmarks-db --local --file=./migrations/003_upgrade_schema.sql

-- 1. 为 folders 添加 updated_at
ALTER TABLE folders ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 2. 为 bookmarks 添加 sort_order 和 updated_at
ALTER TABLE bookmarks ADD COLUMN sort_order INTEGER DEFAULT 0;
ALTER TABLE bookmarks ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 3. 添加触发器
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
