import { deleteCookie, setSignedCookie } from 'hono/cookie';
import type { Context } from 'hono';
import {
    createPasswordHash,
    getConfig,
    getSessionVersion,
    getSettings,
    rotateSessionVersion,
    upgradeStoredPasswordIfUnchanged,
    verifyStoredPassword,
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

async function createInitialPassword(env: Bindings, db: D1Database, password: string): Promise<boolean> {
    const value = await createPasswordHash(env, password);
    const inserted = await db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
        .bind('password', value)
        .run();
    return Number(inserted.meta.changes) === 1;
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
                if (await createInitialPassword(c.env, c.env.DB, initialAdminPassword)
                    && await setAuthCookie(c, config.sessionMaxAge, sessionVersionAtVerificationStart, config.allowedExtensionOrigins)) {
                    return c.json({ success: true });
                }
                return c.json(err(ErrCode.INVALID_CREDENTIALS, 'Invalid credentials'), 401);
            }
            return c.json(err(ErrCode.INVALID_CREDENTIALS, 'Invalid credentials'), 401);
        }

        if (username === dbUser) {
            const verdict = await verifyStoredPassword(c.env, dbPass, password);
            if (verdict.ok) {
                // Legacy v1/v2 hashes rely on the conditional upgrade write to
                // detect a credential change racing this login, so a lost race
                // aborts them. v3/v4 keep their session in that race because a
                // real credential change also rotates the session version and
                // setAuthCookie re-checks it below.
                const isLegacyFormat = !dbPass.startsWith('v3:') && !dbPass.startsWith('v4:');
                let migrated = false;
                if (verdict.needsUpgrade) {
                    const outcome = await upgradeStoredPasswordIfUnchanged(c.env, c.env.DB, dbPass, password);
                    if (outcome === 'applied') migrated = true;
                    if (outcome === 'unchanged' && isLegacyFormat) {
                        return c.json(err(ErrCode.INVALID_CREDENTIALS, 'Invalid credentials'), 401);
                    }
                }
                if (await setAuthCookie(c, config.sessionMaxAge, sessionVersionAtVerificationStart, config.allowedExtensionOrigins)) {
                    return c.json({ success: true, ...(migrated ? { migrated: true } : {}) });
                }
                return c.json(err(ErrCode.INVALID_CREDENTIALS, 'Invalid credentials'), 401);
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
                ? await createPasswordHash(c.env, password)
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
