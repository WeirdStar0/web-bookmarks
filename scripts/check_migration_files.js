const fs = require('fs');
const path = require('path');

const migrationsDir = path.resolve(__dirname, '..', 'migrations');
const expectedLatest = Number(process.env.EXPECTED_LATEST_MIGRATION || 13);
const files = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{3}_.+\.sql$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

const expected = Array.from({ length: expectedLatest }, (_, index) => `${String(index + 1).padStart(3, '0')}_`);
const missing = expected.filter((prefix) => !files.some((file) => file.startsWith(prefix)));
const unexpected = files.filter((file) => {
    const number = Number(file.slice(0, 3));
    return !Number.isInteger(number) || number < 1 || number > expectedLatest;
});

if (missing.length > 0 || unexpected.length > 0) {
    const details = [];
    if (missing.length > 0) details.push(`missing migration prefixes: ${missing.join(', ')}`);
    if (unexpected.length > 0) details.push(`unexpected migration files: ${unexpected.join(', ')}`);
    throw new Error(`Migration file set check failed: ${details.join('; ')}`);
}

console.log(`Migration file set check passed (${files.length} files through ${String(expectedLatest).padStart(3, '0')}).`);
