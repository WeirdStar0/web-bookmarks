import type { Context, Next } from 'hono';
import { Bindings, Variables } from '../types';
import { INIT_SQL } from '../db/schema';
import { createPasswordHash, getSettings, hashPassword, resolvePasswordIterations } from '../utils/common';

const MIN_INITIAL_PASSWORD_LENGTH = 12;
const LOCAL_DEVELOPMENT_PASSWORD = 'local-development-only';

async function createInitialAdminPasswordHash(env: Bindings, password: string): Promise<string> {
    return createPasswordHash(env, password, resolvePasswordIterations(env));
}

let instanceSecret: string | null = null;
let dbReady = false;
let dbInitializationPromise: Promise<void> | null = null;
let defaultAdminChecked = false;
type SettingsValueRow = { value: string };

async function ensureDatabaseReady(db: D1Database): Promise<void> {
    if (dbReady) return;

    if (!dbInitializationPromise) {
        dbInitializationPromise = (async () => {
            try {
                await db.prepare('SELECT 1 FROM settings LIMIT 1').first();
                dbReady = true;
            } catch {
                console.log('Database not initialized. Starting auto-initialization...');
                try {
                    for (const sql of INIT_SQL) {
                        await db.prepare(sql).run();
                    }
                    dbReady = true;
                    console.log('Database initialized successfully.');
                } catch (initErr) {
                    console.error('Database auto-initialization failed:', initErr);
                    throw new Error(`Database auto-initialization failed: ${(initErr as Error).message}`);
                }
            }
        })().catch((error) => {
            // A failed attempt must not poison the instance forever. The next
            // request can retry once the underlying database is available.
            dbInitializationPromise = null;
            throw error;
        });
    }

    await dbInitializationPromise;
}

export async function initMiddleware(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
    const envSecret = c.env.SECRET_KEY;
    const requestHost = new URL(c.req.url).hostname;
    const isLocalDevelopment = requestHost === 'localhost' || requestHost === '127.0.0.1';

    // 1. Auto-init DB (once per instance). Concurrent cold-start requests
    // await one shared promise so they cannot race through INIT_SQL.
    await ensureDatabaseReady(c.env.DB);

    // 2. Dynamic Secret Logic with Instance Cache
    if (!instanceSecret) {
        if (envSecret) {
            instanceSecret = envSecret;
        } else if (!isLocalDevelopment) {
            // Fail closed: the D1-managed secret lives in the same database as
            // the password hash and session_version, so a read-only D1 leak
            // would otherwise allow forging valid session cookies. Production
            // must provide SECRET_KEY as a Worker secret; only localhost may
            // fall back to the auto-generated settings.secret_key.
            throw new Error('SECRET_KEY is required for non-local deployments: run "npx wrangler secret put SECRET_KEY" before deploying (existing installations must set it before upgrading).');
        } else {
            try {
                const dbSecretResult = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('secret_key').first<SettingsValueRow>();
                if (dbSecretResult) {
                    instanceSecret = dbSecretResult.value;
                } else {
                    const newSecret = crypto.randomUUID();
                    try {
                        await c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind('secret_key', newSecret).run();
                        instanceSecret = newSecret;
                    } catch {
                        // A competing instance may have inserted the key first.
                        // Only accept a value that can be read back from D1;
                        // signing with an unpersisted random fallback would make
                        // session validity depend on the Worker instance.
                        const retry = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('secret_key').first<SettingsValueRow>();
                        if (!retry?.value) {
                            throw new Error('Session secret could not be persisted or recovered from D1');
                        }
                        instanceSecret = retry.value;
                    }
                }
            } catch {
                throw new Error('Local session secret unavailable: set SECRET_KEY in .dev.vars or ensure DB secret_key is readable');
            }
        }
    }

    c.set('sessionSecret', instanceSecret as string);

    // 3. Initialize or migrate the administrator account once per instance.
    if (!defaultAdminChecked) {
        const legacyDefaultPasswordHash = await hashPassword('12345');
        const initialAdminPassword = c.env.INITIAL_ADMIN_PASSWORD || (isLocalDevelopment ? LOCAL_DEVELOPMENT_PASSWORD : '');

        try {
            const settings = await getSettings(c.env.DB);
            if (!settings.username || !settings.password) {
                if (!initialAdminPassword) {
                    throw new Error('Initial admin unavailable: set INITIAL_ADMIN_PASSWORD before first production login');
                }
                if (initialAdminPassword.length < MIN_INITIAL_PASSWORD_LENGTH) {
                    throw new Error(`Initial admin password must be at least ${MIN_INITIAL_PASSWORD_LENGTH} characters`);
                }

                const initialAdminPasswordValue = await createInitialAdminPasswordHash(c.env, initialAdminPassword);
                try {
                    await c.env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('username', 'admin').run();
                    await c.env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('password', initialAdminPasswordValue).run();
                    if (c.env.INITIAL_ADMIN_PASSWORD) {
                        console.warn('Initial admin account created. Change the password immediately.');
                    } else {
                        console.warn('Local development admin account created. Change the password before non-local use.');
                    }
                } catch (error) {
                    console.error('Failed to initialize default admin', error);
                    throw error;
                }
            }

            // A historical installation may still use a documented v1 default
            // password. Never silently replace one known weak credential with
            // another. Production operators must provide a strong replacement
            // before the account is allowed to serve authenticated requests.
            if (settings.password === legacyDefaultPasswordHash) {
                if (!initialAdminPassword) {
                    throw new Error('Legacy default administrator password detected: set INITIAL_ADMIN_PASSWORD before serving requests');
                }
                if (initialAdminPassword.length < MIN_INITIAL_PASSWORD_LENGTH) {
                    throw new Error(`Legacy default administrator password requires INITIAL_ADMIN_PASSWORD with at least ${MIN_INITIAL_PASSWORD_LENGTH} characters`);
                }
                const migratedHash = await createInitialAdminPasswordHash(c.env, initialAdminPassword);
                await c.env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(migratedHash, 'password').run();
                console.warn('Legacy default administrator password replaced with INITIAL_ADMIN_PASSWORD. Change it after first login.');
            }

            defaultAdminChecked = true;
        } catch (error) {
            console.error('Error in Init Middleware settings check', error);
            // Keep the flag false so a transient database failure can be retried.
            // Do not serve an authenticated application when the account state
            // could not be read or repaired. Keeping the flag false permits a
            // later request to retry transient D1 failures safely.
            throw error;
        }
    }

    await next();
}

// Exported for tests to reset module-level state between cases
export function resetInitState() {
    instanceSecret = null;
    dbReady = false;
    dbInitializationPromise = null;
    defaultAdminChecked = false;
}
