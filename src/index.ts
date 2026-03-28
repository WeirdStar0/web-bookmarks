import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { getCookie } from 'hono/cookie';
import { html } from './templates/html';
import { Bindings, Variables } from './types';
import { initMiddleware } from './middleware/init';
import { rateLimitMiddleware } from './middleware/ratelimit';
import { authMiddleware } from './middleware/auth';
import apiRoutes from './routes/api';
import { zh } from './locales/zh';
import { en } from './locales/en';
import { zhtw } from './locales/zhtw';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { de } from './locales/de';
import { ru } from './locales/ru';
import { pt } from './locales/pt';
import { it } from './locales/it';
import { csrf } from 'hono/csrf';

const locales: Record<string, any> = { en, zh, zhtw, ja, ko, es, fr, de, ru, pt, it };

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.use('*', logger());
app.use('*', csrf({
    origin: (origin, c) => {
        // Allow extensions and same domain
        if (origin.startsWith('chrome-extension://')) return true;
        if (origin.startsWith('moz-extension://')) return true;
        const host = c.req.header('host');
        if (host && origin.includes(host)) return true;
        // Dev
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) return true;
        return false;
    }
}));
app.use('/api/*', cors({
    origin: (origin) => {
        // Allow Localhost (Dev)
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) return origin;
        // Allow Web App (Prod) - Update with your actual domain
        if (origin.endsWith('.workers.dev') || origin.endsWith('.pages.dev')) return origin;
        // Allow Chrome Extension
        if (origin.startsWith('chrome-extension://')) return origin;
        // Block others
        return undefined;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));
app.use('*', secureHeaders({
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
}));

// Global Error Handler
app.onError((err, c) => {
    console.error(`[Global Error]: ${err.stack || err.message}`);
    const status = (err as any).status || 500;
    const acceptLanguage = c.req.header('Accept-Language') || '';
    let isEn = acceptLanguage.toLowerCase().startsWith('en');

    // Cookie check
    const cookieLang = getCookie(c, 'locale');
    if (cookieLang === 'en') isEn = true;
    if (cookieLang === 'zh') isEn = false;

    const message = isEn ? 'Server Error, please try again later' : '服务器繁忙，请稍后再试';

    return c.json({
        error: 'Internal Server Error',
        message: message
    }, status);
});

app.notFound((c) => {
    const acceptLanguage = c.req.header('Accept-Language') || '';
    let isEn = acceptLanguage.toLowerCase().startsWith('en');

    const cookieLang = getCookie(c, 'locale');
    if (cookieLang === 'en') isEn = true;
    if (cookieLang === 'zh') isEn = false;

    const message = isEn ? 'Resource not found' : '资源不存在';
    return c.json({ error: 'Not Found', message: message }, 404);
});

// Middlewares - Order matters! initMiddleware MUST be first to set sessionSecret
app.use('*', initMiddleware);
app.use('/api/*', rateLimitMiddleware);
app.use('*', authMiddleware);

// Routes
app.route('/api', apiRoutes);

// Frontend
app.get('/', (c) => {
    // 1. Query Param
    let lang = c.req.query('lang');

    // 2. Cookie
    if (!lang) {
        lang = getCookie(c, 'locale');
    }

    // 3. Accept-Language Header (Basic check)
    if (!lang) {
        const acceptLanguage = c.req.header('Accept-Language') || '';
        if (acceptLanguage.toLowerCase().includes('zh-tw')) lang = 'zhtw';
        else if (acceptLanguage.toLowerCase().includes('zh')) lang = 'zh';
        else if (acceptLanguage.toLowerCase().includes('ja')) lang = 'ja';
        else if (acceptLanguage.toLowerCase().includes('ko')) lang = 'ko';
        else if (acceptLanguage.toLowerCase().includes('es')) lang = 'es';
        else if (acceptLanguage.toLowerCase().includes('fr')) lang = 'fr';
        else if (acceptLanguage.toLowerCase().includes('de')) lang = 'de';
        else if (acceptLanguage.toLowerCase().includes('ru')) lang = 'ru';
        else if (acceptLanguage.toLowerCase().includes('pt')) lang = 'pt';
        else if (acceptLanguage.toLowerCase().includes('it')) lang = 'it';
        else lang = 'en';
    }

    // Validate
    if (!locales[lang]) {
        lang = 'en';
    }

    const t = locales[lang];
    const translation = { ...t, lang };

    return c.html(html(translation));
});

export default app;
