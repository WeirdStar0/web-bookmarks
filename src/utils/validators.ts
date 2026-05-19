/**
 * 输入验证工具
 * 防止 XSS、SQL 注入等安全威胁
 */

/**
 * 净化字符串输入,移除危险字符
 */
export function sanitizeString(input: string, maxLength: number = 1000): string {
    if (typeof input !== 'string') {
        return '';
    }

    // 移除控制字符
    let sanitized = input.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

    // 限制长度
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }

    return sanitized.trim();
}

/**
 * 验证文件夹名称
 */
export function validateFolderName(name: string): { valid: boolean; error?: string } {
    if (!name || typeof name !== 'string') {
        return { valid: false, error: '文件夹名称不能为空' };
    }

    const sanitized = sanitizeString(name, 255);

    if (sanitized.length === 0) {
        return { valid: false, error: '文件夹名称不能为空' };
    }

    if (sanitized.length < 1) {
        return { valid: false, error: '文件夹名称至少需要 1 个字符' };
    }

    if (sanitized.length > 255) {
        return { valid: false, error: '文件夹名称不能超过 255 个字符' };
    }

    // 检查是否包含危险字符
    if (/[<>\"'`]/.test(sanitized)) {
        return { valid: false, error: '文件夹名称包含非法字符' };
    }

    return { valid: true };
}

/**
 * 验证书签标题
 */
export function validateBookmarkTitle(title: string): { valid: boolean; error?: string } {
    if (!title || typeof title !== 'string') {
        return { valid: false, error: '书签标题不能为空' };
    }

    const sanitized = sanitizeString(title, 500);

    if (sanitized.length === 0) {
        return { valid: false, error: '书签标题不能为空' };
    }

    if (sanitized.length > 500) {
        return { valid: false, error: '书签标题不能超过 500 个字符' };
    }

    return { valid: true };
}

/**
 * 验证 URL
 */
export function validateUrl(url: string): { valid: boolean; error?: string; sanitized?: string } {
    if (!url || typeof url !== 'string') {
        return { valid: false, error: 'URL 不能为空' };
    }

    const sanitized = sanitizeString(url, 2048).trim();

    if (sanitized.length === 0) {
        return { valid: false, error: 'URL 不能为空' };
    }

    if (sanitized.length > 2048) {
        return { valid: false, error: 'URL 不能超过 2048 个字符' };
    }

    // 基本的 URL 格式验证
    try {
        const parsed = new URL(sanitized);

        // 只允许 http 和 https 协议
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { valid: false, error: '只支持 HTTP 和 HTTPS 协议' };
        }

        // 防止 JavaScript 伪协议
        if (sanitized.toLowerCase().startsWith('javascript:')) {
            return { valid: false, error: '不允许使用 JavaScript 协议' };
        }

        return { valid: true, sanitized: parsed.href };
    } catch {
        return { valid: false, error: 'URL 格式无效' };
    }
}

/**
 * 验证书签描述
 */
export function validateDescription(description: string): { valid: boolean; error?: string } {
    if (!description || typeof description !== 'string') {
        return { valid: true }; // 描述是可选的
    }

    const sanitized = sanitizeString(description, 1000);

    if (sanitized.length > 1000) {
        return { valid: false, error: '描述不能超过 1000 个字符' };
    }

    return { valid: true };
}

/**
 * 验证用户名
 */
export function validateUsername(username: string): { valid: boolean; error?: string } {
    if (!username || typeof username !== 'string') {
        return { valid: false, error: '用户名不能为空' };
    }

    const sanitized = sanitizeString(username, 100);

    if (sanitized.length < 3) {
        return { valid: false, error: '用户名至少需要 3 个字符' };
    }

    if (sanitized.length > 100) {
        return { valid: false, error: '用户名不能超过 100 个字符' };
    }

    // 只允许字母、数字、下划线和连字符
    if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
        return { valid: false, error: '用户名只能包含字母、数字、下划线和连字符' };
    }

    return { valid: true };
}

/**
 * 验证密码
 */
export function validatePassword(password: string): { valid: boolean; error?: string } {
    if (!password || typeof password !== 'string') {
        return { valid: false, error: '密码不能为空' };
    }

    if (password.length < 6) {
        return { valid: false, error: '密码至少需要 6 个字符' };
    }

    if (password.length > 100) {
        return { valid: false, error: '密码不能超过 100 个字符' };
    }

    return { valid: true };
}

/**
 * 验证 ID 参数
 */
export function validateId(id: string | number): { valid: boolean; error?: string; parsed?: number } {
    // 统一转换为整数
    let parsed: number;

    if (typeof id === 'number') {
        parsed = Math.round(id);
    } else if (typeof id === 'string') {
        parsed = parseInt(id, 10);
    } else {
        return { valid: false, error: '无效的 ID' };
    }

    if (isNaN(parsed)) {
        return { valid: false, error: '无效的 ID' };
    }

    if (parsed <= 0) {
        return { valid: false, error: 'ID 必须大于 0' };
    }

    return { valid: true, parsed };
}

/**
 * 验证分页参数
 */
export function validatePagination(page?: string | number, limit?: string | number): {
    valid: boolean;
    offset?: number;
    limit?: number;
    error?: string;
} {
    const parsedPage = Number.parseInt(String(page ?? ''), 10) || 1;
    const parsedLimit = Number.parseInt(String(limit ?? ''), 10) || 20;

    if (parsedPage < 1) {
        return { valid: false, error: '页码必须大于 0' };
    }

    if (parsedLimit < 1 || parsedLimit > 100) {
        return { valid: false, error: '每页数量必须在 1-100 之间' };
    }

    const offset = (parsedPage - 1) * parsedLimit;

    return {
        valid: true,
        offset,
        limit: parsedLimit
    };
}

/**
 * HTML 转义,防止 XSS
 */
export function escapeHtml(unsafe: string): string {
    if (typeof unsafe !== 'string') {
        return '';
    }

    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
