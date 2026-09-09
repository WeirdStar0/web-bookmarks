import { KVNamespace, D1Database } from '@cloudflare/workers-types';

export interface Bindings {
    DB: D1Database;
    RATE_LIMIT_KV?: KVNamespace;
    SECRET_KEY?: string;
    INITIAL_ADMIN_PASSWORD?: string;
    PASSWORD_PEPPER?: string;
    PASSWORD_PEPPER_PREVIOUS?: string;
    ALLOWED_EXTENSION_ORIGINS?: string;
    SESSION_MAX_AGE?: string;
    RATE_LIMIT_MAX?: string;
    RATE_LIMIT_WINDOW?: string;
    RATE_LIMIT_LOGIN_MAX?: string;
    RATE_LIMIT_LOGIN_WINDOW?: string;
}

export interface Variables {
    sessionSecret: string;
    sessionVersionCookie?: string;
    sessionVersionPromise?: Promise<string>;
}
