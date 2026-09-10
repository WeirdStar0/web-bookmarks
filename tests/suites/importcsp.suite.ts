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

    it('returns a CSP header without script-src unsafe-eval or unsafe-inline', async () => {
        // The dashboard runs the @alpinejs/csp build, whose restricted
        // expression parser is what makes dropping 'unsafe-eval' possible.
        const response = await app.fetch(new Request('https://example.com/'), env);
        expect(response.status).toBe(200);
        const csp = response.headers.get('content-security-policy');
        expect(csp).toBeTruthy();
        expect(csp).toContain("style-src 'self' 'unsafe-inline'");
        expect(csp).toContain("script-src 'self'");
        expect(csp).not.toContain('unsafe-eval');
        expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    });
});
