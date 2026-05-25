import { deleteCookie, setSignedCookie } from 'hono/cookie';
import { getConfig, getSettings, hashPassword, hashPasswordV2 } from '../utils/common';
import * as s from '../utils/schemas';
import type { ApiApp } from './types';

export function registerAuthRoutes(app: ApiApp) {
    app.post('/login', async (c) => {
        const config = getConfig(c.env);
        const body = await c.req.json();
        const result = s.loginSchema.safeParse(body);

        if (!result.success) {
            return c.json({ error: result.error.issues[0].message }, 400);
        }
        const { username, password } = result.data;

        const settings = await getSettings(c.env.DB);
        const dbUser = settings.username;
        const dbPass = settings.password;

        if (username === dbUser) {
            if (dbPass.startsWith('v2:')) {
                const parts = dbPass.split(':');
                if (parts.length === 3) {
                    const salt = parts[1];
                    const storedHash = parts[2];
                    const verify = await hashPasswordV2(password, salt);
                    if (verify.hash === storedHash) {
                        const secret = c.get('sessionSecret');
                        const url = new URL(c.req.url);
                        const isSecure = url.protocol === 'https:';
                        await setSignedCookie(c, 'auth', 'true', secret, {
                            path: '/',
                            httpOnly: true,
                            secure: isSecure,
                            sameSite: isSecure ? 'None' : 'Lax',
                            maxAge: config.sessionMaxAge,
                        });
                        return c.json({ success: true });
                    }
                }
            } else {
                const inputHash = await hashPassword(password);
                if (inputHash === dbPass) {
                    const v2 = await hashPasswordV2(password);
                    const newDbValue = `v2:${v2.salt}:${v2.hash}`;
                    await c.env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(newDbValue, 'password').run();

                    const secret = c.get('sessionSecret');
                    const url = new URL(c.req.url);
                    const isSecure = url.protocol === 'https:';
                    await setSignedCookie(c, 'auth', 'true', secret, {
                        path: '/',
                        httpOnly: true,
                        secure: isSecure,
                        sameSite: isSecure ? 'None' : 'Lax',
                        maxAge: config.sessionMaxAge,
                    });
                    return c.json({ success: true, migrated: true });
                }
            }
        }
        return c.json({ error: 'Invalid credentials' }, 401);
    });

    app.post('/logout', async (c) => {
        deleteCookie(c, 'auth');
        return c.json({ success: true });
    });

    app.put('/settings', async (c) => {
        const body = await c.req.json();
        const result = s.settingsSchema.safeParse(body);

        if (!result.success) {
            return c.json({ error: result.error.issues[0].message }, 400);
        }
        const { username, password } = result.data;

        if (username) {
            await c.env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(username, 'username').run();
        }

        if (password) {
            const v2 = await hashPasswordV2(password);
            const newDbValue = `v2:${v2.salt}:${v2.hash}`;
            await c.env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(newDbValue, 'password').run();
        }

        return c.json({ success: true });
    });
}
