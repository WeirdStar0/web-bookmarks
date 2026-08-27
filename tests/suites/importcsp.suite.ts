import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importcsp', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('returns CSP header with style-src unsafe-inline and without script-src unsafe-inline', async () => {
        const response = await app.fetch(new Request('https://example.com/'), env);
        expect(response.status).toBe(200);
        const csp = response.headers.get('content-security-policy');
        expect(csp).toBeTruthy();
        expect(csp).toContain("style-src 'self' 'unsafe-inline'");
        expect(csp).toContain("script-src 'self' 'unsafe-eval'");
        expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    });
});
