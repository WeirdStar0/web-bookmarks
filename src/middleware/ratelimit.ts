import { Context, Next } from 'hono';
import { Bindings, Variables } from '../types';
import { getConfig } from '../utils/common';

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
    const key = `ratelimit:${ip}`;
    const now = Date.now();
    const windowMs = config.rateLimitWindow * 1000;

    try {
        const data = await c.env.RATE_LIMIT_KV.get(key, 'json') as { count: number; resetTime: number } | null;

        if (!data || data.resetTime < now) {
            await c.env.RATE_LIMIT_KV.put(key, JSON.stringify({ count: 1, resetTime: now + windowMs }), { expirationTtl: config.rateLimitWindow });
        } else {
            if (data.count >= config.rateLimitMax) {
                return c.json({ error: 'Too Many Requests', message: '服务器繁忙，请稍后再试' }, 429);
            }
            await c.env.RATE_LIMIT_KV.put(key, JSON.stringify({ count: data.count + 1, resetTime: data.resetTime }), { expirationTtl: Math.ceil((data.resetTime - now) / 1000) });
        }
    } catch (error) {
        console.error('Rate limit check failed:', error);
    }

    await next();
}
