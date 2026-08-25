const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'extension');
const distDir = path.join(rootDir, 'dist_extensions');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const sourceManifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const localeDir = path.join(extensionDir, '_locales');
const prohibitedRemoteReferences = /google\.com\/s2|fonts\.googleapis\.com|fonts\.gstatic\.com/i;
const workerEntryPath = path.join(rootDir, 'src', 'index.ts');

function fail(message) {
    throw new Error(`Extension quality check failed: ${message}`);
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        fail(`invalid JSON at ${path.relative(rootDir, filePath)}: ${error.message}`);
    }
}

if (sourceManifest.version !== packageJson.version) {
    fail(`extension manifest version ${sourceManifest.version} does not match package version ${packageJson.version}`);
}
if (!Array.isArray(sourceManifest.optional_host_permissions) || !sourceManifest.optional_host_permissions.includes('https://*/*')) {
    fail('source manifest must retain HTTPS optional host permission for user-selected servers');
}
if (sourceManifest.host_permissions) {
    fail('source manifest must not request install-time host permissions');
}

const sourceFiles = ['popup.html', 'popup.js', 'styles.css'].map((name) => path.join(extensionDir, name));
const popupSource = fs.readFileSync(path.join(extensionDir, 'popup.js'), 'utf8');
const workerEntry = fs.readFileSync(workerEntryPath, 'utf8');
for (const requiredFragment of ["'Idempotency-Key'", 'flushPendingSaves', 'queuePendingSavesOperation', 'pendingSavesOperation', 'includeBookmarks=false', 'offlineCachedMode', 'getExtensionOrigin', 'renderPendingSaves', 'pendingStorageFailed', 'apiBaseGeneration', 'setActiveApiBase', "state: 'superseded'", 'BOOKMARK_REQUEST_TIMEOUT_MS', 'signal: controller.signal', 'result.then(finish, fail)', 'Failed to read extension storage', 'withPendingSavesStorageLock', "navigator.locks.request('web-bookmarks-pending-saves'", 'refreshPendingSavesFromStorage', 'handleStorageChanges', 'chrome.storage?.onChanged?.addListener(handleStorageChanges)', 'Failed to persist folder cache', 'Failed to persist extension login state', 'Failed to persist last selected folder']) {
    if (!popupSource.includes(requiredFragment)) fail(`missing required offline sync behavior ${requiredFragment}`);
}
execFileSync(process.execPath, [path.join(rootDir, 'scripts', 'test_extension_pending_queue.js')], { stdio: 'inherit' });
if (!workerEntry.includes("'Idempotency-Key'")) {
    fail('Worker CORS configuration must allow the Idempotency-Key header');
}
for (const filePath of sourceFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (prohibitedRemoteReferences.test(content)) {
        fail(`prohibited third-party favicon or font reference found in ${path.relative(rootDir, filePath)}`);
    }
}

const popupHtml = fs.readFileSync(path.join(extensionDir, 'popup.html'), 'utf8');
for (const requiredFragment of ['role="tablist"', 'role="tree"', 'role="alert"', 'aria-live="polite"', 'id="retryPendingSavesBtn"', 'id="extensionOrigin"', 'id="pendingSavesPanel"']) {
    if (!popupHtml.includes(requiredFragment)) {
        fail(`missing required accessibility marker ${requiredFragment}`);
    }
}

execFileSync(process.execPath, ['--check', path.join(extensionDir, 'popup.js')], { stdio: 'inherit' });

const locales = fs.readdirSync(localeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
const defaultMessages = readJson(path.join(localeDir, 'zh_CN', 'messages.json'));
const expectedKeys = Object.keys(defaultMessages).sort();
for (const locale of locales) {
    const messages = readJson(path.join(localeDir, locale, 'messages.json'));
    const keys = Object.keys(messages).sort();
    const missing = expectedKeys.filter((key) => !keys.includes(key));
    if (missing.length > 0) fail(`${locale} is missing locale keys: ${missing.join(', ')}`);
    for (const key of expectedKeys) {
        if (typeof messages[key]?.message !== 'string' || messages[key].message.length === 0) {
            fail(`${locale}.${key} must provide a non-empty message`);
        }
    }
}

for (const browser of ['chrome', 'edge', 'firefox']) {
    const browserDir = path.join(distDir, browser);
    const manifestPath = path.join(browserDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) fail(`missing ${browser} build artifact`);
    const manifest = readJson(manifestPath);
    if (manifest.version !== packageJson.version) fail(`${browser} manifest version is out of sync`);
    if (!Array.isArray(manifest.optional_host_permissions)) fail(`${browser} artifact lost optional host permissions`);

    const popupPath = path.join(browserDir, 'popup.js');
    execFileSync(process.execPath, ['--check', popupPath], { stdio: 'inherit' });
    const artifactContent = `${fs.readFileSync(path.join(browserDir, 'popup.html'), 'utf8')}\n${fs.readFileSync(popupPath, 'utf8')}`;
    if (prohibitedRemoteReferences.test(artifactContent)) fail(`${browser} artifact contains prohibited third-party references`);
}

const firefoxManifest = readJson(path.join(distDir, 'firefox', 'manifest.json'));
if (!firefoxManifest.browser_specific_settings?.gecko?.strict_min_version) {
    fail('Firefox build must define browser_specific_settings.gecko.strict_min_version');
}

console.log(`Extension quality check passed for ${locales.length} locales and 3 browser artifacts.`);
