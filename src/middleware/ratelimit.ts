import { Context, Next } from 'hono';
import { Bindings, Variables } from '../types';
import { getConfig, err, ErrCode } from '../utils/common';

export async function rateLimitMiddleware(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
    if (!c.req.path.startsWith('/api/')) {
        return next();
    }

    const config = getConfig(c.env);
    if (!c.env.RATE_LIMIT_KV) {
        // Fallback if KV is not bound
        return next();
    }

    const ip = c.req.header('cf-connecting-ip') || 'unknown';
    const isLogin = c.req.path === '/api/login';
    const key = isLogin ? `ratelimit:login:${ip}` : `ratelimit:${ip}`;
    const limitMax = isLogin ? config.rateLimitLoginMax : config.rateLimitMax;
    const limitWindow = isLogin ? config.rateLimitLoginWindow : config.rateLimitWindow;
    const now = Date.now();
    const windowMs = limitWindow * 1000;

    try {
        // NOTE: KV get-then-put is not atomic. Under high concurrency two requests
        // may read the same count and both increment, allowing bursts above the limit.
        // For strict enforcement, consider Cloudflare's built-in rate-limiting products.
        const data = await c.env.RATE_LIMIT_KV.get(key, 'json') as { count: number; resetTime: number } | null;

        if (!data || data.resetTime < now) {
            await c.env.RATE_LIMIT_KV.put(key, JSON.stringify({ count: 1, resetTime: now + windowMs }), { expirationTtl: limitWindow });
        } else {
            if (data.count >= limitMax) {
                return c.json(err(ErrCode.RATE_LIMITED, '服务器繁忙，请稍后再试'), 429);
            }
            await c.env.RATE_LIMIT_KV.put(key, JSON.stringify({ count: data.count + 1, resetTime: data.resetTime }), { expirationTtl: Math.ceil((data.resetTime - now) / 1000) });
        }
    } catch (error) {
        console.error('Rate limit check failed:', error);
    }

    await next();
}
