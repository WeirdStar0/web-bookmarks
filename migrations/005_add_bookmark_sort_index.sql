-- Add missing sort_order index for bookmarks
-- Run: wrangler d1 execute bookmarks-db --remote --file=./migrations/005_add_bookmark_sort_index.sql
-- Note: This index is already included in the auto-init schema (src/db/schema.ts),
-- so this migration is only needed for databases initialized before this index was added.

CREATE INDEX IF NOT EXISTS idx_bookmarks_sort_order ON bookmarks(sort_order ASC, created_at ASC) WHERE is_deleted = 0;
