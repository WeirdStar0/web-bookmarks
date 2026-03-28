import { Context, Next } from 'hono';
import { Bindings, Variables } from '../types';
import { INIT_SQL } from '../db/schema';
import { getSettings, hashPassword } from '../utils/common';

let instanceSecret: string | null = null;

export async function initMiddleware(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
    const envSecret = c.env.SECRET_KEY;

    // 1. Auto-init DB
    try {
        await c.env.DB.prepare('SELECT 1 FROM settings LIMIT 1').first();
    } catch (e) {
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
                const dbSecretResult = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('secret_key').first() as any;
                if (dbSecretResult) {
                    instanceSecret = dbSecretResult.value as string;
                } else {
                    const newSecret = crypto.randomUUID();
                    try {
                        await c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind('secret_key', newSecret).run();
                        instanceSecret = newSecret;
                    } catch (insErr) {
                        // Concurrency: someone else might have inserted it
                        const retry = await c.env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('secret_key').first() as any;
                        instanceSecret = retry?.value || newSecret;
                    }
                }
            } catch (e) {
                // Critical Fallback: Use one-time stable fallback for this instance duration
                instanceSecret = 'stable-instance-fallback-' + Date.now();
            }
        }
    }

    c.set('sessionSecret', instanceSecret || 'default-secret');

    // 3. Init Default Admin
    try {
        const settings = await getSettings(c.env.DB);
        if (!settings.username) {
            const defaultPassHash = await hashPassword('12345');
            try {
                await c.env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('username', 'admin').run();
                await c.env.DB.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').bind('password', defaultPassHash).run();
            } catch (e) {
                console.error("Failed to init default admin", e);
            }
        }
    } catch (e) {
        console.error('Error in Init Middleware settings check', e);
    }

    await next();
}
