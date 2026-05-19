const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appTemplatePath = path.join(repoRoot, 'src', 'client', 'app.js');
const fragmentsDir = path.join(repoRoot, 'src', 'client', 'fragments');
const outputPath = path.join(repoRoot, 'src', 'templates', 'appAsset.ts');
const fragmentNames = ['state', 'data', 'views', 'helpers', 'actions', 'imports', 'drag'];

const appTemplate = fs.readFileSync(appTemplatePath, 'utf8');
const fragments = fragmentNames.map((name) => {
    const fragmentPath = path.join(fragmentsDir, `${name}.js`);
    return fs.readFileSync(fragmentPath, 'utf8').trim();
});

const source = appTemplate.replace('__APP_FRAGMENTS_PLACEHOLDER__', fragments.join(',\n\n'));
new Function(source);

const output = `// Generated from src/client/app.js by scripts/build_app_asset.js
export const appAssetSource = ${JSON.stringify(source)};
`;

fs.writeFileSync(outputPath, output, 'utf8');
