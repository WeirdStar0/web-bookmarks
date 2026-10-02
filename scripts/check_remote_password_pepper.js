// Verifies that the production password hash and the PASSWORD_PEPPER secret
// actually agree with each other. Setting the secret is not enough: a stored
// hash only becomes peppered (v4) on the next successful login, and that
// migration write fails silently by design — `upgradeStoredPasswordIfUnchanged`
// swallows storage errors so a correct password is never rejected. A deployment
// can therefore sit in a "configured but not migrated" state with a green login
// response and no v4 hash, which leaves the D1 leak it is meant to prevent fully
// exploitable. This check is the only automated way to notice.
//
// Deliberately NOT part of `deploy:check`: it reads remote state, and the local
// pre-deploy gate must stay usable before a database or a secret exists. Run it
// after deployment with `npm run verify:remote-pepper`.

const path = require('path');
const { execFileSync, execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const databaseBinding = 'DB';
const pepperSecret = 'PASSWORD_PEPPER';
const previousPepperSecret = 'PASSWORD_PEPPER_PREVIOUS';

// Never select `value` directly: the stored hash and its salt must not reach
// terminal output, CI logs, or screenshots. Classify the format inside SQL and
// return only a label, the pepper id (a non-secret identifier that is stored in
// the hash itself) and the value length.
const formatQuery = "SELECT CASE "
    + "WHEN value LIKE 'v4:%' THEN 'v4' "
    + "WHEN value LIKE 'v3:%' THEN 'v3' "
    + "WHEN value LIKE 'v2:%' THEN 'v2' "
    + "ELSE 'v1' END AS format, "
    + "CASE WHEN value LIKE 'v4:%' THEN substr(value, 4, instr(substr(value, 4), ':') - 1) ELSE '' END AS pepper_id, "
    + "length(value) AS stored_length "
    + "FROM settings WHERE key = 'password';";

function runWrangler(args) {
    if (process.platform === 'win32') {
        // The SQL contains single quotes only, so double-quoting each argument
        // is safe on the Windows shell.
        const quoted = args.map((arg) => `"${arg}"`).join(' ');
        return execSync(`npx.cmd wrangler ${quoted}`, {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    }
    return execFileSync('npx', ['wrangler', ...args], {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function fail(lines) {
    lines.forEach((line) => console.error(line));
    process.exit(1);
}

try {
    // `secret list` has no --json flag: JSON is already its default output
    // format. Only secret NAMES are returned; values are never readable.
    const secretNames = new Set(
        JSON.parse(runWrangler(['secret', 'list'])).map((secret) => secret.name),
    );
    const queryResult = JSON.parse(
        runWrangler(['d1', 'execute', databaseBinding, '--remote', '--command', formatQuery, '--json']),
    )[0];

    if (!queryResult || !Array.isArray(queryResult.results) || queryResult.results.length === 0) {
        console.log('Remote password pepper check: no password hash is stored yet.');
        console.log('The account has not been initialized. Set INITIAL_ADMIN_PASSWORD and complete the first login, then run this check again.');
        process.exit(0);
    }

    const { format, pepper_id: pepperId, stored_length: storedLength } = queryResult.results[0];
    const hasPepper = secretNames.has(pepperSecret);
    const hasPrevious = secretNames.has(previousPepperSecret);

    console.log(`Remote password pepper check: stored hash format = ${format}, pepper id = ${pepperId || '(none)'}, stored length = ${storedLength}.`);

    if (format === 'v4' && !hasPepper) {
        fail([
            'Production deployment is LOCKED: the stored password hash is peppered (v4) but the PASSWORD_PEPPER secret does not exist.',
            'Verification resolves the pepper by id and fails closed, so every login attempt returns 401 with no fallback.',
            'Restore the pepper recorded in your password manager as PASSWORD_PEPPER, or reset the account by deleting the "password" row from settings and redeploying with INITIAL_ADMIN_PASSWORD.',
        ]);
    }

    if (format === 'v4' && hasPepper) {
        if (hasPrevious) {
            // Only a warning: keeping the previous pepper is harmless, it just
            // widens the set of secrets that can verify a hash.
            console.warn(`Note: ${previousPepperSecret} is still set. Remove it once no stored hash references its id.`);
        }
        console.log('Remote password pepper check passed: the stored hash is peppered and its pepper secret is present.');
        console.log('A D1-only leak can no longer verify or crack the administrator password.');
        process.exit(0);
    }

    if (format !== 'v4' && hasPepper) {
        fail([
            `Production deployment is HALF-ENABLED: ${pepperSecret} is configured but the stored hash is still ${format}.`,
            'The pepper takes effect only on the next successful login, and that migration write fails silently by design, so the login response alone proves nothing.',
            'Log out and log back in once, then run this check again. Until the stored hash reports v4, a D1-only leak can still crack the password offline.',
        ]);
    }

    // No pepper secret and no peppered hash: a legitimate, documented choice.
    // `docs/production-runbook.md` marks the pepper optional but recommended, so
    // this must not fail a deployment — it only has to be visible.
    console.log(`Remote password pepper check passed: the password is protected by ${format} PBKDF2 with no pepper.`);
    console.log(`Optional hardening: set ${pepperSecret} ("<id>:<material>") so a D1-only leak cannot verify or crack the password. See docs/production-runbook.md section 4.`);
} catch (error) {
    const detail = [
        error?.stderr?.toString().trim(),
        error?.stdout?.toString().trim(),
        error?.message,
    ].filter(Boolean).join('\n') || String(error);

    if (/no such table:\s*settings/i.test(detail)) {
        console.error('Remote password pepper check could not inspect an uninitialized database: table "settings" does not exist.');
        console.error('Apply the migration chain with "npm run db:migrate:remote", or initialize with "npm run db:init:remote", then run this check again.');
    } else if (/not authenticated|login required|Could not authenticate|API token/i.test(detail)) {
        console.error('Remote password pepper check could not reach Cloudflare. Authenticate with "npx wrangler whoami" or set CLOUDFLARE_API_TOKEN.');
    } else {
        console.error('Remote password pepper check failed.');
    }
    console.error(detail);
    process.exit(1);
}
