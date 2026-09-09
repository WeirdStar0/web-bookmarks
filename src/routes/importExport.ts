import type { ApiApp } from './types';
import { BOOKMARK_PUBLIC_COLUMNS, FOLDER_PUBLIC_COLUMNS } from './columns';
import { bookmarkSchema, folderSchema } from '../utils/schemas';
import { err, ErrCode } from '../utils/common';

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const MAX_IMPORT_TOKENS = 5000;
const MAX_IMPORT_TAG_BYTES = 4096;
const IMPORT_DEDUP_QUERY_CHUNK = 90;
const IMPORT_BOOKMARK_BATCH_SIZE = 50;
// Leave room for authentication, rate limiting, and future middleware calls.
const IMPORT_DB_CALL_BUDGET = 40;

class PayloadTooLargeError extends Error {}

async function readTextWithinLimit(request: Request, maxBytes: number): Promise<string> {
    if (!request.body) return '';

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                // Cancellation is a best-effort resource release. A stream
                // implementation may reject cancel() after an upstream error;
                // that must not mask the deterministic 413 response.
                await reader.cancel().catch(() => undefined);
                throw new PayloadTooLargeError();
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

type FolderRow = {
    id: number;
    name: string;
    parent_id: number | null;
};

type BookmarkRow = {
    id: number;
    title: string;
    url: string;
    folder_id: number | null;
};

function importStorageFailureMessage(error: unknown, fallback: string): string {
    console.error('Bookmark import storage operation failed:', error);
    return fallback;
}

/** 文件夹去重键：父 ID 前缀 + 名称，与 (name, parent_id) 查询语义一致 */
function folderKey(name: string, parentId: number | null): string {
    return `${parentId === null ? '' : String(parentId)}:${name}`;
}

function decodeHtmlEntities(str: string): string {
    return str
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x2F;/g, '/')
        .replace(/&mdash;/g, '—')
        .replace(/&#(\d+);/g, (match, dec) => {
            try {
                const code = parseInt(dec, 10);
                if (code >= 0 && code <= 0x10ffff) {
                    return String.fromCodePoint(code);
                }
            } catch {}
            return match;
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
            try {
                const code = parseInt(hex, 16);
                if (code >= 0 && code <= 0x10ffff) {
                    return String.fromCodePoint(code);
                }
            } catch {}
            return match;
        })
        .replace(/&amp;/g, '&');
}

function generateNetscapeHTML(folders: FolderRow[], bookmarks: BookmarkRow[]): string {
    const escapeHtml = (s: string | number | null | undefined) => {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    const safeExportUrl = (rawUrl: string) => {
        try {
            const parsed = new URL(rawUrl);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? rawUrl : 'about:blank';
        } catch {
            return 'about:blank';
        }
    };
    const foldersByParent = new Map<number | null, FolderRow[]>();
    const bookmarksByFolder = new Map<number | null, BookmarkRow[]>();
    const renderedFolderIds = new Set<number>();
    const renderedBookmarkIds = new Set<number>();
    for (const folder of folders) {
        const siblings = foldersByParent.get(folder.parent_id) || [];
        siblings.push(folder);
        foldersByParent.set(folder.parent_id, siblings);
    }
    for (const bookmark of bookmarks) {
        const siblings = bookmarksByFolder.get(bookmark.folder_id) || [];
        siblings.push(bookmark);
        bookmarksByFolder.set(bookmark.folder_id, siblings);
    }

    const renderFolder = (folder: FolderRow, indent: string): string => {
        if (renderedFolderIds.has(folder.id)) return '';
        renderedFolderIds.add(folder.id);
        return `${indent}<DT><H3>${escapeHtml(folder.name)}</H3>\n`
            + renderBranch(folder.id, indent + '    ')
            + `${indent}</DT>\n`;
    };

    const renderBranch = (parentId: number | null, indent = ''): string => {
        const childFolders = foldersByParent.get(parentId) || [];
        const childBookmarks = bookmarksByFolder.get(parentId) || [];
        const folderEntries = childFolders.map((folder) => renderFolder(folder, indent + '    ')).join('');
        const bookmarkEntries = childBookmarks.map((bookmark) => {
            if (renderedBookmarkIds.has(bookmark.id)) return '';
            renderedBookmarkIds.add(bookmark.id);
            return `${indent}    <DT><A HREF="${escapeHtml(safeExportUrl(bookmark.url))}">${escapeHtml(bookmark.title)}</A>\n`;
        }).join('');
        if (!folderEntries && !bookmarkEntries) return '';
        return `\n${indent}<DL><p>\n${folderEntries}${bookmarkEntries}${indent}</DL><p>\n`;
    };

    let html = renderBranch(null);
    // Legacy/manual database edits may have left folders in a cycle or under a
    // missing parent. Export them as separate root branches instead of silently
    // losing data or recursing forever.
    for (const folder of folders) {
        if (!renderedFolderIds.has(folder.id)) {
            html += `\n<DL><p>\n${renderFolder(folder, '    ')}</DL><p>\n`;
        }
    }
    // Preserve bookmarks whose folder no longer exists as root-level entries.
    const orphanBookmarks = bookmarks.filter((bookmark) => !renderedBookmarkIds.has(bookmark.id));
    if (orphanBookmarks.length > 0) {
        html += `\n<DL><p>\n`;
        for (const bookmark of orphanBookmarks) {
            renderedBookmarkIds.add(bookmark.id);
            html += `    <DT><A HREF="${escapeHtml(safeExportUrl(bookmark.url))}">${escapeHtml(bookmark.title)}</A>\n`;
        }
        html += `</DL><p>\n`;
    }
    return html;
}

export function registerImportExportRoutes(app: ApiApp) {
    app.get('/export', async (c) => {
        const { results: folders } = await c.env.DB.prepare(`SELECT ${FOLDER_PUBLIC_COLUMNS} FROM folders WHERE is_deleted = 0 ORDER BY sort_order ASC, name ASC`).all<FolderRow>();
        const { results: bookmarks } = await c.env.DB.prepare(`SELECT ${BOOKMARK_PUBLIC_COLUMNS} FROM bookmarks WHERE is_deleted = 0 ORDER BY sort_order ASC, created_at ASC`).all<BookmarkRow>();
        let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
`;
        html += generateNetscapeHTML(folders, bookmarks);
        c.header('Content-Type', 'application/x-netscape-bookmark');
        c.header('Content-Disposition', 'attachment; filename="bookmarks.html"');
        return c.body(html);
    });

    app.post('/import', async (c) => {
        const contentLength = c.req.header('Content-Length');
        if (contentLength && parseInt(contentLength, 10) > MAX_IMPORT_BYTES) {
            return c.json({ error: 'PAYLOAD_TOO_LARGE', message: '导入文件大小不能超过 2MB' }, 413);
        }

        let body: string;
        try {
            body = await readTextWithinLimit(c.req.raw, MAX_IMPORT_BYTES);
        } catch (error) {
            if (error instanceof PayloadTooLargeError) {
                return c.json({ error: 'PAYLOAD_TOO_LARGE', message: '导入文件大小不能超过 2MB' }, 413);
            }
            throw error;
        }

        const isDryRun = c.req.query('dryRun') === 'true';
        const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim();

        // Validate candidate tag volume before applying the richer parser. This
        // also bounds malformed inputs such as thousands of unclosed <H3> tags
        // that otherwise produce no match yet force repeated regex scanning.
        const candidateTagCount = body.match(/<(?:\/?DL\b|H3\b|A\b)/gi)?.length || 0;
        if (candidateTagCount > MAX_IMPORT_TOKENS) {
            return c.json({
                error: 'COMPLEXITY_LIMIT_EXCEEDED',
                message: `导入文件过于复杂，匹配节点总数超过上限（${MAX_IMPORT_TOKENS}）`,
            }, 400);
        }

        // Bound every attribute/text scan to keep parsing cost proportional to
        // the upload size even when tags are malformed or intentionally lack
        // their closing delimiter. The limits exceed the validated URL/title
        // sizes and retain compatibility with ordinary Netscape exports.
        const tokens = body.matchAll(new RegExp(
            `(<(?:DL|\\/DL)\\b[^>]{0,${MAX_IMPORT_TAG_BYTES}}>)`
            + `|<H3\\b[^>]{0,${MAX_IMPORT_TAG_BYTES}}>([\\s\\S]{0,${MAX_IMPORT_TAG_BYTES}}?)<\\/H3\\s*>`
            + `|<A\\b[^>]{0,${MAX_IMPORT_TAG_BYTES}}\\bHREF\\s*=\\s*["']?([^"'\\s>]{1,2048})["']?[^>]{0,${MAX_IMPORT_TAG_BYTES}}>([\\s\\S]{0,${MAX_IMPORT_TAG_BYTES}}?)<\\/A\\s*>`,
            'gi',
        ));

        const stack: (string | null)[] = [null]; // 栈中存储 tempId (string)
        let lastFolderTempId: string | null = null;

        // 一次性加载现有文件夹快照，解析期的去重全部走内存 Map。历史上这里
        // 逐文件夹查询数据库，大文件导入会超出 Workers 免费版 50 子请求预算。
        let folderSnapshot: Map<string, number>;
        try {
            const { results: snapshotRows } = await c.env.DB.prepare(
                'SELECT * FROM folders WHERE is_deleted = 0'
            ).all<{ id: number; name: string; parent_id: number | null }>();
            folderSnapshot = new Map(
                snapshotRows.map((row) => [folderKey(row.name, row.parent_id), row.id])
            );
        } catch (snapshotErr: unknown) {
            console.error('Import folder snapshot load failed:', snapshotErr);
            // 无法安全去重时宁可整体失败，也不能产生重复数据。
            return c.json(err(ErrCode.SERVER_ERROR, 'Import failed: could not load existing folders'), 500);
        }

        // 复杂度与限制条件
        let tokenCount = 0;
        const MAX_FOLDERS = 200;
        const MAX_BOOKMARKS = 2000;
        const MAX_DEPTH = 12;

        interface PlanFolder {
            tempId: string;
            name: string;
            parentTempId: string | null;
            dbId: number | null;
            isNew: boolean;
            isFailed?: boolean;
        }

        interface PlanBookmark {
            title: string;
            url: string;
            parentTempId: string | null;
        }

        const planFolders: PlanFolder[] = [];
        const planBookmarks: PlanBookmark[] = [];
        const candidates: (PlanBookmark & { dedupFolderId?: number | null; failedLookup?: boolean })[] = [];
        const failures: { type: 'folder' | 'bookmark'; name: string; error: string }[] = [];

        let importedFolders = 0;
        let skippedFolders = 0;
        let importedBookmarks = 0;
        let skippedBookmarks = 0;

        // --- 第一阶段：纯内存解析与校验 ---
        for (const match of tokens) {
            tokenCount++;
            if (tokenCount > MAX_IMPORT_TOKENS) {
                return c.json({
                    error: 'COMPLEXITY_LIMIT_EXCEEDED',
                    message: `导入文件过于复杂，匹配节点总数超过上限（${MAX_IMPORT_TOKENS}）`
                }, 400);
            }

            if (match[1]) {
                const tag = match[1].toUpperCase();
                if (tag.includes('/DL')) {
                    if (stack.length > 1) stack.pop();
                } else {
                    if (stack.length >= MAX_DEPTH) {
                        return c.json({
                            error: 'DEPTH_LIMIT_EXCEEDED',
                            message: `导入文件层级过深，最大允许嵌套 ${MAX_DEPTH} 层`
                        }, 400);
                    }
                    stack.push(lastFolderTempId);
                }
            } else if (match[2] !== undefined) {
                const folderName = decodeHtmlEntities(stripTags(match[2]));
                if (!folderName) continue;

                const parentTempId = stack[stack.length - 1];
                let isParentFailed = false;
                if (parentTempId !== null) {
                    const parentFolder = planFolders.find((f) => f.tempId === parentTempId);
                    if (parentFolder && parentFolder.isFailed) {
                        isParentFailed = true;
                    }
                }

                if (isParentFailed) {
                    const tempId = `temp-f-${planFolders.length + 1}`;
                    planFolders.push({
                        tempId,
                        name: folderName,
                        parentTempId,
                        dbId: null,
                        isNew: false,
                        isFailed: true,
                    });
                    failures.push({
                        type: 'folder',
                        name: folderName,
                        error: '父文件夹创建失败，级联跳过',
                    });
                    lastFolderTempId = tempId;
                    continue;
                }

                const folderResult = folderSchema.shape.name.safeParse(folderName);
                if (!folderResult.success) {
                    const tempId = `temp-f-${planFolders.length + 1}`;
                    planFolders.push({
                        tempId,
                        name: folderName,
                        parentTempId,
                        dbId: null,
                        isNew: false,
                        isFailed: true,
                    });
                    failures.push({ type: 'folder', name: folderName, error: folderResult.error.issues[0].message });
                    lastFolderTempId = tempId;
                    continue;
                }

                if (planFolders.length >= MAX_FOLDERS) {
                    return c.json({
                        error: 'LIMIT_EXCEEDED',
                        message: `导入文件夹数超出限制，单次最多允许 ${MAX_FOLDERS} 个`
                    }, 400);
                }

                // Dedupe 去重融合机制
                // 1. 查 Plan 内存
                const existingInPlan = planFolders.find(
                    (f) => f.parentTempId === parentTempId && f.name === folderName
                );

                if (existingInPlan) {
                    lastFolderTempId = existingInPlan.tempId;
                    skippedFolders++;
                } else {
                    // 2. 查快照 (仅当 parentTempId 在数据库已存在或为根级时)
                    let dbId: number | null = null;
                    let dedupKey: string | null = null;

                    if (parentTempId === null) {
                        dedupKey = folderKey(folderName, null);
                    } else {
                        const parentFolder = planFolders.find((f) => f.tempId === parentTempId);
                        if (parentFolder && parentFolder.dbId !== null) {
                            dedupKey = folderKey(folderName, parentFolder.dbId);
                        }
                    }

                    if (dedupKey !== null) {
                        dbId = folderSnapshot.get(dedupKey) ?? null;
                    }

                    const tempId = `temp-f-${planFolders.length + 1}`;
                    if (dbId !== null) {
                        planFolders.push({
                            tempId,
                            name: folderName,
                            parentTempId,
                            dbId,
                            isNew: false,
                        });
                        skippedFolders++;
                    } else {
                        planFolders.push({
                            tempId,
                            name: folderName,
                            parentTempId,
                            dbId: null,
                            isNew: true,
                        });
                        importedFolders++;
                    }
                    lastFolderTempId = tempId;
                }
            } else if (match[3]) {
                const url = decodeHtmlEntities(match[3]);
                const title = decodeHtmlEntities(stripTags(match[4] || url) || url);
                const parentTempId = stack[stack.length - 1];

                let isParentFailed = false;
                if (parentTempId !== null) {
                    const parentFolder = planFolders.find((f) => f.tempId === parentTempId);
                    if (parentFolder && parentFolder.isFailed) {
                        isParentFailed = true;
                    }
                }

                if (isParentFailed) {
                    failures.push({
                        type: 'bookmark',
                        name: title,
                        error: '父文件夹创建失败，级联跳过',
                    });
                    continue;
                }

                const bookmarkResult = bookmarkSchema.safeParse({ title, url, folder_id: null });
                if (!bookmarkResult.success) {
                    failures.push({ type: 'bookmark', name: title, error: bookmarkResult.error.issues[0].message });
                    continue;
                }

                // 查重推迟到解析完成后的批量分类阶段，避免逐条查询在大型导入时
                // 超出 Workers 子请求预算。
                candidates.push({
                    title: bookmarkResult.data.title,
                    url: bookmarkResult.data.url,
                    parentTempId,
                });
            }
        }

        // --- 批量去重分类：解析完成后一次性查库 ---
        // 逐条查询会在大型导入时超出 Workers 子请求预算；这里按 URL 分块 IN
        // 查询，一次判定全部候选。父级尚不存在于库中的候选无法查库去重，
        // 与历史行为一致地直接进入写入计划。
        const pairKey = (url: string, folderId: number | null) => `${url}\u0000${folderId === null ? '' : folderId}`;

        for (const candidate of candidates) {
            if (candidate.parentTempId === null) {
                candidate.dedupFolderId = null;
            } else {
                const parentFolder = planFolders.find((f) => f.tempId === candidate.parentTempId);
                if (parentFolder && parentFolder.dbId !== null) {
                    candidate.dedupFolderId = parentFolder.dbId;
                }
            }
        }

        const existingPairs = new Set<string>();
        const candidateUrls = [...new Set(
            candidates.filter((candidate) => candidate.dedupFolderId !== undefined).map((candidate) => candidate.url)
        )];
        for (let i = 0; i < candidateUrls.length; i += IMPORT_DEDUP_QUERY_CHUNK) {
            const chunk = candidateUrls.slice(i, i + IMPORT_DEDUP_QUERY_CHUNK);
            const placeholders = chunk.map(() => '?').join(', ');
            try {
                const { results } = await c.env.DB.prepare(
                    `SELECT url, folder_id FROM bookmarks WHERE is_deleted = 0 AND url IN (${placeholders})`
                ).bind(...chunk).all<{ url: string; folder_id: number | null }>();
                for (const row of results) {
                    existingPairs.add(pairKey(row.url, row.folder_id));
                }
            } catch (chunkErr: unknown) {
                // Do not fall back to one query per candidate: that error path
                // could exceed the Worker subrequest budget. Skipping every
                // candidate in the failed chunk is safer than writing data
                // whose duplicate status could not be determined.
                console.error('Bookmark deduplication chunk failed:', chunkErr);
                for (const candidate of candidates) {
                    if (candidate.dedupFolderId === undefined || !chunk.includes(candidate.url)) continue;
                    failures.push({ type: 'bookmark', name: candidate.title, error: importStorageFailureMessage(chunkErr, '数据库检索失败') });
                    candidate.failedLookup = true;
                }
            }
        }

        for (const candidate of candidates) {
            if (candidate.failedLookup) continue;

            // 1. 查 Plan 内存（同父同 URL 视为重复）
            const existingInPlan = planBookmarks.some(
                (b) => b.parentTempId === candidate.parentTempId && b.url === candidate.url
            );
            // 2. 查数据库已有数据（仅当父级已在库中时可判定）
            const existsInDb = candidate.dedupFolderId !== undefined
                && existingPairs.has(pairKey(candidate.url, candidate.dedupFolderId));

            if (existingInPlan || existsInDb) {
                skippedBookmarks++;
                continue;
            }

            if (planBookmarks.length >= MAX_BOOKMARKS) {
                return c.json({
                    error: 'LIMIT_EXCEEDED',
                    message: `导入书签数超出限制，单次最多允许 ${MAX_BOOKMARKS} 条`
                }, 400);
            }

            planBookmarks.push({
                title: candidate.title,
                url: candidate.url,
                parentTempId: candidate.parentTempId,
            });
            importedBookmarks++;
        }

        const estimatedDedupQueries = Math.ceil(candidateUrls.length / IMPORT_DEDUP_QUERY_CHUNK);
        const estimatedFolderBatchCalls = planFolders.some((folder) => folder.isNew && !folder.isFailed) ? 1 : 0;
        const estimatedLinkBatchCalls = planFolders.some((folder) => folder.isNew && !folder.isFailed && folder.parentTempId !== null) ? 1 : 0;
        const estimatedBookmarkBatchCalls = Math.ceil(planBookmarks.length / IMPORT_BOOKMARK_BATCH_SIZE);
        const estimatedDbCalls = 1
            + estimatedDedupQueries
            + estimatedFolderBatchCalls
            + estimatedLinkBatchCalls
            + estimatedBookmarkBatchCalls;
        if (estimatedDbCalls > IMPORT_DB_CALL_BUDGET) {
            return c.json({
                error: 'IMPORT_BUDGET_EXCEEDED',
                message: `导入任务预计需要 ${estimatedDbCalls} 次数据库调用，当前上限为 ${IMPORT_DB_CALL_BUDGET} 次，请拆分文件后重试`,
                estimatedDbCalls,
                maxDbCalls: IMPORT_DB_CALL_BUDGET,
            }, 400);
        }

        // --- 第二阶段：落库执行 (如果是 dryRun 则只返回数据，不修改数据库) ---
        if (isDryRun) {
            return c.json({
                success: true,
                dryRun: true,
                imported: { folders: importedFolders, bookmarks: importedBookmarks },
                skipped: { folders: skippedFolders, bookmarks: skippedBookmarks },
                failures: failures.length > 0 ? failures : undefined,
            });
        }

        // 维护虚拟 ID 到真实数据库 ID 的对应表
        const tempIdToRealIdMap = new Map<string, number | null | undefined>();

        // 1. 物理创建文件夹：两阶段批量写，替代历史上的逐条 INSERT。
        //    免费版每个请求只有 50 个子请求，逐条写入在大导入时必然超限。
        for (const folder of planFolders) {
            if (folder.isFailed) {
                tempIdToRealIdMap.set(folder.tempId, undefined);
                continue;
            }
            if (!folder.isNew) {
                tempIdToRealIdMap.set(folder.tempId, folder.dbId!);
            }
        }

        const newFolders = planFolders.filter((folder) => folder.isNew && !folder.isFailed);
        const MAX_SEQUENTIAL_FOLDER_FALLBACK = 10;
        const createFoldersSequentially = async () => {
            for (const folder of newFolders) {
                if (tempIdToRealIdMap.has(folder.tempId)) continue;
                const realParentId = folder.parentTempId === null ? null : tempIdToRealIdMap.get(folder.parentTempId);
                if (folder.parentTempId !== null && realParentId === undefined) {
                    failures.push({ type: 'folder', name: folder.name, error: '父文件夹创建失败，级联跳过' });
                    tempIdToRealIdMap.set(folder.tempId, undefined);
                    importedFolders--;
                    continue;
                }
                try {
                    const { meta } = await c.env.DB.prepare(
                        'INSERT INTO folders (name, parent_id) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM folders WHERE name = ? AND parent_id IS ? AND is_deleted = 0)'
                    ).bind(folder.name, realParentId ?? null, folder.name, realParentId ?? null).run();
                    if (Number(meta.changes ?? meta.rows_written ?? 0) > 0) {
                        tempIdToRealIdMap.set(folder.tempId, meta.last_row_id as number);
                    } else {
                        const existing = await c.env.DB.prepare(
                            'SELECT id FROM folders WHERE name = ? AND parent_id IS ? AND is_deleted = 0'
                        ).bind(folder.name, realParentId ?? null).first<{ id: number }>();
                        if (!existing) throw new Error('Folder deduplication result was not found');
                        tempIdToRealIdMap.set(folder.tempId, existing.id);
                        importedFolders--;
                        skippedFolders++;
                    }
                } catch (folderErr: unknown) {
                    failures.push({ type: 'folder', name: folder.name, error: importStorageFailureMessage(folderErr, '创建文件夹失败') });
                    tempIdToRealIdMap.set(folder.tempId, undefined);
                    importedFolders--;
                }
            }
        };

        // 阶段一：全部新文件夹按计划顺序入库。父级已在库中（含根级）的候选
        // 直接绑定最终位置；父级同属本批次的候选先以根级身份插入，阶段二统一
        // 回填 parent_id（此时所有真实 ID 均已确定）。
        const chainedFolderIds = new Set<string>();
        const pass1Statements = newFolders.map((folder) => {
            const knownParentId = folder.parentTempId === null
                ? null
                : tempIdToRealIdMap.get(folder.parentTempId);
            if (knownParentId === undefined) {
                chainedFolderIds.add(folder.tempId);
                return c.env.DB.prepare(
                    'INSERT INTO folders (name, parent_id) SELECT ?, NULL WHERE NOT EXISTS (SELECT 1 FROM folders WHERE name = ? AND parent_id IS NULL AND is_deleted = 0)'
                ).bind(folder.name, folder.name);
            }
            return c.env.DB.prepare(
                'INSERT INTO folders (name, parent_id) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM folders WHERE name = ? AND parent_id IS ? AND is_deleted = 0)'
            ).bind(folder.name, knownParentId, folder.name, knownParentId);
        });

        let pass1Results: D1Result[] | null = null;
        if (pass1Statements.length > 0) {
            try {
                pass1Results = await c.env.DB.batch(pass1Statements);
            } catch (batchErr: unknown) {
                console.error('Folder batch import failed:', batchErr);
                if (newFolders.length > MAX_SEQUENTIAL_FOLDER_FALLBACK) {
                    return c.json(err(ErrCode.SERVER_ERROR, 'Import failed: could not write folders'), 500);
                }
                await createFoldersSequentially();
            }
        }

        if (pass1Results) {
            for (let i = 0; i < newFolders.length; i++) {
                const folder = newFolders[i];
                const changes = Number(pass1Results[i]?.meta.changes ?? pass1Results[i]?.meta.rows_written ?? 0);
                if (changes > 0) {
                    tempIdToRealIdMap.set(folder.tempId, pass1Results[i]!.meta.last_row_id as number);
                } else if (chainedFolderIds.has(folder.tempId)) {
                    // 链式候选的根级重名只可能来自并发写入（其最终父级在此刻
                    // 才刚刚创建）。保守起见按失败处理并让子节点级联跳过，而
                    // 不是错误地复用同名根文件夹。
                    failures.push({ type: 'folder', name: folder.name, error: '创建文件夹失败' });
                    tempIdToRealIdMap.set(folder.tempId, undefined);
                    importedFolders--;
                } else {
                    // 并发导入抢先创建了同一文件夹：回读真实 ID。
                    const knownParentId = folder.parentTempId === null
                        ? null
                        : tempIdToRealIdMap.get(folder.parentTempId) ?? null;
                    const existing = await c.env.DB.prepare(
                        'SELECT id FROM folders WHERE name = ? AND parent_id IS ? AND is_deleted = 0'
                    ).bind(folder.name, knownParentId).first<{ id: number }>();
                    if (!existing) throw new Error('Folder deduplication result was not found');
                    tempIdToRealIdMap.set(folder.tempId, existing.id);
                    importedFolders--;
                    skippedFolders++;
                }
            }
        }

        // 阶段二：回填链式文件夹的父子关系（单次批量）。
        const linkStatements = newFolders
            .filter((folder) => chainedFolderIds.has(folder.tempId))
            .map((folder) => {
                const realId = tempIdToRealIdMap.get(folder.tempId);
                const realParentId = folder.parentTempId === null ? undefined : tempIdToRealIdMap.get(folder.parentTempId);
                if (typeof realId !== 'number' || typeof realParentId !== 'number') return null;
                return c.env.DB.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').bind(realParentId, realId);
            })
            .filter((statement): statement is D1PreparedStatement => statement !== null);
        if (linkStatements.length > 0) {
            try {
                await c.env.DB.batch(linkStatements);
            } catch (linkErr: unknown) {
                console.error('Folder link batch failed:', linkErr);
                return c.json(err(ErrCode.SERVER_ERROR, 'Import failed: could not link folders'), 500);
            }
        }

        // 2. 物理创建书签
        if (planBookmarks.length > 0) {
            const finalBookmarks: { title: string; url: string; folderId: number | null }[] = [];
            for (const b of planBookmarks) {
                if (b.parentTempId) {
                    const realFolderId = tempIdToRealIdMap.get(b.parentTempId);
                    if (realFolderId === undefined) {
                        failures.push({
                            type: 'bookmark',
                            name: b.title,
                            error: '父文件夹创建失败，级联跳过',
                        });
                        importedBookmarks--;
                        continue;
                    }
                    finalBookmarks.push({
                        title: b.title,
                        url: b.url,
                        folderId: realFolderId,
                    });
                } else {
                    finalBookmarks.push({
                        title: b.title,
                        url: b.url,
                        folderId: null,
                    });
                }
            }

            // 批量安全写入，调用预算已在落库前计算。
            for (let i = 0; i < finalBookmarks.length; i += IMPORT_BOOKMARK_BATCH_SIZE) {
                const batch = finalBookmarks.slice(i, i + IMPORT_BOOKMARK_BATCH_SIZE);
                const stmts = batch.map((bookmark) => {
                    return c.env.DB.prepare('INSERT INTO bookmarks (title, url, folder_id) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM bookmarks WHERE url = ? AND folder_id IS ? AND is_deleted = 0)')
                        .bind(bookmark.title, bookmark.url, bookmark.folderId, bookmark.url, bookmark.folderId);
                });

                try {
                    const results = await c.env.DB.batch(stmts);
                    results.forEach((res) => {
                        const changes = res.meta.changes ?? res.meta.rows_written ?? 0;
                        if (changes === 0) {
                            importedBookmarks--;
                            skippedBookmarks++;
                        }
                    });
                } catch (batchErr: unknown) {
                    // A sequential fallback could add up to 50 extra D1 calls
                    // for each failed batch and exceed the import budget. D1
                    // batch execution is atomic, so fail explicitly and let the
                    // caller retry the import after the underlying issue is fixed.
                    console.error('Bookmark batch import failed:', batchErr);
                    return c.json(err(ErrCode.SERVER_ERROR, 'Import failed: could not write bookmarks'), 500);
                }
            }
        }

        return c.json({
            success: true,
            dryRun: false,
            imported: { folders: importedFolders, bookmarks: importedBookmarks },
            skipped: { folders: skippedFolders, bookmarks: skippedBookmarks },
            failures: failures.length > 0 ? failures : undefined,
        });
    });
}
