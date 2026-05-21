import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const rootPackage = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const extensionRoot = join(root, 'extensions', 'vscode-apex-debug-log-explorer');
const releaseDir = join(root, 'release');
const vsceBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce');
const outFile = join(releaseDir, `apex-debug-log-explorer-${rootPackage.version}.vsix`);

await mkdir(releaseDir, { recursive: true });

const result = spawnSync(vsceBin, ['package', '--no-dependencies', '--allow-missing-repository', '--out', outFile], {
  cwd: extensionRoot,
  stdio: 'inherit',
  shell: false
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
