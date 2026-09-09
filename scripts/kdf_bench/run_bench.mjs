// Benchmark orchestrator for the zero-binding KDF worker. See worker.ts for
// the scenario definitions and deployment steps.
//
//   node run_bench.mjs <https://web-bookmarks-kdf-bench.<subdomain>.workers.dev> [samples]
//
// What it measures and why:
//   - CPU: per-invocation cpuTimeMs reported by the platform (Workers
//     Invocation Logs), captured via `wrangler tail --format json`. This is
//     the quantity the Free-plan 10 ms budget accounts, and it cannot be
//     measured from inside the Worker (timers do not advance during
//     synchronous compute).
//   - Wall-clock: client-side fetch duration, as a "real request latency"
//     reference column only.
//
// Each measured request carries a unique nonce; the Worker logs
// `bench:<nonce>:<ran>` and the runner joins nonces to tail events, so
// fresh-isolate requests (ran=0), warmups, and transient edge errors are
// excluded from the CPU statistics no matter when isolates are recycled.

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const WRANGLER_BIN = path.join(REPO_ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const WORKER_NAME = 'web-bookmarks-kdf-bench';
const SCENARIOS = [
    'hash-25k',
    'hash-90k',
    'hash-100k',
    'login-v3-25k-to-v4-25k',
    'login-v3-25k-to-v4-90k',
    'login-v2-100k-to-v4-100k',
];

const baseUrl = process.argv[2]?.replace(/\/+$/, '');
const samples = Number(process.argv[3] ?? 30);
if (!baseUrl || !Number.isInteger(samples) || samples < 5) {
    console.error('usage: node run_bench.mjs <worker base URL> [samples>=5]');
    process.exit(1);
}

// ---- tail capture -----------------------------------------------------------

// Run wrangler's bin with node directly (bypasses npx/cmd shims) and keep
// stdin closed: with a held-open stdin pipe wrangler blocks before
// connecting on Windows.
const tail = spawn(process.execPath, [WRANGLER_BIN, 'tail', WORKER_NAME, '--format', 'json'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
});
let tailOut = '';
tail.stdout.on('data', (chunk) => { tailOut += chunk; });
tail.stderr.on('data', () => { /* wrangler prints connection status here */ });
tail.on('exit', (code) => { if (code !== 0 && code !== null) console.error(`(tail exited with ${code})`); });

// Give the tail connection time to establish before issuing requests.
await sleep(6000);

// ---- requests ---------------------------------------------------------------

async function hit(scenario, nonce) {
    const url = `${baseUrl}/?scenario=${scenario}${nonce ? `&nonce=${nonce}` : '&warmup=1'}`;
    const started = performance.now();
    let response;
    try {
        response = await fetch(url);
    } catch (error) {
        return { transient: true, reason: String(error) };
    }
    const wallMs = performance.now() - started;
    let body;
    try {
        body = await response.json();
    } catch {
        // Non-JSON edge error pages (e.g. "error code: 1042"); retryable.
        return { transient: true, reason: `HTTP ${response.status}, non-JSON body` };
    }
    if (!response.ok || !body.ok) {
        return body?.error === 'unknown scenario'
            ? { fatal: `${scenario}: ${JSON.stringify(body)}` }
            : { transient: true, reason: `HTTP ${response.status} ${JSON.stringify(body)}` };
    }
    return { body, wallMs };
}

const walls = {};
const nonces = {};
for (const scenario of SCENARIOS) {
    // Warm the isolate (retrying past ready:false and transient edge errors)
    // and the TLS connection; warmup requests carry no nonce and are
    // excluded from CPU stats.
    let warmed = false;
    for (let attempt = 0; attempt < 12 && !warmed; attempt += 1) {
        const result = await hit(scenario, null);
        if (result.fatal) throw new Error(result.fatal);
        warmed = Boolean(result.body?.ready);
    }
    if (!warmed) throw new Error(`${scenario}: never reached a warm isolate`);

    walls[scenario] = [];
    nonces[scenario] = [];
    for (let i = 0; i < samples; i += 1) {
        let recorded = false;
        for (let attempt = 0; attempt < 8 && !recorded; attempt += 1) {
            const nonce = randomUUID().slice(0, 8);
            const result = await hit(scenario, nonce);
            if (result.fatal) throw new Error(result.fatal);
            if (result.transient || !result.body.ready) continue; // edge error or fresh isolate
            walls[scenario].push(result.wallMs);
            nonces[scenario].push(nonce);
            recorded = true;
        }
        if (!recorded) throw new Error(`${scenario} sample ${i}: exhausted retries`);
    }
    process.stdout.write(`requests done: ${scenario} (${nonces[scenario].length} samples)\n`);
}

// ---- tail drain -------------------------------------------------------------

function parseTail() {
    const byNonce = new Map();
    // wrangler's --format json pretty-prints one multi-line object per
    // invocation; fields are always indented, so a top-level event begins
    // with a bare "{" line and ends with a bare "}" line.
    const lines = tailOut.split(/\r?\n/);
    let block = null;
    const blocks = [];
    for (const line of lines) {
        if (line === '{') {
            block = ['{'];
        } else if (block !== null) {
            block.push(line);
            if (line === '}') {
                blocks.push(block.join('\n'));
                block = null;
            }
        }
    }
    for (const text of blocks) {
        let event;
        try {
            event = JSON.parse(text);
        } catch { continue; }
        const logs = (event.logs ?? []).map((entry) => entry.message?.join?.('') ?? String(entry.message));
        const marker = logs.map((m) => m.match(/^bench:([0-9a-f-]+):([01])$/)).find(Boolean);
        if (!marker) continue;
        // cpuTime is a number of milliseconds in current wrangler versions;
        // tolerate "1.2 ms" / "543 µs" / "1.2 s" strings from older ones.
        let cpuMs;
        if (typeof event.cpuTime === 'number') {
            cpuMs = event.cpuTime;
        } else {
            const raw = String(event.cpuTime ?? '');
            const value = Number.parseFloat(raw);
            if (!Number.isFinite(value)) continue;
            cpuMs = /µs|us/.test(raw) ? value / 1000 : (raw.includes('ms') ? value : value * 1000);
        }
        byNonce.set(marker[1], { cpuMs, outcome: event.outcome ?? 'unknown', ran: marker[2] === '1' });
    }
    return byNonce;
}

const wanted = Object.values(nonces).flat();
let byNonce = parseTail();
for (let waited = 0; waited < 45; waited += 1) {
    if (wanted.every((n) => byNonce.has(n))) break;
    await sleep(1000);
    byNonce = parseTail();
}
tail.kill();

// ---- stats ------------------------------------------------------------------

function median(sorted) {
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function p95(sorted) {
    return sorted[Math.ceil(0.95 * sorted.length) - 1];
}
function fmt(value) {
    return value === undefined ? '—' : value.toFixed(2);
}

const rows = [];
let missing = 0;
for (const scenario of SCENARIOS) {
    const cpu = [];
    const outcomes = {};
    for (const nonce of nonces[scenario]) {
        const event = byNonce.get(nonce);
        if (!event || !event.ran) { missing += 1; continue; }
        cpu.push(event.cpuMs);
        outcomes[event.outcome] = (outcomes[event.outcome] ?? 0) + 1;
    }
    cpu.sort((a, b) => a - b);
    const wall = walls[scenario].slice().sort((a, b) => a - b);
    if (cpu.length !== samples) {
        console.error(`! ${scenario}: ${cpu.length}/${samples} samples matched in tail events`);
    }
    rows.push({
        scenario,
        n: cpu.length,
        cpuMedian: cpu.length ? median(cpu) : undefined,
        cpuP95: cpu.length ? p95(cpu) : undefined,
        wallMedian: wall.length ? median(wall) : undefined,
        outcomes,
    });
}

console.log('\n| scenario | cpuTimeMs median [p95] | client wall-clock median (ms) | n | outcomes |');
console.log('|---|---|---|---|---|');
for (const r of rows) {
    const cpu = r.cpuMedian === undefined ? '—' : `${fmt(r.cpuMedian)} [${fmt(r.cpuP95)}]`;
    const outs = Object.entries(r.outcomes).map(([k, v]) => `${k}×${v}`).join(', ');
    console.log(`| ${r.scenario} | ${cpu} | ${fmt(r.wallMedian)} | ${r.n} | ${outs} |`);
}
if (missing > 0) console.error(`! ${missing} samples could not be matched in tail events`);
