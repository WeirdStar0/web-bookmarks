import { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../types';

type SettingsRow = {
    key: string;
    value: string;
};

// Tuned for the Workers Free plan's 10 ms CPU budget. Production workerd
// additionally rejects PBKDF2 iteration counts above 100k
// (cloudflare/workerd#1346), so values beyond that cannot be relied on.
// The reduced work factor is compensated by the 12-character minimum
// password, per-IP login rate limiting, and the single-account threat model.
export const PASSWORD_HASH_V3_ITERATIONS = 25_000;

// V1: SHA-256 (legacy only; migrate after a successful login)
export async function hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// V2: PBKDF2-SHA256 with a fixed legacy work factor.
export async function hashPasswordV2(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
    const result = await derivePasswordHash(password, 100000, saltHex);
    return { hash: result.hash, salt: result.salt };
}

// V3: PBKDF2-SHA256 with an explicit, upgradeable work factor.
export async function hashPasswordV3(
    password: string,
    iterations = PASSWORD_HASH_V3_ITERATIONS,
    saltHex?: string,
): Promise<{ hash: string; salt: string; iterations: number }> {
    return derivePasswordHash(password, iterations, saltHex);
}

function formatPasswordHashV3({ hash, salt, iterations }: { hash: string; salt: string; iterations: number }): string {
    return `v3:${iterations}:${salt}:${hash}`;
}

export function parsePasswordHashV3(value: string): { iterations: number; salt: string; hash: string } | null {
    const parts = value.split(':');
    if (parts.length !== 4 || parts[0] !== 'v3') return null;

    const iterations = Number(parts[1]);
    const salt = parts[2];
    const hash = parts[3];
    // The lower bound admits historical installs whose hashes were created
    // before the work factor was tuned for the Workers Free plan; the upper
    // bound keeps a malformed value from forcing an expensive derivation.
    if (!Number.isSafeInteger(iterations) || iterations < 1000 || iterations > 2000000) return null;
    if (!/^[0-9a-f]{32}$/i.test(salt) || !/^[0-9a-f]{64}$/i.test(hash)) return null;

    return { iterations, salt, hash };
}

export function serializePasswordHashV3(value: { hash: string; salt: string; iterations: number }): string {
    return formatPasswordHashV3(value);
}

async function derivePasswordHash(
    password: string,
    iterations: number,
    saltHex?: string,
): Promise<{ hash: string; salt: string; iterations: number }> {
    const encoder = new TextEncoder();
    const salt = saltHex ? hexToBuf(saltHex) : crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits'],
    );

    const hashBuffer = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt,
            iterations,
            hash: 'SHA-256',
        },
        keyMaterial,
        256,
    );

    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const saltHexOut = Array.from(salt).map((byte) => byte.toString(16).padStart(2, '0')).join('');

    return { hash, salt: saltHexOut, iterations };
}

function hexToBuf(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

function getBoundedPositiveInteger(rawValue: string | undefined, fallback: number, min: number, max: number): number {
    if (!rawValue) return fallback;
    if (!/^\d+$/.test(rawValue.trim())) return fallback;

    const value = Number(rawValue);
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

export function getConfig(env: Bindings) {
    return {
        allowedExtensionOrigins: (env.ALLOWED_EXTENSION_ORIGINS || '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
        // Keep a bounded, finite session lifetime even when a deployment variable
        // is malformed. The upper bound prevents an accidental effectively
        // permanent signed session.
        sessionMaxAge: getBoundedPositiveInteger(env.SESSION_MAX_AGE, 604800, 60, 2592000), // 1 minute–30 days
        // General API limiting can be tuned for workload, while login remains
        // deliberately narrow to retain brute-force protection.
        rateLimitMax: getBoundedPositiveInteger(env.RATE_LIMIT_MAX, 100, 1, 10000),
        // Windows cannot go below 60s because Workers KV enforces a 60-second
        // minimum expirationTtl on every counter write.
        rateLimitWindow: getBoundedPositiveInteger(env.RATE_LIMIT_WINDOW, 60, 60, 86400), // 1 minute–1 day
        rateLimitLoginMax: getBoundedPositiveInteger(env.RATE_LIMIT_LOGIN_MAX, 5, 1, 100),
        rateLimitLoginWindow: getBoundedPositiveInteger(env.RATE_LIMIT_LOGIN_WINDOW, 60, 60, 86400), // 1 minute–1 day
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

const SESSION_VERSION_SETTING = 'session_version';
type SettingsValueRow = { value: string };

export async function getSessionVersion(db: D1Database): Promise<string> {
    const existing = await db.prepare('SELECT value FROM settings WHERE key = ?')
        .bind(SESSION_VERSION_SETTING)
        .first<SettingsValueRow>();
    if (existing?.value) return existing.value;

    const generated = crypto.randomUUID();
    await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
        .bind(SESSION_VERSION_SETTING, generated)
        .run();
    const persisted = await db.prepare('SELECT value FROM settings WHERE key = ?')
        .bind(SESSION_VERSION_SETTING)
        .first<SettingsValueRow>();
    if (!persisted?.value) {
        throw new Error('Session version unavailable');
    }
    return persisted.value;
}

export async function rotateSessionVersion(db: D1Database): Promise<string> {
    const value = crypto.randomUUID();
    await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
        .bind(SESSION_VERSION_SETTING, value)
        .run();
    await db.prepare('UPDATE settings SET value = ? WHERE key = ?')
        .bind(value, SESSION_VERSION_SETTING)
        .run();
    return value;
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
    FOLDER_EXISTS: 'FOLDER_EXISTS',
    INVALID_ID: 'INVALID_ID',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    IDEMPOTENCY_KEY_INVALID: 'IDEMPOTENCY_KEY_INVALID',
    REORDER_INVALID: 'REORDER_INVALID',
    REORDER_CROSS_SCOPE: 'REORDER_CROSS_SCOPE',
    SELF_REFERENCE: 'SELF_REFERENCE',
    CIRCULAR_REF: 'CIRCULAR_REF',
    PARENT_IN_TRASH: 'PARENT_IN_TRASH',
    FOLDER_DEPTH_LIMIT: 'FOLDER_DEPTH_LIMIT',
    RATE_LIMITED: 'RATE_LIMITED',
    RATE_LIMIT_UNAVAILABLE: 'RATE_LIMIT_UNAVAILABLE',
    FORBIDDEN: 'FORBIDDEN',
    SERVER_ERROR: 'SERVER_ERROR',
} as const;
