import { Bindings } from '../types';
import { D1Database } from '@cloudflare/workers-types';

type SettingsRow = {
    key: string;
    value: string;
};

// V1: SHA-256 (Legacy)
export async function hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// V2: PBKDF2 (Secure)
export async function hashPasswordV2(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
    const encoder = new TextEncoder();
    const salt = saltHex ? hexToBuf(saltHex) : crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );

    const hashBuffer = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );

    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    const saltHexOut = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');

    return { hash: hashHex, salt: saltHexOut };
}

function hexToBuf(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

export function getConfig(env: Bindings) {
    return {
        allowedExtensionOrigins: (env.ALLOWED_EXTENSION_ORIGINS || '')
            .split(',')
            .map(origin => origin.trim())
            .filter(Boolean),
        sessionMaxAge: parseInt(env.SESSION_MAX_AGE || '604800'), // 7 days
        rateLimitMax: parseInt(env.RATE_LIMIT_MAX || '100'),
        rateLimitWindow: parseInt(env.RATE_LIMIT_WINDOW || '60'), // 60 seconds
        rateLimitLoginMax: parseInt(env.RATE_LIMIT_LOGIN_MAX || '5'),
        rateLimitLoginWindow: parseInt(env.RATE_LIMIT_LOGIN_WINDOW || '60'), // 60 seconds
    };
}


export async function getSettings(db: D1Database): Promise<Record<string, string>> {
    const { results } = await db.prepare('SELECT key, value FROM settings').all<SettingsRow>();
    const settings: Record<string, string> = {};
    results.forEach((row) => {
        settings[row.key] = row.value;
    });
    return settings;
}

// ---- Error response helpers ----

/** 统一的错误响应格式：{ error: 错误代码, message: 人类可读信息 } */
export function err(code: string, message: string) {
    return { error: code, message };
}

/** 错误代码常量，避免散落 magic string */
export const ErrCode = {
    UNAUTHORIZED: 'UNAUTHORIZED',
    VALIDATION: 'VALIDATION_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    INVALID_ID: 'INVALID_ID',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    REORDER_INVALID: 'REORDER_INVALID',
    REORDER_CROSS_SCOPE: 'REORDER_CROSS_SCOPE',
    SELF_REFERENCE: 'SELF_REFERENCE',
    CIRCULAR_REF: 'CIRCULAR_REF',
    PARENT_IN_TRASH: 'PARENT_IN_TRASH',
    RATE_LIMITED: 'RATE_LIMITED',
    FORBIDDEN: 'FORBIDDEN',
    SERVER_ERROR: 'SERVER_ERROR',
} as const;
