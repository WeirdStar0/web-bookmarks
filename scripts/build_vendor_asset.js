const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');

const repoRoot = path.resolve(__dirname, '..');
const entryPath = path.join(repoRoot, 'src', 'client', 'vendor.js');
const outputPath = path.join(repoRoot, 'src', 'templates', 'vendorAsset.ts');

const result = buildSync({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    write: false,
    minify: true,
    target: ['es2020'],
});

const source = result.outputFiles[0].text;
const output = `// Generated from src/client/vendor.js by scripts/build_vendor_asset.js
export const vendorAssetSource = ${JSON.stringify(source)};
`;

fs.writeFileSync(outputPath, output, 'utf8');
