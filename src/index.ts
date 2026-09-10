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
import type { HTTPException } from 'hono/http-exception';
import { err, ErrCode, getConfig, DeploymentSetupError } from './utils/common';
import type { TemplateTranslations } from './templates/types';
import { appAssetSource } from './templates/appAsset';
import { appCssAssetSource } from './templates/appCssAsset';
import { vendorAssetSource } from './templates/vendorAsset';

const locales: Record<string, Omit<TemplateTranslations, 'lang'>> = { en, zh, zhtw, ja, ko, es, fr, de, ru, pt, it };

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function isAllowedExtensionOrigin(origin: string, allowedOrigins: string[]) {
    return allowedOrigins.includes(origin);
}

function isLocalhostOrigin(origin: string): boolean {
    try {
        const { hostname } = new URL(origin);
        return hostname === 'localhost' || hostname === '127.0.0.1';
    } catch {
        return false;
    }
}

function isAllowedRequestOrigin(origin: string, requestOrigin: string, allowedExtensionOrigins: string[]): boolean {
    if (origin === requestOrigin) return true;
    if (isLocalhostOrigin(origin) && isLocalhostOrigin(requestOrigin)) return true;
    if (
        (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) &&
        isAllowedExtensionOrigin(origin, allowedExtensionOrigins)
    ) {
        return true;
    }
    return false;
}

app.use('*', logger());
app.use('*', csrf({
    origin: (origin, c) => {
        const config = getConfig(c.env);
        const requestOrigin = new URL(c.req.url).origin;
        return isAllowedRequestOrigin(origin, requestOrigin, config.allowedExtensionOrigins);
    }
}));
app.use('/api/*', cors({
    origin: (origin, c) => {
        const config = getConfig(c.env);
        const requestOrigin = new URL(c.req.url).origin;
        return isAllowedRequestOrigin(origin, requestOrigin, config.allowedExtensionOrigins) ? origin : undefined;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
}));
app.use('/api/*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (!origin) {
        await next();
        return;
    }

    const config = getConfig(c.env);
    const requestOrigin = new URL(c.req.url).origin;
    if (!isAllowedRequestOrigin(origin, requestOrigin, config.allowedExtensionOrigins)) {
        return c.json(err(ErrCode.FORBIDDEN, 'Origin not allowed'), 403);
    }

    await next();
});
app.use('*', secureHeaders({
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        // No 'unsafe-eval': the dashboard runs the @alpinejs/csp build, whose
        // restricted expression parser needs no Function constructor.
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
    },
}));

// Global Error Handler
app.onError((err, c) => {
    // First-run guidance: the deployment itself is not configured yet. The
    // message reveals only deployment state, never credentials, and 503 marks
    // a temporary operator-fixable condition instead of a bug.
    if (err instanceof DeploymentSetupError) {
        // The missing-SECRET_KEY case is thrown outside the init settings
        // try/catch, so this branch is the only place it reaches a log.
        console.warn(`[Deployment Setup]: ${err.message}`);
        return c.json({
            error: 'DEPLOYMENT_NOT_INITIALIZED',
            message: err.message,
        }, 503);
    }

    // Hono surfaces malformed request JSON as a SyntaxError. Treat it as a
    // client validation failure rather than reporting a misleading 500.
    const isMalformedJson = err instanceof SyntaxError || err.name === 'SyntaxError';
    const status = isMalformedJson ? 400 : (err as HTTPException).status || 500;
    if (status >= 500) {
        console.error(`[Global Error]: ${err.stack || err.message}`);
    } else {
        console.warn(`[Request Rejected ${status}]: ${err.message}`);
    }
    const acceptLanguage = c.req.header('Accept-Language') || '';
    let isEn = acceptLanguage.toLowerCase().startsWith('en');

    // Cookie check
    const cookieLang = getCookie(c, 'locale');
    if (cookieLang === 'en') isEn = true;
    if (cookieLang === 'zh') isEn = false;

    if (isMalformedJson) {
        return c.json({
            error: ErrCode.VALIDATION,
            message: isEn ? 'Invalid JSON request body' : '请求 JSON 格式无效',
        }, 400);
    }

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
app.get('/assets/app.js', (c) => {
    c.header('Content-Type', 'application/javascript; charset=utf-8');
    return c.body(appAssetSource);
});
app.get('/assets/app.css', (c) => {
    c.header('Content-Type', 'text/css; charset=utf-8');
    return c.body(appCssAssetSource);
});
app.get('/assets/vendor.js', (c) => {
    c.header('Content-Type', 'application/javascript; charset=utf-8');
    return c.body(vendorAssetSource);
});

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
    const translation: TemplateTranslations = { ...t, lang };

    return c.html(html(translation));
});

export default app;
