import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { en } from '../../src/locales/en'

describe('validation', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('returns a safe validation error for malformed JSON request bodies', async () => {
        const response = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
                'Accept-Language': 'en',
            },
            body: '{"username":',
        }), env);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: 'VALIDATION_ERROR',
            message: 'Invalid JSON request body',
        });
    });
});
