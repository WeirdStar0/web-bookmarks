import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';
import { TEST_INITIAL_ADMIN_PASSWORD } from '../constants';

describe('clientinit', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('gracefully handles missing password in settings, resets defaultAdminChecked, and allows re-initialization', async () => {
        // 首先确保初始登录过了，即 Worker 内 defaultAdminChecked = true
        const cookie = await login(env);
        expect(cookie).toBeTruthy();

        const db = env.DB as unknown as MockD1Database;
        // 模拟外部删除密码以求重置
        db.settings.delete('password');

        // 使用错误的密码登录，应该被拒绝返回 401
        const wrongResponse = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: 'wrongpassword',
            }),
        }), env);
        expect(wrongResponse.status).toBe(401);

        // 验证数据库里密码确实仍未生成
        expect(db.settings.get('password')).toBeUndefined();

        // 使用管理员初始密码发起登录请求，预期应当直接登录成功 (200)
        const loginResponse = await app.fetch(new Request('https://example.com/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://example.com',
            },
            body: JSON.stringify({
                username: 'admin',
                password: TEST_INITIAL_ADMIN_PASSWORD,
            }),
        }), env);

        expect(loginResponse.status).toBe(200);
        const newCookie = loginResponse.headers.get('set-cookie');
        expect(newCookie).toBeTruthy();

        // 验证此时密码已经重新被成功写入数据库中
        expect(db.settings.get('password')).toBeTruthy();
        expect(db.settings.get('password')?.startsWith('v3:')).toBe(true);
    });
});
