import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const extensionRoot = join(root, 'extensions', 'vscode-apex-debug-log-explorer');
const manifest = JSON.parse(await readFile(join(extensionRoot, 'package.json'), 'utf8'));
const vsixPath = join(root, 'release', `apex-debug-log-explorer-${rootPackage.version}.vsix`);
const vsceBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce');
const token = process.env.VSCE_PAT;

if (!token) {
  console.error('Missing VSCE_PAT. Create a Visual Studio Marketplace PAT with Marketplace Manage scope, then run:');
  console.error('VSCE_PAT=<token> npm run vscode:publish');
  process.exit(1);
}

if (!existsSync(vsixPath)) {
  console.error(`VSIX not found: ${vsixPath}`);
  console.error('Run npm run vscode:package first.');
  process.exit(1);
}

const result = spawnSync(vsceBin, ['publish', '--packagePath', vsixPath, '--pat', token], {
  cwd: extensionRoot,
  stdio: 'inherit',
  shell: false
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`Published https://marketplace.visualstudio.com/items?itemName=${manifest.publisher}.${manifest.name}`);
