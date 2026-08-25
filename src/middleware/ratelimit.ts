import { Context, Next } from 'hono';
import { Bindings, Variables } from '../types';
import { getConfig, err, ErrCode } from '../utils/common';

// Real Workers KV rejects expirationTtl below 60 seconds.
const KV_MIN_TTL_SECONDS = 60;

export async function rateLimitMiddleware(c: Context<{ Bindings: Bindings; Variables: Variables }>, next: Next) {
    if (!c.req.path.startsWith('/api/')) {
        return next();
    }

    const config = getConfig(c.env);
    const isLogin = c.req.path === '/api/login';

    if (!c.env.RATE_LIMIT_KV) {
        // Login must never be exposed without brute-force protection. Allow
        // preflight requests through so a correctly configured client can see
        // the explicit 503 response from the actual login attempt.
        if (isLogin && c.req.method !== 'OPTIONS') {
            return c.json(
                err(ErrCode.RATE_LIMIT_UNAVAILABLE, 'Login is temporarily unavailable: rate limiting is not configured'),
                503,
            );
        }
        return next();
    }

    const ip = c.req.header('cf-connecting-ip') || 'unknown';
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
            await c.env.RATE_LIMIT_KV.put(key, JSON.stringify({ count: 1, resetTime: now + windowMs }), {
                // The TTL is only lazy cleanup of stale counters; window logic
                // relies on resetTime. Clamp to the KV minimum so short windows
                // or late-window writes never fail the put.
                expirationTtl: Math.max(limitWindow, KV_MIN_TTL_SECONDS),
            });
        } else {
            if (data.count >= limitMax) {
                return c.json(err(ErrCode.RATE_LIMITED, '服务器繁忙，请稍后再试'), 429);
            }
            await c.env.RATE_LIMIT_KV.put(key, JSON.stringify({ count: data.count + 1, resetTime: data.resetTime }), {
                expirationTtl: Math.max(Math.ceil((data.resetTime - now) / 1000), KV_MIN_TTL_SECONDS),
            });
        }
    } catch (error) {
        console.error('Rate limit check failed:', error);
        // A present-but-unhealthy KV binding must not silently disable brute-force
        // protection. Preserve availability for non-authenticated API reads, but
        // fail closed for real login attempts just as we do for a missing binding.
        if (isLogin && c.req.method !== 'OPTIONS') {
            return c.json(
                err(ErrCode.RATE_LIMIT_UNAVAILABLE, 'Login is temporarily unavailable: rate limiting is unavailable'),
                503,
            );
        }
    }

    await next();
}
