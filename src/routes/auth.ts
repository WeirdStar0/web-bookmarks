import { deleteCookie, setSignedCookie } from 'hono/cookie';
import type { Context } from 'hono';
import {
    getConfig,
    getSessionVersion,
    getSettings,
    hashPassword,
    hashPasswordV2,
    hashPasswordV3,
    parsePasswordHashV3,
    serializePasswordHashV3,
    rotateSessionVersion,
    err,
    ErrCode,
} from '../utils/common';
import * as s from '../utils/schemas';
import type { Bindings, Variables } from '../types';
import type { ApiApp } from './types';

async function setAuthCookie(
    c: Context<{ Bindings: Bindings; Variables: Variables }>,
    maxAge: number,
    expectedSessionVersion?: string,
    allowedExtensionOrigins: string[] = [],
): Promise<boolean> {
    const secret = c.get('sessionSecret');
    const sessionVersion = await getSessionVersion(c.env.DB);
    // Do not turn a request that verified an old credential into a valid new
    // session if logout or account settings rotated the version meanwhile.
    if (expectedSessionVersion && sessionVersion !== expectedSessionVersion) return false;

    const isSecure = new URL(c.req.url).protocol === 'https:';
    const origin = c.req.header('Origin') || '';
    // Match the CORS allowlist rather than trusting every extension-scheme
    // Origin. Otherwise an arbitrary installed extension could make a normal
    // web session cross-site by merely posting to the login endpoint.
    const isExtensionRequest = allowedExtensionOrigins.includes(origin);
    await setSignedCookie(c, 'auth', sessionVersion, secret, {
        path: '/',
        httpOnly: true,
        secure: isSecure,
        // Browser extensions need a cross-site cookie to call the configured
        // API. Ordinary HTTPS web logins do not, so keep their cookie Lax.
        sameSite: isSecure && isExtensionRequest ? 'None' : 'Lax',
        maxAge,
    });
    return true;
}

async function createInitialPasswordV3(db: D1Database, password: string): Promise<boolean> {
    const value = serializePasswordHashV3(await hashPasswordV3(password));
    const inserted = await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
        .bind('password', value)
        .run();
    return Number(inserted.meta.changes) === 1;
}

async function upgradePasswordV3IfUnchanged(
    db: D1Database,
    expectedStoredValue: string,
    password: string,
): Promise<boolean> {
    const value = serializePasswordHashV3(await hashPasswordV3(password));
    const updated = await db.prepare('UPDATE settings SET value = ? WHERE key = ? AND value = ?')
        .bind(value, 'password', expectedStoredValue)
        .run();
    return Number(updated.meta.changes) === 1;
}

export function registerAuthRoutes(app: ApiApp) {
    app.post('/login', async (c) => {
        const config = getConfig(c.env);
        const body = await c.req.json();
        const result = s.loginSchema.safeParse(body);

        if (!result.success) {
            return c.json(err(ErrCode.VALIDATION, result.error.issues[0].message), 400);
        }
        const { username, password } = result.data;
        // Capture the authorization epoch before the expensive password
        // verification. Any concurrent logout or credential update must force
        // this login attempt to start again.
        const sessionVersionAtVerificationStart = await getSessionVersion(c.env.DB);

        const settings = await getSettings(c.env.DB);
        const dbUser = settings.username;
        const dbPass = settings.password;

        if (!dbPass) {
            const url = new URL(c.req.url);
            const isLocalDevelopment = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
            const initialAdminPassword = c.env.INITIAL_ADMIN_PASSWORD || (isLocalDevelopment ? 'local-development-only' : '');

            if (!initialAdminPassword) {
                return c.json(err(ErrCode.INVALID_CREDENTIALS, 'Invalid credentials'), 401);
            }

            if (username === dbUser && password === initialAdminPassword) {
                if (await createInitialPasswordV3(c.env.DB, initialAdminPassword)
                    && await setAuthCookie(c, config.sessionMaxAge, sessionVersionAtVerificationStart, config.allowedExtensionOrigins)) {
                    return c.json({ success: true });
                }
                return c.json(err(ErrCode.INVALID_CREDENTIALS, 'Invalid credentials'), 401);
            }
            return c.json(err(ErrCode.INVALID_CREDENTIALS, 'Invalid credentials'), 401);
        }

        if (username === dbUser) {
            if (dbPass.startsWith('v3:')) {
                const parsed = parsePasswordHashV3(dbPass);
                if (parsed) {
                    const verify = await hashPasswordV3(password, parsed.iterations, parsed.salt);
                    if (verify.hash === parsed.hash) {
                        if (await setAuthCookie(c, config.sessionMaxAge, sessionVersionAtVerificationStart, config.allowedExtensionOrigins)) {
                            return c.json({ success: true });
                        }
                        return c.json(err(ErrCode.INVALID_CREDENTIALS, 'Invalid credentials'), 401);
                    }
                }
            } else if (dbPass.startsWith('v2:')) {
                const parts = dbPass.split(':');
                if (parts.length === 3) {
                    const verify = await hashPasswordV2(password, parts[1]);
                    if (verify.hash === parts[2]) {
                        if (await upgradePasswordV3IfUnchanged(c.env.DB, dbPass, password)
                            && await setAuthCookie(c, config.sessionMaxAge, sessionVersionAtVerificationStart, config.allowedExtensionOrigins)) {
                            return c.json({ success: true, migrated: true });
                        }
                        return c.json(err(ErrCode.INVALID_CREDENTIALS, 'Invalid credentials'), 401);
                    }
                }
            } else {
                const inputHash = await hashPassword(password);
                if (inputHash === dbPass) {
                    if (await upgradePasswordV3IfUnchanged(c.env.DB, dbPass, password)
                        && await setAuthCookie(c, config.sessionMaxAge, sessionVersionAtVerificationStart, config.allowedExtensionOrigins)) {
                        return c.json({ success: true, migrated: true });
                    }
                    return c.json(err(ErrCode.INVALID_CREDENTIALS, 'Invalid credentials'), 401);
                }
            }
        }
        return c.json(err(ErrCode.INVALID_CREDENTIALS, 'Invalid credentials'), 401);
    });

    app.post('/logout', async (c) => {
        // A signed cookie is otherwise valid until expiry. Rotating the shared
        // version revokes copies held by other tabs or a compromised client.
        await rotateSessionVersion(c.env.DB);
        deleteCookie(c, 'auth');
        return c.json({ success: true });
    });

    app.put('/settings', async (c) => {
        const body = await c.req.json();
        const result = s.settingsSchema.safeParse(body);

        if (!result.success) {
            return c.json(err(ErrCode.VALIDATION, result.error.issues[0].message), 400);
        }
        const { username, password } = result.data;

        if (username || password) {
            // Derive the replacement hash before issuing any write. Then apply
            // credentials and the revocation version in one D1 batch so a
            // storage failure cannot leave a changed username/password paired
            // with an unrevoked old session.
            const passwordHash = password
                ? serializePasswordHashV3(await hashPasswordV3(password))
                : null;
            const nextSessionVersion = crypto.randomUUID();
            const statements = [];
            if (username) {
                statements.push(c.env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(username, 'username'));
            }
            if (passwordHash) {
                statements.push(c.env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('password', passwordHash));
                statements.push(c.env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(passwordHash, 'password'));
            }
            statements.push(c.env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('session_version', nextSessionVersion));
            statements.push(c.env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(nextSessionVersion, 'session_version'));
            await c.env.DB.batch(statements);
        }

        return c.json({ success: true });
    });
}
