import type { ApiApp } from './types';
import { bookmarkSchema, folderSchema } from '../utils/schemas';

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

function decodeHtmlEntities(str: string): string {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#x2F;/g, '/')
        .replace(/&mdash;/g, '—')
        .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function generateNetscapeHTML(folders: FolderRow[], bookmarks: BookmarkRow[], parentId: number | null = null, indent: string = ''): string {
    const escapeHtml = (s: string | number | null | undefined) => {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };
    let html = '';
    const f = folders.filter((folder) => folder.parent_id === parentId);
    const b = bookmarks.filter((bookmark) => bookmark.folder_id === parentId);
    if (f.length > 0 || b.length > 0) {
        html += `\n${indent}<DL><p>\n`;
        for (const folder of f) {
            html += `${indent}    <DT><H3>${escapeHtml(folder.name)}</H3>\n`;
            html += generateNetscapeHTML(folders, bookmarks, folder.id, indent + '    ');
            html += `${indent}    </DT>\n`;
        }
        for (const bookmark of b) {
            html += `${indent}    <DT><A HREF="${escapeHtml(bookmark.url)}">${escapeHtml(bookmark.title)}</A>\n`;
        }
        html += `${indent}</DL><p>\n`;
    }
    return html;
}

export function registerImportExportRoutes(app: ApiApp) {
    app.get('/data', async (c) => {
        const { results: folders } = await c.env.DB.prepare('SELECT * FROM folders WHERE is_deleted = 0 ORDER BY sort_order ASC, name ASC').all();
        const { results: bookmarks } = await c.env.DB.prepare('SELECT * FROM bookmarks WHERE is_deleted = 0 ORDER BY sort_order ASC, created_at ASC').all();
        return c.json({ folders, bookmarks });
    });

    app.get('/search', async (c) => {
        const query = c.req.query('q');
        if (!query || query.trim().length === 0) {
            return c.json({ bookmarks: [] });
        }

        // Escape LIKE wildcards so % and _ are treated as literal characters
        const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

        const { results: bookmarks } = await c.env.DB.prepare(
            "SELECT * FROM bookmarks WHERE is_deleted = 0 AND (title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\') ORDER BY sort_order ASC, created_at DESC LIMIT 50",
        ).bind(`%${escaped}%`, `%${escaped}%`).all();

        return c.json({ bookmarks });
    });

    app.get('/export', async (c) => {
        const { results: folders } = await c.env.DB.prepare('SELECT * FROM folders WHERE is_deleted = 0').all<FolderRow>();
        const { results: bookmarks } = await c.env.DB.prepare('SELECT * FROM bookmarks WHERE is_deleted = 0').all<BookmarkRow>();
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
        if (contentLength && parseInt(contentLength, 10) > 2 * 1024 * 1024) {
            return c.json({ error: 'PAYLOAD_TOO_LARGE', message: '导入文件大小不能超过 2MB' }, 413);
        }

        const body = await c.req.text();
        const bodySize = new TextEncoder().encode(body).byteLength;
        if (bodySize > 2 * 1024 * 1024) {
            return c.json({ error: 'PAYLOAD_TOO_LARGE', message: '导入文件大小不能超过 2MB' }, 413);
        }

        const isDryRun = c.req.query('dryRun') === 'true';
        const stripTags = (s: string) => s.replace(/<[^>]*>/g, '').trim();

        const tokens = body.matchAll(/(<(?:DL|\/DL).*?>)|<H3.*?>(.*?)<\/H3>|<A.*?HREF\s*=\s*["']?([^"'\s>]+)["']?.*?>(.*?)<\/A>/gis);

        const stack: (string | null)[] = [null]; // 栈中存储 tempId (string)
        let lastFolderTempId: string | null = null;

        // 复杂度与限制条件
        let tokenCount = 0;
        const MAX_TOKENS = 5000;
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
        const failures: { type: 'folder' | 'bookmark'; name: string; error: string }[] = [];

        let importedFolders = 0;
        let skippedFolders = 0;
        let importedBookmarks = 0;
        let skippedBookmarks = 0;

        // --- 第一阶段：纯内存解析与校验 ---
        for (const match of tokens) {
            tokenCount++;
            if (tokenCount > MAX_TOKENS) {
                return c.json({
                    error: 'COMPLEXITY_LIMIT_EXCEEDED',
                    message: `导入文件过于复杂，匹配节点总数超过上限（${MAX_TOKENS}）`
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
                    // 2. 查数据库 (仅当 parentTempId 在数据库已存在或为根级时)
                    let dbId: number | null = null;
                    let parentExistsInDb = false;
                    let realParentId: number | null = null;

                    if (parentTempId === null) {
                        parentExistsInDb = true;
                        realParentId = null;
                    } else {
                        const parentFolder = planFolders.find((f) => f.tempId === parentTempId);
                        if (parentFolder && parentFolder.dbId !== null) {
                            parentExistsInDb = true;
                            realParentId = parentFolder.dbId;
                        }
                    }

                    let queryFailed = false;
                    if (parentExistsInDb) {
                        try {
                            const dbExisting = await c.env.DB.prepare('SELECT id FROM folders WHERE name = ? AND parent_id IS ? AND is_deleted = 0')
                                .bind(folderName, realParentId)
                                .first<{ id: number }>();
                            if (dbExisting) {
                                dbId = dbExisting.id;
                            }
                        } catch (err: unknown) {
                            failures.push({ type: 'folder', name: folderName, error: (err as Error).message || '数据库检索失败' });
                            queryFailed = true;
                        }
                    }

                    if (queryFailed) {
                        const tempId = `temp-f-${planFolders.length + 1}`;
                        planFolders.push({
                            tempId,
                            name: folderName,
                            parentTempId,
                            dbId: null,
                            isNew: false,
                            isFailed: true,
                        });
                        lastFolderTempId = tempId;
                        continue;
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

                if (planBookmarks.length >= MAX_BOOKMARKS) {
                    return c.json({
                        error: 'LIMIT_EXCEEDED',
                        message: `导入书签数超出限制，单次最多允许 ${MAX_BOOKMARKS} 条`
                    }, 400);
                }

                // 查重
                let isDuplicate = false;

                // 1. 查 Plan 内存
                const existingInPlan = planBookmarks.find(
                    (b) => b.parentTempId === parentTempId && b.url === url
                );

                if (existingInPlan) {
                    isDuplicate = true;
                } else {
                    // 2. 查数据库 (仅当 parentTempId 在数据库已存在或为根级时)
                    let parentExistsInDb = false;
                    let realParentId: number | null = null;

                    if (parentTempId === null) {
                        parentExistsInDb = true;
                        realParentId = null;
                    } else {
                        const parentFolder = planFolders.find((f) => f.tempId === parentTempId);
                        if (parentFolder) {
                            if (parentFolder.dbId !== null) {
                                parentExistsInDb = true;
                                realParentId = parentFolder.dbId;
                            }
                        }
                    }

                    let queryFailed = false;
                    if (parentExistsInDb) {
                        try {
                            const existing = await c.env.DB.prepare('SELECT 1 FROM bookmarks WHERE url = ? AND folder_id IS ? AND is_deleted = 0')
                                .bind(url, realParentId)
                                .first();
                            if (existing) {
                                isDuplicate = true;
                            }
                        } catch (err: unknown) {
                            failures.push({ type: 'bookmark', name: title, error: (err as Error).message || '数据库检索失败' });
                            queryFailed = true;
                        }
                    }

                    if (queryFailed) {
                        continue;
                    }
                }

                if (isDuplicate) {
                    skippedBookmarks++;
                } else {
                    planBookmarks.push({
                        title: bookmarkResult.data.title,
                        url: bookmarkResult.data.url,
                        parentTempId,
                    });
                    importedBookmarks++;
                }
            }
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

        // 1. 物理创建文件夹
        for (const folder of planFolders) {
            if (folder.isFailed) {
                tempIdToRealIdMap.set(folder.tempId, undefined);
                continue;
            }
            if (!folder.isNew) {
                tempIdToRealIdMap.set(folder.tempId, folder.dbId!);
            } else {
                const realParentId = folder.parentTempId ? tempIdToRealIdMap.get(folder.parentTempId) : null;

                if (folder.parentTempId && realParentId === undefined) {
                    failures.push({
                        type: 'folder',
                        name: folder.name,
                        error: '父文件夹创建失败，级联跳过',
                    });
                    tempIdToRealIdMap.set(folder.tempId, undefined);
                    importedFolders--;
                    continue;
                }

                try {
                    const { meta } = await c.env.DB.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)')
                        .bind(folder.name, realParentId)
                        .run();
                    const realId = meta.last_row_id as number;
                    tempIdToRealIdMap.set(folder.tempId, realId);
                } catch (err: unknown) {
                    failures.push({
                        type: 'folder',
                        name: folder.name,
                        error: (err as Error).message || '创建文件夹失败',
                    });
                    tempIdToRealIdMap.set(folder.tempId, undefined);
                    importedFolders--;
                }
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

            // 批量安全写入 (BATCH_SIZE = 50)
            const BATCH_SIZE = 50;
            for (let i = 0; i < finalBookmarks.length; i += BATCH_SIZE) {
                const batch = finalBookmarks.slice(i, i + BATCH_SIZE);
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
                    console.warn('Batch import failed, falling back to sequential inserts:', (batchErr as Error).message);
                    for (const bookmark of batch) {
                        try {
                            const existing = await c.env.DB.prepare('SELECT 1 FROM bookmarks WHERE url = ? AND folder_id IS ? AND is_deleted = 0')
                                .bind(bookmark.url, bookmark.folderId)
                                .first();
                            if (!existing) {
                                await c.env.DB.prepare('INSERT INTO bookmarks (title, url, folder_id) VALUES (?, ?, ?)')
                                    .bind(bookmark.title, bookmark.url, bookmark.folderId)
                                    .run();
                            } else {
                                importedBookmarks--;
                                skippedBookmarks++;
                            }
                        } catch (singleErr: unknown) {
                            failures.push({
                                type: 'bookmark',
                                name: bookmark.title,
                                error: (singleErr as Error).message || '数据库写入错误',
                            });
                            importedBookmarks--;
                        }
                    }
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
