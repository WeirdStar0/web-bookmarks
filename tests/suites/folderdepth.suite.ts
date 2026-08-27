import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { resetInitState } from '../../src/middleware/init';
import { createEnv, login, MockD1Database, MockKVNamespace, FailingKVNamespace, StrictTtlKVNamespace, toNullableNumber, type TestEnv } from '../helpers';

describe('folderdepth', () => {
    let env: TestEnv;

    beforeEach(() => {
        env = createEnv();
        resetInitState();
    });

    it('rejects folder creation and moves that would exceed the maximum depth', async () => {
        const cookie = await login(env);
        const db = env.DB as unknown as MockD1Database;
        const createFolder = async (name: string, parentId: number | null) => {
            const response = await app.fetch(new Request('https://example.com/api/folders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Cookie: cookie,
                    Origin: 'https://example.com',
                },
                body: JSON.stringify({ name, parent_id: parentId }),
            }), env);
            expect(response.status).toBe(200);
            return db.folders[db.folders.length - 1]?.id as number;
        };

        let parentId: number | null = null;
        for (let depth = 1; depth <= 12; depth += 1) {
            parentId = await createFolder(`depth-${depth}`, parentId);
        }

        const tooDeepResponse = await app.fetch(new Request('https://example.com/api/folders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ name: 'depth-13', parent_id: parentId }),
        }), env);
        expect(tooDeepResponse.status).toBe(400);
        expect(await tooDeepResponse.json()).toMatchObject({ error: 'FOLDER_DEPTH_LIMIT' });

        const moveRootId = await createFolder('move-root', null);
        await createFolder('move-child', moveRootId);
        const moveResponse = await app.fetch(new Request(`https://example.com/api/folders/${moveRootId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Cookie: cookie,
                Origin: 'https://example.com',
            },
            body: JSON.stringify({ parent_id: db.folders.find((folder) => folder.name === 'depth-11')?.id }),
        }), env);
        expect(moveResponse.status).toBe(400);
        expect(await moveResponse.json()).toMatchObject({ error: 'FOLDER_DEPTH_LIMIT' });
    });
});
