import { D1Database } from '@cloudflare/workers-types';
import type { Bindings } from '../types';

type SettingsRow = {
    key: string;
    value: string;
};

// New hashes target 90k iterations. Measured in workerd (vitest-pool-workers):
// 25k=5ms, 50k=11ms, 90k=15ms, 100k=17ms; the v2 era already ran 100k in
// production on every login, and workerd rejects counts above 100k
// (cloudflare/workerd#1346), so 90k keeps 10% headroom. Login is a
// rate-limited per-attempt cost, not a hot path, and stored hashes keep their
// own iteration count, so this constant can be raised again without a
// migration. The 12-character minimum password, per-IP login rate limiting,
// the pepper (when configured), and the single-account threat model remain
// the primary compensations.
export const PASSWORD_HASH_ITERATIONS = 90_000;
const MIN_PEPPER_MATERIAL_LENGTH = 32;

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
    iterations = PASSWORD_HASH_ITERATIONS,
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

// V4: v3 derivation plus a pepper mixed into the key material. The pepper
// lives in Workers Secrets and never in D1, so a D1-only leak can no longer
// verify — let alone crack — a stored hash. See docs/password-v4-design.md.
export type PasswordPepper = { id: string; material: string };

// Pepper secret values are "<id>:<material>" (split on the first colon). The
// id is stored inside every v4 hash in D1 and must be unique per rotation;
// the material is the secret. PASSWORD_PEPPER holds the current pepper and
// PASSWORD_PEPPER_PREVIOUS lets logins verify hashes written before a
// rotation until the next successful login re-hashes them.
export function parsePepperValue(rawValue: string | undefined, label: string): PasswordPepper | null {
    if (!rawValue) return null;
    const separator = rawValue.indexOf(':');
    const id = separator === -1 ? '' : rawValue.slice(0, separator);
    const material = separator === -1 ? '' : rawValue.slice(separator + 1);
    if (!/^[A-Za-z0-9]{1,16}$/.test(id) || material.length < MIN_PEPPER_MATERIAL_LENGTH) {
        // A typo must not lock the administrator out of a v3 deployment: an
        // invalid pepper is treated as absent for writes and cannot verify v4
        // hashes, and the operator gets one warning per isolate.
        console.warn(`${label} is malformed; expected "<id>:<material>" with an alphanumeric id (1-16 chars) and at least ${MIN_PEPPER_MATERIAL_LENGTH} material characters. Treating it as unset.`);
        return null;
    }
    return { id, material };
}

export function resolveCurrentPepper(env: Bindings): PasswordPepper | null {
    return parsePepperValue(env.PASSWORD_PEPPER, 'PASSWORD_PEPPER');
}

export function resolvePepperById(env: Bindings, id: string): PasswordPepper | null {
    const current = parsePepperValue(env.PASSWORD_PEPPER, 'PASSWORD_PEPPER');
    if (current && current.id === id) return current;
    const previous = parsePepperValue(env.PASSWORD_PEPPER_PREVIOUS, 'PASSWORD_PEPPER_PREVIOUS');
    return previous && previous.id === id ? previous : null;
}

export function parsePasswordHashV4(value: string): { pepperId: string; iterations: number; salt: string; hash: string } | null {
    const parts = value.split(':');
    if (parts.length !== 5 || parts[0] !== 'v4') return null;

    const pepperId = parts[1];
    const iterations = Number(parts[2]);
    const salt = parts[3];
    const hash = parts[4];
    if (!/^[A-Za-z0-9]{1,16}$/.test(pepperId)) return null;
    if (!Number.isSafeInteger(iterations) || iterations < 1000 || iterations > 2000000) return null;
    if (!/^[0-9a-f]{32}$/i.test(salt) || !/^[0-9a-f]{64}$/i.test(hash)) return null;

    return { pepperId, iterations, salt, hash };
}

function formatPasswordHashV4({ pepperId, iterations, salt, hash }: { pepperId: string; iterations: number; salt: string; hash: string }): string {
    return `v4:${pepperId}:${iterations}:${salt}:${hash}`;
}

export async function hashPasswordV4(
    password: string,
    pepper: PasswordPepper,
    iterations = PASSWORD_HASH_ITERATIONS,
    saltHex?: string,
): Promise<{ hash: string; salt: string; iterations: number; pepperId: string }> {
    const result = await derivePasswordHash(password, iterations, saltHex, pepper.material);
    return { ...result, pepperId: pepper.id };
}

// Fresh hashes use the best available format for the configuration: v4 with
// the current pepper, or v3 at the current work factor when no pepper is set.
export async function createPasswordHash(env: Bindings, password: string): Promise<string> {
    const pepper = resolveCurrentPepper(env);
    if (pepper) {
        return formatPasswordHashV4(await hashPasswordV4(password, pepper));
    }
    return serializePasswordHashV3(await hashPasswordV3(password));
}

export type StoredPasswordVerifyResult = { ok: boolean; needsUpgrade: boolean };

// Verify a password against any stored hash format. needsUpgrade marks a
// successful verification whose stored value is not the best format the
// current configuration can produce; callers may then migrate on login.
export async function verifyStoredPassword(env: Bindings, storedValue: string, password: string): Promise<StoredPasswordVerifyResult> {
    if (storedValue.startsWith('v4:')) {
        const parsed = parsePasswordHashV4(storedValue);
        if (!parsed) return { ok: false, needsUpgrade: false };
        const pepper = resolvePepperById(env, parsed.pepperId);
        // An id that resolves to no configured pepper makes verification fail
        // closed: without its pepper the supplied password cannot be checked.
        if (!pepper) return { ok: false, needsUpgrade: false };
        const verify = await hashPasswordV4(password, pepper, parsed.iterations, parsed.salt);
        const ok = verify.hash === parsed.hash;
        const current = resolveCurrentPepper(env);
        const needsUpgrade = ok && (pepper.id !== current?.id || parsed.iterations !== PASSWORD_HASH_ITERATIONS);
        return { ok, needsUpgrade };
    }
    if (storedValue.startsWith('v3:')) {
        const parsed = parsePasswordHashV3(storedValue);
        if (!parsed) return { ok: false, needsUpgrade: false };
        const verify = await hashPasswordV3(password, parsed.iterations, parsed.salt);
        const ok = verify.hash === parsed.hash;
        const needsUpgrade = ok && (Boolean(resolveCurrentPepper(env)) || parsed.iterations !== PASSWORD_HASH_ITERATIONS);
        return { ok, needsUpgrade };
    }
    if (storedValue.startsWith('v2:')) {
        const parts = storedValue.split(':');
        if (parts.length !== 3) return { ok: false, needsUpgrade: false };
        const verify = await hashPasswordV2(password, parts[1]);
        return { ok: verify.hash === parts[2], needsUpgrade: true };
    }
    // v1: bare SHA-256 hex digest of the password.
    const inputHash = await hashPassword(password);
    return { ok: inputHash === storedValue, needsUpgrade: true };
}

export type StoredPasswordUpgrade = 'applied' | 'unchanged' | 'failed';

// Migrate a verified hash to the best available format with a conditional
// write, so a concurrent credential change (or a concurrent migration) is
// detected by changes = 0 and never overwritten. A storage failure is logged
// and swallowed: a migration must never be the reason a correct password is
// rejected — the old hash stays valid and the next login retries.
export async function upgradeStoredPasswordIfUnchanged(
    env: Bindings,
    db: D1Database,
    expectedStoredValue: string,
    password: string,
): Promise<StoredPasswordUpgrade> {
    try {
        const value = await createPasswordHash(env, password);
        const updated = await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?')
            .bind(value, 'password', expectedStoredValue)
            .run();
        return Number(updated.meta.changes) === 1 ? 'applied' : 'unchanged';
    } catch (error) {
        console.warn('Password hash upgrade skipped:', error instanceof Error ? error.message : error);
        return 'failed';
    }
}

async function derivePasswordHash(
    password: string,
    iterations: number,
    saltHex?: string,
    pepperMaterial?: string,
): Promise<{ hash: string; salt: string; iterations: number }> {
    const encoder = new TextEncoder();
    const salt = saltHex ? hexToBuf(saltHex) : crypto.getRandomValues(new Uint8Array(16));
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(pepperMaterial ? `${password}:${pepperMaterial}` : password),
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
