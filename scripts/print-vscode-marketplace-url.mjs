import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const manifestPath = join(root, 'extensions', 'vscode-apex-debug-log-explorer', 'package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (!manifest.publisher || !manifest.name) {
  console.error('VS Code extension package.json must include publisher and name.');
  process.exit(1);
}

const itemName = `${manifest.publisher}.${manifest.name}`;
console.log(`https://marketplace.visualstudio.com/items?itemName=${itemName}`);
