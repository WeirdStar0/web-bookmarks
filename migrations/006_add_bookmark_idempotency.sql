-- Run: wrangler d1 execute bookmarks-db --remote --file=./migrations/006_add_bookmark_idempotency.sql
-- Adds a client-generated idempotency key for extension bookmark saves.
-- Existing rows remain NULL and are unaffected by the partial unique index.

ALTER TABLE bookmarks ADD COLUMN client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_client_request_id
ON bookmarks(client_request_id)
WHERE client_request_id IS NOT NULL;
