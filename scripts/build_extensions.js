const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PACKAGE_VERSION = require(path.join(ROOT_DIR, 'package.json')).version;
const EXT_DIR = path.join(ROOT_DIR, 'extension');
const DIST_DIR = path.join(ROOT_DIR, 'dist_extensions');

// Configuration
const BROWSERS = {
    chrome: {
        manifestUpdates: {}
    },
    edge: {
        manifestUpdates: {} // Edge is Chromium compatible
    },
    firefox: {
        manifestUpdates: {
            browser_specific_settings: {
                gecko: {
                    id: "web-bookmarks@weirdstar.net", // Example ID, user might need to change
                    strict_min_version: "109.0"
                }
            }
        }
    }
};

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

async function build() {
    console.log('📦 Building extensions...');

    // Clean dist
    if (fs.existsSync(DIST_DIR)) {
        fs.rmSync(DIST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(DIST_DIR);

    for (const [browser, config] of Object.entries(BROWSERS)) {
        console.log(`🔹 Building for ${browser}...`);
        const targetDir = path.join(DIST_DIR, browser);

        // 1. Copy source
        copyDir(EXT_DIR, targetDir);

        // 2. Modify Manifest
        const manifestPath = path.join(targetDir, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        // Keep every browser artifact aligned to the package release version.
        manifest.version = PACKAGE_VERSION;

        // Merge browser-specific updates.
        Object.assign(manifest, config.manifestUpdates);

        // Firefox specific: remove background service worker if present (not fully supported the same way in all versions or conflicts)
        // But we observe our manifest has NO background worker.
        // Firefox specific: permission adjustments if needed.

        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4));
    }

    console.log('✅ Build complete! Check ./dist_extensions/');
}

build().catch(console.error);
