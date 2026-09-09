// Zero-binding Worker that measures the CPU cost of the real password KDF
// code paths on the production Free plan. The harness is kept in-repo so the
// numbers in docs/password-v4-design.md stay reproducible; the deployed
// instance is temporary:
//
//   cd scripts/kdf_bench && npx wrangler deploy
//   node run_bench.mjs <printed workers.dev URL>
//   npx wrangler delete   # when done
//
// In-worker timing is impossible: Date.now()/performance.now() do not
// advance during synchronous compute on Workers. Each request therefore
// runs the scenario exactly once, and run_bench.mjs reads the platform's
// per-invocation cpuTimeMs from `wrangler tail` (Workers Invocation Logs).
//
// The migration scenarios mirror the login path in src/routes/auth.ts
// (verifyStoredPassword -> createPasswordHash at verdict.upgradeFactor) but
// deliberately omit the D1 conditional write: storage is I/O, not CPU.

import {
    createPasswordHash,
    hashPasswordV2,
    hashPasswordV3,
    serializePasswordHashV3,
    verifyStoredPassword,
} from '../../src/utils/common';
import type { Bindings } from '../../src/types';

// Fixed inputs: PBKDF2 CPU cost depends only on the iteration count, so
// identical inputs keep every invocation directly comparable.
const PASSWORD = 'kdf-bench-password';
const SALT_HEX = '00112233445566778899aabbccddeeff';
// Valid per parsePepperValue: alphanumeric id (1-16 chars) and material
// long enough (>= 32 chars). A configured pepper makes every re-hash a v4
// (HMAC-prehashed) derivation, matching the recommended production setup.
const PEPPER = 'bench:0123456789abcdef0123456789abcdef';

function benchEnv(iterations?: string): Bindings {
    const env: Record<string, string> = { PASSWORD_PEPPER: PEPPER };
    if (iterations !== undefined) env.PASSWORD_HASH_ITERATIONS = iterations;
    return env as unknown as Bindings;
}

// Stored hashes are genuine derivations (verify must succeed, otherwise
// needsUpgrade stays false and the re-hash half of a migration scenario
// would silently not run). They are built once per isolate; the first
// request on a fresh isolate answers {ready: false} so that cost never
// lands in a measured sample.
let storedV3: string | null = null;
let storedV2: string | null = null;
async function ensureStoredHashes(): Promise<boolean> {
    if (storedV3 !== null) return false;
    storedV3 = serializePasswordHashV3(await hashPasswordV3(PASSWORD, 25_000, SALT_HEX));
    const v2 = await hashPasswordV2(PASSWORD, SALT_HEX);
    storedV2 = `v2:${v2.salt}:${v2.hash}`;
    return true;
}

const SCENARIOS: Record<string, { env: Bindings; run: () => Promise<Record<string, unknown>> }> = {
    // Single derivations at the three documented factors.
    'hash-25k': {
        env: benchEnv(),
        run: async () => {
            await hashPasswordV3(PASSWORD, 25_000, SALT_HEX);
            return {};
        },
    },
    'hash-90k': {
        env: benchEnv(),
        run: async () => {
            await hashPasswordV3(PASSWORD, 90_000, SALT_HEX);
            return {};
        },
    },
    'hash-100k': {
        env: benchEnv(),
        run: async () => {
            await hashPasswordV2(PASSWORD, SALT_HEX);
            return {};
        },
    },
    // Migration logins: verify at the stored factor, then re-hash at
    // verdict.upgradeFactor (the login flow's lazy upgrade, minus the
    // D1 write).
    'login-v3-25k-to-v4-25k': {
        env: benchEnv(),
        run: async () => {
            const verdict = await verifyStoredPassword(SCENARIOS['login-v3-25k-to-v4-25k'].env, storedV3!, PASSWORD);
            if (!verdict.ok || !verdict.needsUpgrade) throw new Error('scenario wiring broken: no upgrade');
            const value = await createPasswordHash(SCENARIOS['login-v3-25k-to-v4-25k'].env, PASSWORD, verdict.upgradeFactor);
            return { upgradeFactor: verdict.upgradeFactor, format: value.split(':')[0] };
        },
    },
    'login-v3-25k-to-v4-90k': {
        env: benchEnv('90000'),
        run: async () => {
            const verdict = await verifyStoredPassword(SCENARIOS['login-v3-25k-to-v4-90k'].env, storedV3!, PASSWORD);
            if (!verdict.ok || !verdict.needsUpgrade) throw new Error('scenario wiring broken: no upgrade');
            const value = await createPasswordHash(SCENARIOS['login-v3-25k-to-v4-90k'].env, PASSWORD, verdict.upgradeFactor);
            return { upgradeFactor: verdict.upgradeFactor, format: value.split(':')[0] };
        },
    },
    'login-v2-100k-to-v4-100k': {
        env: benchEnv(),
        run: async () => {
            const verdict = await verifyStoredPassword(SCENARIOS['login-v2-100k-to-v4-100k'].env, storedV2!, PASSWORD);
            if (!verdict.ok || !verdict.needsUpgrade) throw new Error('scenario wiring broken: no upgrade');
            const value = await createPasswordHash(SCENARIOS['login-v2-100k-to-v4-100k'].env, PASSWORD, verdict.upgradeFactor);
            return { upgradeFactor: verdict.upgradeFactor, format: value.split(':')[0] };
        },
    },
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

export default {
    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const scenarioId = url.searchParams.get('scenario') ?? '';
        const nonce = url.searchParams.get('nonce') ?? '';
        const scenario = SCENARIOS[scenarioId];
        if (!scenario) return json({ ok: false, error: 'unknown scenario' }, 400);
        // run=0/1 lets the runner drop fresh-isolate requests (and their
        // hash-building CPU) from the sample set via the tail logs.
        if (await ensureStoredHashes()) {
            console.log(`bench:${nonce}:0`);
            return json({ ok: true, ready: false });
        }
        try {
            const detail = await scenario.run();
            console.log(`bench:${nonce}:1`);
            return json({ ok: true, ready: true, scenario: scenarioId, ...detail });
        } catch (error) {
            return json({ ok: false, error: String(error) }, 500);
        }
    },
};
