import { KVNamespace, D1Database } from '@cloudflare/workers-types';

export interface Bindings {
    DB: D1Database;
    RATE_LIMIT_KV?: KVNamespace;
    SECRET_KEY?: string;
    INITIAL_ADMIN_PASSWORD?: string;
    ALLOWED_EXTENSION_ORIGINS?: string;
    SESSION_MAX_AGE?: string;
    RATE_LIMIT_MAX?: string;
    RATE_LIMIT_WINDOW?: string;
}

export interface Variables {
    sessionSecret: string;
}
