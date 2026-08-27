import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('folderreorderbudget', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('validates folder reorder with a bounded number of read queries', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const ids: number[] = [];
        const now = new Date().toISOString();
        for (let i = 0; i < 95; i++) {
            const id = 2000 + i;
            ids.push(id);
            db.folders.push({
                id,
                name: `Folder ${i}`,
                parent_id: null,
                sort_order: i,
                is_deleted: 0,
                created_at: now,
                updated_at: now,
            });
        }

        const readsBefore = db.readQueryCount;
        const response = await app.fetch(new Request('https://example.com/api/folders/reorder', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
            },
            body: JSON.stringify({ orderedIds: [...ids].reverse() }),
        }), env);

        expect(response.status).toBe(200);
        const readsUsed = db.readQueryCount - readsBefore;
        expect(readsUsed).toBeLessThanOrEqual(8);
    });
});
