import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const webDist = join(root, 'dist');
const extensionRoot = join(root, 'extensions', 'vscode-apex-debug-log-explorer');
const extensionWebDist = join(extensionRoot, 'webview-dist');

await rm(extensionWebDist, { recursive: true, force: true });
await mkdir(extensionWebDist, { recursive: true });
await cp(webDist, extensionWebDist, { recursive: true });
