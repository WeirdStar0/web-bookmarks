import { Context, Next } from 'hono';
import { Bindings, Variables } from '../types';
import { INIT_SQL } from '../db/schema';
import { getSettings, hashPassword } from '../utils/common';

let instanceSecret: string | null = null;
type SettingsValueRow = { value: string };

export async function initMiddleware(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
    const envSecret = c.env.SECRET_KEY;
    const defaultLegacyPasswordHash = await hashPassword('12345');
    const defaultPasswordHash = await hashPassword('123456');

    // 1. Auto-init DB
    try {
        await c.env.DB.prepare('SELECT 1 FROM settings LIMIT 1').first();
    } catch {
        console.log('Database not initialized. Starting auto-initialization...');
        try {
            for (const sql of INIT_SQL) {
                await c.env.DB.prepare(sql).run();
            }
            console.log('Database initialized successfully.');
        } catch (initErr) {
            console.error('Database auto-initialization failed:', initErr);
        }
    }

    // 2. Dynamic Secret Logic with Instance Cache
    if (!instanceSecret) {
        if (envSecret) {
            instanceSecret = envSecret;
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
                        // Concurrency: someone else might have inserted it
                        const retry = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('secret_key').first<SettingsValueRow>();
                        instanceSecret = retry?.value || newSecret;
                    }
                }
            } catch {
                // Without a stable shared secret, signed-cookie auth becomes inconsistent across instances.
                throw new Error('Session secret unavailable: set SECRET_KEY or ensure DB secret_key is readable');
            }
        }
    }

    c.set('sessionSecret', instanceSecret as string);

    // 3. Init Default Admin
    try {
        const settings = await getSettings(c.env.DB);
        if (!settings.username) {
            try {
                await c.env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('username', 'admin').run();
                await c.env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('password', defaultPasswordHash).run();
            } catch (e) {
                console.error("Failed to init default admin", e);
            }
        }

        if (settings.password === defaultLegacyPasswordHash) {
            await c.env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(defaultPasswordHash, 'password').run();
        }
    } catch (e) {
        console.error('Error in Init Middleware settings check', e);
    }

    await next();
}
