const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const sourceCssFile = './src/client/styles.css';
const tempOutputFile = 'tailwind-build-output.css';
const tempOutputPath = path.join(repoRoot, tempOutputFile);
const outputPath = path.join(repoRoot, 'src', 'templates', 'appCssAsset.ts');
const nodeBin = process.execPath;
const tailwindCliPath = path.join(repoRoot, 'node_modules', 'tailwindcss', 'lib', 'cli.js');

execFileSync(nodeBin, [
    tailwindCliPath,
    '-i', sourceCssFile,
    '-o', tempOutputFile,
    '--minify',
    '--content', './src/**/*.{ts,js}',
], {
    cwd: repoRoot,
    stdio: 'pipe',
});

const css = fs.readFileSync(tempOutputPath, 'utf8').trim();
const output = `// Generated from src/client/styles.css by scripts/build_app_css.js
export const appCssAssetSource = ${JSON.stringify(css)};
`;

fs.writeFileSync(outputPath, output, 'utf8');
fs.rmSync(tempOutputPath, { force: true });
