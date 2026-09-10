const fs = require('node:fs');
const path = require('node:path');

const DAY_MS = 24 * 60 * 60 * 1000;

function parseArgs(argv) {
    let maxAgeDays = 90;
    let referenceDate = new Date().toISOString().slice(0, 10);

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--max-age-days') {
            maxAgeDays = Number(argv[++i]);
        } else if (arg.startsWith('--max-age-days=')) {
            maxAgeDays = Number(arg.slice('--max-age-days='.length));
        } else if (arg === '--reference-date') {
            referenceDate = argv[++i];
        } else if (arg.startsWith('--reference-date=')) {
            referenceDate = arg.slice('--reference-date='.length);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (!Number.isInteger(maxAgeDays) || maxAgeDays < 1) {
        throw new Error('--max-age-days must be a positive integer');
    }

    return { maxAgeDays, referenceDate };
}

function parseDateOnly(value, label) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`${label} must use YYYY-MM-DD format`);
    }

    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year
        || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day
    ) {
        throw new Error(`${label} is not a valid calendar date`);
    }

    return date;
}

function main() {
    const { maxAgeDays, referenceDate } = parseArgs(process.argv.slice(2));
    const repoRoot = path.resolve(__dirname, '..');
    const wranglerPath = path.join(repoRoot, 'wrangler.toml');
    const wrangler = fs.readFileSync(wranglerPath, 'utf8');
    const match = wrangler.match(/^compatibility_date\s*=\s*"(\d{4}-\d{2}-\d{2})"\s*$/m);

    if (!match) {
        throw new Error('wrangler.toml must contain exactly one YYYY-MM-DD compatibility_date');
    }

    const configuredValue = match[1];
    const configuredDate = parseDateOnly(configuredValue, 'compatibility_date');
    const reference = parseDateOnly(referenceDate, 'reference date');
    const ageDays = Math.floor((reference.getTime() - configuredDate.getTime()) / DAY_MS);

    if (ageDays < 0) {
        throw new Error(`compatibility_date ${configuredValue} is ${Math.abs(ageDays)} day(s) in the future`);
    }

    console.log(`compatibility_date=${configuredValue}; age=${ageDays} day(s); limit=${maxAgeDays} day(s)`);

    if (ageDays > maxAgeDays) {
        console.error(
            `Compatibility date is stale by policy: ${ageDays} days old (limit ${maxAgeDays}). `
            + 'Review Cloudflare compatibility flags, advance wrangler.toml in a PR, and run the normal CI/browser smoke before deploying.',
        );
        process.exitCode = 1;
    }
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
