import { Context, Next } from 'hono';
import { getSignedCookie } from 'hono/cookie';
import { Bindings, Variables } from '../types';
import { err, ErrCode, getSessionVersion } from '../utils/common';

export async function authMiddleware(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
    const url = new URL(c.req.url);
    if (c.req.method === 'OPTIONS') {
        return next();
    }

    // Public paths
    if (url.pathname === '/' || url.pathname === '/api/login' || (!url.pathname.startsWith('/api') && !url.pathname.startsWith('/admin'))) {
        return next();
    }

    const secret = c.get('sessionSecret');
    const cookie = await getSignedCookie(c, secret, 'auth');
    if (!cookie) {
        return c.json(err(ErrCode.UNAUTHORIZED, 'Unauthorized'), 401);
    }
    const isHotRead = c.req.method === 'GET' && (url.pathname === '/api/data' || url.pathname === '/api/search');
    if (isHotRead) {
        c.set('sessionVersionCookie', cookie);
        c.set('sessionVersionPromise', getSessionVersion(c.env.DB));
        await next();
        return;
    }

    const currentSessionVersion = await getSessionVersion(c.env.DB);
    if (cookie !== currentSessionVersion) {
        return c.json(err(ErrCode.UNAUTHORIZED, 'Unauthorized'), 401);
    }

    await next();

}
