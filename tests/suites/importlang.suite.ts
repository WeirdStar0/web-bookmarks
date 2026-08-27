import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('importlang', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('renders translations safely in dataset using URL encoding', async () => {
        const response = await app.fetch(new Request('https://example.com/'), env);
        expect(response.status).toBe(200);
        const htmlText = await response.text();
        const match = htmlText.match(/data-translations="([^"]+)"/);
        expect(match).toBeTruthy();
        const encoded = match![1];
        expect(() => JSON.parse(decodeURIComponent(encoded))).not.toThrow();
        const parsed = JSON.parse(decodeURIComponent(encoded));
        expect(parsed).toHaveProperty('lang');
    });
});
