/**
 * Shared public column lists for every read endpoint.
 *
 * The dashboard, the trash view, the search endpoint and the export path must
 * expose the same shape; keeping one definition prevents a column from being
 * added to one endpoint and silently dropped from another.
 *
 * Nothing here includes internal-only columns. `client_request_id` in
 * particular is an idempotency implementation detail and is never returned.
 */
export const FOLDER_PUBLIC_COLUMNS = 'id, name, parent_id, sort_order, is_deleted, created_at, updated_at';
export const BOOKMARK_PUBLIC_COLUMNS = 'id, title, url, description, folder_id, sort_order, is_deleted, created_at, updated_at';
